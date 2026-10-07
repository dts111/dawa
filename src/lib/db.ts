// Storage layer on libSQL (SQLite-compatible).
//
// Locally this opens a plain SQLite file (data/eaas-pm.db). In production,
// point DATABASE_URL at a hosted Turso database so the app can run on
// serverless or disk-less hosts (Netlify, Render free tier) at no cost.
//
// Every query is written in plain SQL and confined to this file, so nothing in
// the UI or the scheduling engine knows which database is underneath.

import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import type {
  Assignment,
  AutomationRule,
  ConstraintType,
  Dependency,
  DependencyType,
  Project,
  Resource,
  ShareLink,
  TableLayout,
  Task,
  TaskStatus,
  User,
  UserRole,
  UserStatus,
  UserWithStats,
} from "./types";
import { hashPassword, verifyPassword } from "./passwords";

/** DATABASE_URL wins (libsql://… for Turso, or file:…); DATABASE_FILE is the older local-only setting. */
function databaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const file = process.env.DATABASE_FILE || path.join("data", "eaas-pm.db");
  // The local file is a runtime path, not a build input — keep the bundler from
  // tracing (and shipping) the whole project, database included.
  const abs = path.isAbsolute(file) ? file : path.join(/*turbopackIgnore: true*/ process.cwd(), file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  return `file:${abs.replace(/\\/g, "/")}`;
}

let client: Client | null = null;
let ready: Promise<void> | null = null;

/** Opens the connection and runs migrations once per process. */
async function db(): Promise<Client> {
  if (!client) {
    const url = databaseUrl();
    client = createClient({ url, authToken: process.env.DATABASE_AUTH_TOKEN || undefined });
    ready = migrate(client, url.startsWith("file:"));
  }
  try {
    await ready;
  } catch (e) {
    // Let the next request retry rather than caching a failed start-up forever.
    client = null;
    ready = null;
    throw e;
  }
  return client;
}

/** libSQL rejects `undefined` as a bound value, so normalise to null. */
function clean(args: unknown[]): InArgs {
  return args.map((a) => (a === undefined ? null : a)) as InArgs;
}

async function all<T>(sql: string, ...args: unknown[]): Promise<T[]> {
  const rs = await (await db()).execute({ sql, args: clean(args) });
  return rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])) as T);
}

async function get<T>(sql: string, ...args: unknown[]): Promise<T | null> {
  return (await all<T>(sql, ...args))[0] ?? null;
}

async function run(sql: string, ...args: unknown[]): Promise<void> {
  await (await db()).execute({ sql, args: clean(args) });
}

/** Runs several statements atomically. */
async function transaction(statements: { sql: string; args: unknown[] }[]): Promise<void> {
  if (!statements.length) return;
  await (await db()).batch(
    statements.map((s): InStatement => ({ sql: s.sql, args: clean(s.args) })),
    "write",
  );
}

/** Bump whenever runMigrations() changes, so existing databases pick the change up. */
const SCHEMA_VERSION = "2026-10-08.1";

/**
 * Start-up checks. On an up-to-date database this is one PRAGMA and one read:
 * the full migration and the admin sync only run when something changed. (Each
 * query to a hosted database is a network round trip, so this matters for the
 * first request after the server has been idle.)
 */
async function migrate(d: Client, isFile: boolean) {
  if (isFile) await d.execute("PRAGMA journal_mode = WAL");
  await d.execute("PRAGMA foreign_keys = ON");

  let meta = new Map<string, string>();
  try {
    const rs = await d.execute("SELECT key, value FROM meta WHERE key IN ('schemaVersion', 'adminFingerprint')");
    meta = new Map(rs.rows.map((r) => [String(r.key), String(r.value)]));
  } catch {
    // No meta table yet: a database from before this check existed.
  }

  if (meta.get("schemaVersion") !== SCHEMA_VERSION) {
    await runMigrations(d);
    await setMeta(d, "schemaVersion", SCHEMA_VERSION);
  }
  const fingerprint = adminFingerprint();
  if (meta.get("adminFingerprint") !== fingerprint) {
    await ensureAdmin(d);
    await setMeta(d, "adminFingerprint", fingerprint);
  }
}

async function setMeta(d: Client, key: string, value: string) {
  await d.execute({
    sql: "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [key, value],
  });
}

/** Changes whenever ADMIN_EMAIL or ADMIN_PASSWORD changes, without storing either. */
function adminFingerprint(): string {
  return createHmac("sha256", process.env.SESSION_SECRET ?? "")
    .update(`${(process.env.ADMIN_EMAIL ?? "").trim().toLowerCase()}\n${process.env.ADMIN_PASSWORD ?? ""}`)
    .digest("base64url");
}

/** Creates tables and adds columns. Safe to re-run; only called when SCHEMA_VERSION changes. */
async function runMigrations(d: Client) {
  await d.executeMultiple(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      startDate TEXT NOT NULL,
      holidays TEXT NOT NULL DEFAULT '[]',
      workingDays TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      parentId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      sortOrder REAL NOT NULL DEFAULT 0,
      name TEXT NOT NULL,
      duration INTEGER NOT NULL DEFAULT 1,
      constraintType TEXT NOT NULL DEFAULT 'ASAP',
      constraintDate TEXT,
      percentComplete INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      baselineStart TEXT,
      baselineFinish TEXT,
      baselineDuration INTEGER,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(projectId);

    CREATE TABLE IF NOT EXISTS dependencies (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      predecessorId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      successorId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'FS',
      lag INTEGER NOT NULL DEFAULT 0,
      UNIQUE(predecessorId, successorId)
    );
    CREATE INDEX IF NOT EXISTS idx_deps_project ON dependencies(projectId);

    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT,
      dayRate REAL NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_res_project ON resources(projectId);

    CREATE TABLE IF NOT EXISTS assignments (
      id TEXT PRIMARY KEY,
      taskId TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      resourceId TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
      units INTEGER NOT NULL DEFAULT 100,
      UNIQUE(taskId, resourceId)
    );

    -- One-click email buttons resolve to a row here.
    CREATE TABLE IF NOT EXISTS update_tokens (
      token TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      taskId TEXT REFERENCES tasks(id) ON DELETE CASCADE,
      recipientEmail TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS activity (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      taskId TEXT,
      actor TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_project ON activity(projectId);

    -- Read-only links: anonymous ones, and personal ones emailed to stakeholders.
    CREATE TABLE IF NOT EXISTS share_links (
      token TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      label TEXT,
      createdAt TEXT NOT NULL,
      revokedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_share_project ON share_links(projectId);

    CREATE TABLE IF NOT EXISTS automation_rules (
      id TEXT PRIMARY KEY,
      projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      trigger TEXT NOT NULL,
      triggerDays INTEGER NOT NULL DEFAULT 0,
      triggerStatus TEXT,
      action TEXT NOT NULL,
      actionEmails TEXT,
      includeButtons INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      lastRunAt TEXT,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_rules_project ON automation_rules(projectId);

    -- Stops a rule emailing the same person about the same task twice a day.
    CREATE TABLE IF NOT EXISTS automation_log (
      id TEXT PRIMARY KEY,
      ruleId TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
      taskId TEXT,
      recipient TEXT NOT NULL,
      onDate TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      UNIQUE(ruleId, taskId, recipient, onDate)
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      passwordHash TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'invited',
      sessionVersion INTEGER NOT NULL DEFAULT 1,
      inviteTokenHash TEXT,
      inviteExpiresAt TEXT,
      failedLogins INTEGER NOT NULL DEFAULT 0,
      lockedUntil TEXT,
      createdAt TEXT NOT NULL,
      lastLoginAt TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_invite ON users(inviteTokenHash);
  `);

  await addColumnIfMissing(d, "tasks", "status", "TEXT");
  await addColumnIfMissing(d, "tasks", "objectives", "TEXT");
  await addColumnIfMissing(d, "tasks", "guidance", "TEXT");
  await addColumnIfMissing(d, "tasks", "remarks", "TEXT");
  await addColumnIfMissing(d, "tasks", "risk", "TEXT");

  // Personal stakeholder invites.
  await addColumnIfMissing(d, "share_links", "email", "TEXT");
  await addColumnIfMissing(d, "share_links", "message", "TEXT");
  await addColumnIfMissing(d, "share_links", "lastSentAt", "TEXT");
  await addColumnIfMissing(d, "share_links", "lastViewedAt", "TEXT");
  await addColumnIfMissing(d, "share_links", "viewCount", "INTEGER NOT NULL DEFAULT 0");

  // Client name and logo, shown to stakeholders on the plan.
  await addColumnIfMissing(d, "projects", "clientName", "TEXT");
  await addColumnIfMissing(d, "projects", "clientLogo", "TEXT");
  await addColumnIfMissing(d, "projects", "tableLayout", "TEXT");

  // Accounts: every plan belongs to one user.
  await addColumnIfMissing(d, "projects", "ownerId", "TEXT");
  await d.execute("CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(ownerId)");
}

/**
 * Seeds the administrator from ADMIN_EMAIL / ADMIN_PASSWORD the first time, keeps the
 * admin's email in step with ADMIN_EMAIL, and hands any plan without an owner to the admin
 * (which is how plans made before accounts existed end up with the admin).
 */
async function ensureAdmin(d: Client) {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";

  const existing = await d.execute(
    "SELECT id, email, passwordHash FROM users WHERE role = 'admin' ORDER BY createdAt LIMIT 1",
  );
  let adminId = existing.rows[0]?.id as string | undefined;

  // ADMIN_PASSWORD stays the source of truth for the admin's password: changing it in the
  // host's settings changes the password (and signs the admin out elsewhere).
  if (adminId && password && !(await verifyPassword(password, existing.rows[0]?.passwordHash as string | null))) {
    await d.execute({
      sql: "UPDATE users SET passwordHash = ?, sessionVersion = sessionVersion + 1, status = 'active' WHERE id = ?",
      args: [await hashPassword(password), adminId],
    });
  }

  if (!adminId) {
    if (!email || !password) return; // Nothing to seed from; sign-in stays closed until it is set.
    adminId = randomUUID();
    await d.execute({
      sql: `INSERT INTO users (id, email, name, passwordHash, role, status, createdAt)
            VALUES (?, ?, ?, ?, 'admin', 'active', ?)`,
      args: [adminId, email, "Administrator", await hashPassword(password), new Date().toISOString()],
    });
  } else if (email && existing.rows[0]?.email !== email) {
    const taken = await d.execute({ sql: "SELECT 1 FROM users WHERE email = ?", args: [email] });
    if (!taken.rows.length) {
      await d.execute({ sql: "UPDATE users SET email = ? WHERE id = ?", args: [email, adminId] });
    }
  }

  await d.execute({ sql: "UPDATE projects SET ownerId = ? WHERE ownerId IS NULL", args: [adminId] });
}

/** SQLite has no "ADD COLUMN IF NOT EXISTS", so check the table info first. */
async function addColumnIfMissing(d: Client, table: string, column: string, type: string) {
  const rs = await d.execute(`PRAGMA table_info(${table})`);
  const nameIdx = rs.columns.indexOf("name");
  if (!rs.rows.some((r) => r[nameIdx] === column)) {
    await d.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

/**
 * Status and percentComplete are two views of the same thing, so keep them
 * consistent rather than letting them drift apart.
 */
export function deriveStatus(percentComplete: number, stored?: string | null): TaskStatus {
  if (percentComplete >= 100) return "done";
  if (stored === "blocked") return "blocked";
  if (stored === "done") return "in_progress"; // marked done but % was lowered
  if (stored === "in_progress" || percentComplete > 0) return "in_progress";
  return "not_started";
}

/** The percentComplete implied by moving a card into a board column. */
export function percentForStatus(status: TaskStatus, current: number): number {
  if (status === "done") return 100;
  if (status === "not_started") return 0;
  return current >= 100 ? 90 : current; // leaving "done" shouldn't stay at 100%
}

export const newId = () => randomUUID();
const now = () => new Date().toISOString();

// --- Row mapping -----------------------------------------------------------

interface ProjectRow {
  id: string;
  ownerId: string | null;
  name: string;
  description: string | null;
  startDate: string;
  holidays: string;
  workingDays: string;
  clientName: string | null;
  clientLogo: string | null;
  tableLayout: string | null;
  createdAt: string;
}

function parseTableLayout(raw: string | null): TableLayout | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as TableLayout) : null;
  } catch {
    return null;
  }
}

function parseJsonArray<T>(raw: string, fallback: T[]): T[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as T[]) : fallback;
  } catch {
    return fallback;
  }
}

function mapProject(r: ProjectRow): Project {
  return {
    id: r.id,
    ownerId: r.ownerId ?? null,
    name: r.name,
    description: r.description,
    startDate: r.startDate,
    holidays: parseJsonArray<string>(r.holidays, []),
    workingDays: parseJsonArray<number>(r.workingDays, [1, 2, 3, 4, 5]),
    clientName: r.clientName ?? null,
    clientLogo: r.clientLogo ?? null,
    tableLayout: parseTableLayout(r.tableLayout ?? null),
    createdAt: r.createdAt,
  };
}

// --- Projects --------------------------------------------------------------

/** One user's plans, newest first. */
export async function listProjects(ownerId: string): Promise<Project[]> {
  return (await all<ProjectRow>("SELECT * FROM projects WHERE ownerId = ? ORDER BY createdAt DESC", ownerId)).map(
    mapProject,
  );
}

/**
 * Everything a plan needs, read in ONE round trip to the database (a batch), using
 * the same queries as getProject / listTasks / listDependencies / listResources /
 * listAssignments / listShareLinks / listAutomations.
 */
export async function loadProjectRows(projectId: string) {
  const results = await (await db()).batch(
    [
      { sql: "SELECT * FROM projects WHERE id = ?", args: [projectId] },
      { sql: "SELECT * FROM tasks WHERE projectId = ? ORDER BY sortOrder, createdAt", args: [projectId] },
      { sql: "SELECT * FROM dependencies WHERE projectId = ?", args: [projectId] },
      { sql: "SELECT * FROM resources WHERE projectId = ? ORDER BY name", args: [projectId] },
      {
        sql: "SELECT a.* FROM assignments a JOIN tasks t ON t.id = a.taskId WHERE t.projectId = ?",
        args: [projectId],
      },
      {
        sql: "SELECT * FROM share_links WHERE projectId = ? AND revokedAt IS NULL ORDER BY createdAt DESC",
        args: [projectId],
      },
      { sql: "SELECT * FROM automation_rules WHERE projectId = ? ORDER BY createdAt", args: [projectId] },
    ],
    "read",
  );
  const rows = <T,>(i: number) =>
    results[i].rows.map((row) => Object.fromEntries(results[i].columns.map((c, j) => [c, row[j]])) as T);

  const project = rows<ProjectRow>(0)[0];
  if (!project) return null;
  return {
    project: mapProject(project),
    tasks: rows<Task>(1),
    dependencies: rows<Dependency>(2),
    resources: rows<Resource>(3),
    assignments: rows<Assignment>(4),
    shareLinks: rows<ShareLink>(5),
    automations: rows<AutomationRule>(6),
  };
}

export async function getProject(id: string): Promise<Project | null> {
  const r = await get<ProjectRow>("SELECT * FROM projects WHERE id = ?", id);
  return r ? mapProject(r) : null;
}

export async function createProject(input: {
  ownerId: string;
  name: string;
  description?: string | null;
  startDate: string;
  holidays?: string[];
  workingDays?: number[];
}): Promise<Project> {
  const id = newId();
  await run(
    `INSERT INTO projects (id, ownerId, name, description, startDate, holidays, workingDays, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.ownerId,
    input.name,
    input.description ?? null,
    input.startDate,
    JSON.stringify(input.holidays ?? []),
    JSON.stringify(input.workingDays ?? [1, 2, 3, 4, 5]),
    now(),
  );
  return (await getProject(id))!;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<Project | null> {
  const existing = await getProject(id);
  if (!existing) return null;
  // Ownership is never changed through a plan edit.
  const merged = { ...existing, ...patch, ownerId: existing.ownerId };
  await run(
    `UPDATE projects SET name = ?, description = ?, startDate = ?, holidays = ?, workingDays = ?,
       clientName = ?, clientLogo = ?, tableLayout = ?
     WHERE id = ?`,
    merged.name,
    merged.description,
    merged.startDate,
    JSON.stringify(merged.holidays),
    JSON.stringify(merged.workingDays),
    merged.clientName,
    merged.clientLogo,
    merged.tableLayout ? JSON.stringify(merged.tableLayout) : null,
    id,
  );
  return getProject(id);
}

export async function deleteProject(id: string) {
  await run("DELETE FROM projects WHERE id = ?", id);
}

/** Which plan a task / link / team member / rule belongs to — used for access checks. */
export async function projectIdFor(
  kind: "task" | "dependency" | "resource" | "automation",
  id: string,
): Promise<string | null> {
  const table = { task: "tasks", dependency: "dependencies", resource: "resources", automation: "automation_rules" }[kind];
  const r = await get<{ projectId: string }>(`SELECT projectId FROM ${table} WHERE id = ?`, id);
  return r?.projectId ?? null;
}

/** True when every id is a task (or resource) of the given plan. Guards against cross-plan links. */
export async function allBelongToProject(kind: "task" | "resource", ids: string[], projectId: string): Promise<boolean> {
  const unique = [...new Set(ids)];
  if (!unique.length) return true;
  const table = kind === "task" ? "tasks" : "resources";
  const r = await get<{ n: number }>(
    `SELECT COUNT(*) AS n FROM ${table} WHERE projectId = ? AND id IN (${unique.map(() => "?").join(",")})`,
    projectId,
    ...unique,
  );
  return Number(r?.n ?? 0) === unique.length;
}

// --- Users -----------------------------------------------------------------

interface UserRow extends User {
  passwordHash: string | null;
  inviteTokenHash: string | null;
  inviteExpiresAt: string | null;
  failedLogins: number;
  lockedUntil: string | null;
}

/** Fields only the auth code needs; never sent to the browser. */
export type UserAuthRecord = UserRow;

function publicUser(r: UserRow): User {
  return {
    id: r.id,
    email: r.email,
    name: r.name,
    role: r.role,
    status: r.status,
    sessionVersion: Number(r.sessionVersion),
    createdAt: r.createdAt,
    lastLoginAt: r.lastLoginAt,
  };
}

export async function getUserById(id: string): Promise<User | null> {
  const r = await get<UserRow>("SELECT * FROM users WHERE id = ?", id);
  return r ? publicUser(r) : null;
}

export async function getUserAuthByEmail(email: string): Promise<UserAuthRecord | null> {
  return get<UserRow>("SELECT * FROM users WHERE email = ?", email.trim().toLowerCase());
}

export async function getUserAuthByInviteHash(tokenHash: string): Promise<UserAuthRecord | null> {
  return get<UserRow>("SELECT * FROM users WHERE inviteTokenHash = ?", tokenHash);
}

export async function listUsersWithStats(): Promise<UserWithStats[]> {
  const rows = await all<UserRow & { planCount: number }>(
    `SELECT u.*, (SELECT COUNT(*) FROM projects p WHERE p.ownerId = u.id) AS planCount
     FROM users u ORDER BY u.role = 'admin' DESC, u.createdAt DESC`,
  );
  const nowIso = now();
  return rows.map((r) => ({
    ...publicUser(r),
    planCount: Number(r.planCount),
    hasPendingLink: !!r.inviteTokenHash && !!r.inviteExpiresAt && r.inviteExpiresAt > nowIso,
  }));
}

export async function createInvitedUser(input: { email: string; name: string; role?: UserRole }): Promise<User> {
  const id = newId();
  await run(
    "INSERT INTO users (id, email, name, role, status, createdAt) VALUES (?, ?, ?, ?, 'invited', ?)",
    id,
    input.email.trim().toLowerCase(),
    input.name.trim(),
    input.role ?? "user",
    now(),
  );
  return (await getUserById(id))!;
}

/** Stores a fresh invite / reset link (hash only) valid for `days`. */
export async function setInviteToken(userId: string, tokenHash: string, days = 7) {
  const expires = new Date(Date.now() + days * 86_400_000).toISOString();
  await run("UPDATE users SET inviteTokenHash = ?, inviteExpiresAt = ? WHERE id = ?", tokenHash, expires, userId);
}

/** Sets a password, activates the account, clears the link and signs out other sessions. */
export async function setPasswordAndActivate(userId: string, passwordHash: string): Promise<User> {
  await run(
    `UPDATE users SET passwordHash = ?, status = 'active', inviteTokenHash = NULL, inviteExpiresAt = NULL,
       failedLogins = 0, lockedUntil = NULL, sessionVersion = sessionVersion + 1
     WHERE id = ?`,
    passwordHash,
    userId,
  );
  return (await getUserById(userId))!;
}

/** Disabling (or re-enabling) signs the user out everywhere. */
export async function setUserStatus(userId: string, status: UserStatus) {
  await run("UPDATE users SET status = ?, sessionVersion = sessionVersion + 1 WHERE id = ?", status, userId);
}

/** Invalidates every existing session for the user (used by password reset). */
export async function bumpSessionVersion(userId: string) {
  await run("UPDATE users SET sessionVersion = sessionVersion + 1 WHERE id = ?", userId);
}

/** Deletes the user and every plan they own (tasks etc. cascade). */
export async function deleteUserAndPlans(userId: string) {
  await transaction([
    { sql: "DELETE FROM projects WHERE ownerId = ?", args: [userId] },
    { sql: "DELETE FROM users WHERE id = ?", args: [userId] },
  ]);
}

export async function recordLoginSuccess(userId: string) {
  await run("UPDATE users SET failedLogins = 0, lockedUntil = NULL, lastLoginAt = ? WHERE id = ?", now(), userId);
}

/** Counts a failed sign-in; locks the account for `lockMinutes` once it reaches `maxAttempts`. */
export async function recordLoginFailure(user: UserAuthRecord, maxAttempts = 10, lockMinutes = 15) {
  const failed = Number(user.failedLogins) + 1;
  if (failed >= maxAttempts) {
    const lockUntil = new Date(Date.now() + lockMinutes * 60_000).toISOString();
    await run("UPDATE users SET failedLogins = 0, lockedUntil = ? WHERE id = ?", lockUntil, user.id);
  } else {
    await run("UPDATE users SET failedLogins = ? WHERE id = ?", failed, user.id);
  }
}

// --- Tasks -----------------------------------------------------------------

export type MoveRequest =
  | { direction: "up" | "down" }
  | { targetId: string; position: "before" | "after" };

/**
 * Moves a task among its siblings (up/down), or next to another task — taking that
 * task's parent (drag and drop). The affected sibling group is renumbered 10, 20, 30…
 * in one transaction, so repeated quick moves can never leave duplicate positions.
 */
export async function moveTask(
  taskId: string,
  move: MoveRequest,
): Promise<{ ok: true; projectId: string } | { ok: false; error: string }> {
  const moving = await getTask(taskId);
  if (!moving) return { ok: false, error: "Task not found." };
  const tasks = await listTasks(moving.projectId);
  const bySort = (a: Task, b: Task) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt);
  const childrenOf = (parentId: string | null) =>
    tasks.filter((t) => (t.parentId ?? null) === parentId && t.id !== taskId).sort(bySort);

  let parentId = moving.parentId ?? null;
  let order: Task[];

  if ("direction" in move) {
    const siblings = [...childrenOf(parentId), moving].sort(bySort);
    const i = siblings.findIndex((t) => t.id === taskId);
    const j = move.direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= siblings.length) return { ok: true, projectId: moving.projectId }; // already at the edge
    [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
    order = siblings;
  } else {
    const target = tasks.find((t) => t.id === move.targetId);
    if (!target) return { ok: false, error: "That task isn't in this plan." };
    if (target.id === taskId) return { ok: true, projectId: moving.projectId };
    // Dropping a task inside its own sub-tasks would cut that branch off the plan.
    const byId = new Map(tasks.map((t) => [t.id, t]));
    for (let cur: Task | undefined = target, guard = 0; cur && guard < 1000; guard++) {
      if (cur.id === taskId) return { ok: false, error: "A task can't be moved inside its own sub-tasks." };
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    parentId = target.parentId ?? null;
    const siblings = childrenOf(parentId);
    const at = siblings.findIndex((t) => t.id === target.id) + (move.position === "after" ? 1 : 0);
    siblings.splice(at, 0, moving);
    order = siblings;
  }

  await transaction([
    { sql: "UPDATE tasks SET parentId = ? WHERE id = ?", args: [parentId, taskId] },
    ...order.map((t, i) => ({ sql: "UPDATE tasks SET sortOrder = ? WHERE id = ?", args: [(i + 1) * 10, t.id] })),
  ]);
  return { ok: true, projectId: moving.projectId };
}

export async function listTasks(projectId: string): Promise<Task[]> {
  return all<Task>("SELECT * FROM tasks WHERE projectId = ? ORDER BY sortOrder, createdAt", projectId);
}

export async function countTasks(projectId: string): Promise<number> {
  return (await get<{ n: number }>("SELECT COUNT(*) AS n FROM tasks WHERE projectId = ?", projectId))?.n ?? 0;
}

export async function getTask(id: string): Promise<Task | null> {
  return get<Task>("SELECT * FROM tasks WHERE id = ?", id);
}

export async function createTask(input: {
  projectId: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  duration?: number;
  constraintType?: ConstraintType;
  constraintDate?: string | null;
  percentComplete?: number;
  notes?: string | null;
}): Promise<Task> {
  const id = newId();
  const order =
    input.sortOrder ??
    ((await get<{ m: number }>("SELECT COALESCE(MAX(sortOrder), 0) AS m FROM tasks WHERE projectId = ?", input.projectId))!
      .m +
      10);
  await run(
    `INSERT INTO tasks (id, projectId, parentId, sortOrder, name, duration, constraintType,
                        constraintDate, percentComplete, notes, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.projectId,
    input.parentId ?? null,
    order,
    input.name,
    input.duration ?? 1,
    input.constraintType ?? "ASAP",
    input.constraintDate ?? null,
    input.percentComplete ?? 0,
    input.notes ?? null,
    now(),
  );
  return (await getTask(id))!;
}

const TASK_FIELDS = [
  "parentId",
  "sortOrder",
  "name",
  "duration",
  "constraintType",
  "constraintDate",
  "percentComplete",
  "status",
  "notes",
  "objectives",
  "guidance",
  "remarks",
  "risk",
  "baselineStart",
  "baselineFinish",
  "baselineDuration",
] as const;

export async function updateTask(id: string, patch: Partial<Task>): Promise<Task | null> {
  const keys = TASK_FIELDS.filter((k) => k in patch);
  if (!keys.length) return getTask(id);
  const sql = `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  await run(sql, ...keys.map((k) => (patch as Record<string, unknown>)[k]), id);
  return getTask(id);
}

export async function deleteTask(id: string) {
  await run("DELETE FROM tasks WHERE id = ?", id);
}

/** Persist current computed dates as the baseline for every task in a project. */
export async function saveBaseline(
  projectId: string,
  computed: { id: string; start: string; finish: string; duration: number }[],
) {
  await transaction(
    computed.map((t) => ({
      sql: "UPDATE tasks SET baselineStart = ?, baselineFinish = ?, baselineDuration = ? WHERE id = ? AND projectId = ?",
      args: [t.start, t.finish, t.duration, t.id, projectId],
    })),
  );
}

export async function clearBaseline(projectId: string) {
  await run(
    "UPDATE tasks SET baselineStart = NULL, baselineFinish = NULL, baselineDuration = NULL WHERE projectId = ?",
    projectId,
  );
}

// --- Dependencies ----------------------------------------------------------

export async function listDependencies(projectId: string): Promise<Dependency[]> {
  return all<Dependency>("SELECT * FROM dependencies WHERE projectId = ?", projectId);
}

export async function createDependency(input: {
  projectId: string;
  predecessorId: string;
  successorId: string;
  type?: DependencyType;
  lag?: number;
}): Promise<Dependency | null> {
  if (input.predecessorId === input.successorId) return null;
  await run(
    `INSERT INTO dependencies (id, projectId, predecessorId, successorId, type, lag)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(predecessorId, successorId) DO UPDATE SET type = excluded.type, lag = excluded.lag`,
    newId(),
    input.projectId,
    input.predecessorId,
    input.successorId,
    input.type ?? "FS",
    input.lag ?? 0,
  );
  return get<Dependency>(
    "SELECT * FROM dependencies WHERE predecessorId = ? AND successorId = ?",
    input.predecessorId,
    input.successorId,
  );
}

export async function getDependency(id: string): Promise<Dependency | null> {
  return get<Dependency>("SELECT * FROM dependencies WHERE id = ?", id);
}

export async function deleteDependency(id: string) {
  await run("DELETE FROM dependencies WHERE id = ?", id);
}

// --- Resources & assignments ----------------------------------------------

export async function listResources(projectId: string): Promise<Resource[]> {
  return all<Resource>("SELECT * FROM resources WHERE projectId = ? ORDER BY name", projectId);
}

export async function createResource(input: {
  projectId: string;
  name: string;
  email?: string | null;
  role?: string | null;
  dayRate?: number;
}): Promise<Resource> {
  const id = newId();
  await run(
    "INSERT INTO resources (id, projectId, name, email, role, dayRate) VALUES (?, ?, ?, ?, ?, ?)",
    id,
    input.projectId,
    input.name,
    input.email ?? null,
    input.role ?? null,
    input.dayRate ?? 0,
  );
  return (await get<Resource>("SELECT * FROM resources WHERE id = ?", id))!;
}

export async function getResource(id: string): Promise<Resource | null> {
  return get<Resource>("SELECT * FROM resources WHERE id = ?", id);
}

export async function updateResource(id: string, patch: Partial<Resource>): Promise<Resource | null> {
  const cur = await get<Resource>("SELECT * FROM resources WHERE id = ?", id);
  if (!cur) return null;
  const m = { ...cur, ...patch };
  await run(
    "UPDATE resources SET name = ?, email = ?, role = ?, dayRate = ? WHERE id = ?",
    m.name,
    m.email,
    m.role,
    m.dayRate,
    id,
  );
  return get<Resource>("SELECT * FROM resources WHERE id = ?", id);
}

export async function deleteResource(id: string) {
  await run("DELETE FROM resources WHERE id = ?", id);
}

export async function listAssignments(projectId: string): Promise<Assignment[]> {
  return all<Assignment>(
    `SELECT a.* FROM assignments a JOIN tasks t ON t.id = a.taskId WHERE t.projectId = ?`,
    projectId,
  );
}

export async function setTaskAssignments(taskId: string, resourceIds: string[]) {
  await transaction([
    { sql: "DELETE FROM assignments WHERE taskId = ?", args: [taskId] },
    ...resourceIds.map((rid) => ({
      sql: "INSERT INTO assignments (id, taskId, resourceId, units) VALUES (?, ?, ?, 100)",
      args: [newId(), taskId, rid],
    })),
  ]);
}

// --- Email action tokens ---------------------------------------------------

export interface UpdateToken {
  token: string;
  projectId: string;
  taskId: string | null;
  recipientEmail: string;
  action: string;
  payload: string | null;
  expiresAt: string;
  usedAt: string | null;
  createdAt: string;
}

export async function createUpdateToken(input: {
  projectId: string;
  taskId?: string | null;
  recipientEmail: string;
  action: string;
  payload?: string | null;
  ttlDays?: number;
}): Promise<UpdateToken> {
  const token = randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + (input.ttlDays ?? 14) * 86_400_000).toISOString();
  await run(
    `INSERT INTO update_tokens (token, projectId, taskId, recipientEmail, action, payload, expiresAt, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    token,
    input.projectId,
    input.taskId ?? null,
    input.recipientEmail,
    input.action,
    input.payload ?? null,
    expires,
    now(),
  );
  return (await getUpdateToken(token))!;
}

export async function getUpdateToken(token: string): Promise<UpdateToken | null> {
  return get<UpdateToken>("SELECT * FROM update_tokens WHERE token = ?", token);
}

export async function consumeUpdateToken(token: string) {
  await run("UPDATE update_tokens SET usedAt = ? WHERE token = ?", now(), token);
}

// --- Share links -----------------------------------------------------------

export async function listShareLinks(projectId: string): Promise<ShareLink[]> {
  return all<ShareLink>(
    "SELECT * FROM share_links WHERE projectId = ? AND revokedAt IS NULL ORDER BY createdAt DESC",
    projectId,
  );
}

async function getShareLink(token: string): Promise<ShareLink | null> {
  return get<ShareLink>("SELECT * FROM share_links WHERE token = ?", token);
}

export async function createShareLink(projectId: string, label?: string | null): Promise<ShareLink> {
  const token = randomUUID().replace(/-/g, "");
  await run(
    "INSERT INTO share_links (token, projectId, label, createdAt) VALUES (?, ?, ?, ?)",
    token,
    projectId,
    label ?? null,
    now(),
  );
  return (await getShareLink(token))!;
}

/**
 * A personal read-only link for one stakeholder. Re-inviting the same address
 * reuses their active link, so the link in an older email keeps working.
 */
export async function createInvite(projectId: string, email: string, message?: string | null): Promise<ShareLink> {
  const existing = await get<ShareLink>(
    "SELECT * FROM share_links WHERE projectId = ? AND email = ? AND revokedAt IS NULL",
    projectId,
    email,
  );
  if (existing) {
    await run("UPDATE share_links SET message = ? WHERE token = ?", message ?? null, existing.token);
    return (await getShareLink(existing.token))!;
  }
  const token = randomUUID().replace(/-/g, "");
  await run(
    "INSERT INTO share_links (token, projectId, label, email, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    token,
    projectId,
    email,
    email,
    message ?? null,
    now(),
  );
  return (await getShareLink(token))!;
}

/** Returns the link only if it exists and has not been revoked. */
export async function getActiveShareLink(token: string): Promise<ShareLink | null> {
  return get<ShareLink>("SELECT * FROM share_links WHERE token = ? AND revokedAt IS NULL", token);
}

export async function markInviteSent(token: string) {
  await run("UPDATE share_links SET lastSentAt = ? WHERE token = ?", now(), token);
}

/** Counts visits, not page loads: refreshes within 30 minutes of the last view don't add one. */
export async function markShareViewed(token: string) {
  const visitGap = new Date(Date.now() - 30 * 60_000).toISOString();
  await run(
    `UPDATE share_links
       SET viewCount = COALESCE(viewCount, 0) + CASE WHEN lastViewedAt IS NULL OR lastViewedAt < ? THEN 1 ELSE 0 END,
           lastViewedAt = ?
     WHERE token = ?`,
    visitGap,
    now(),
    token,
  );
}

export async function revokeShareLink(token: string) {
  await run("UPDATE share_links SET revokedAt = ? WHERE token = ?", now(), token);
}

// --- Automation rules ------------------------------------------------------

export async function listAutomations(projectId: string): Promise<AutomationRule[]> {
  return all<AutomationRule>("SELECT * FROM automation_rules WHERE projectId = ? ORDER BY createdAt", projectId);
}

export async function listEnabledAutomations(): Promise<AutomationRule[]> {
  return all<AutomationRule>("SELECT * FROM automation_rules WHERE enabled = 1");
}

export async function getAutomation(id: string): Promise<AutomationRule | null> {
  return get<AutomationRule>("SELECT * FROM automation_rules WHERE id = ?", id);
}

export async function createAutomation(
  input: Omit<AutomationRule, "id" | "createdAt" | "lastRunAt">,
): Promise<AutomationRule> {
  const id = newId();
  await run(
    `INSERT INTO automation_rules
       (id, projectId, name, trigger, triggerDays, triggerStatus, action, actionEmails,
        includeButtons, enabled, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    input.projectId,
    input.name,
    input.trigger,
    input.triggerDays,
    input.triggerStatus,
    input.action,
    input.actionEmails,
    input.includeButtons,
    input.enabled,
    now(),
  );
  return (await getAutomation(id))!;
}

export async function updateAutomation(id: string, patch: Partial<AutomationRule>): Promise<AutomationRule | null> {
  const cur = await getAutomation(id);
  if (!cur) return null;
  const m = { ...cur, ...patch };
  await run(
    `UPDATE automation_rules SET name = ?, trigger = ?, triggerDays = ?, triggerStatus = ?,
      action = ?, actionEmails = ?, includeButtons = ?, enabled = ? WHERE id = ?`,
    m.name,
    m.trigger,
    m.triggerDays,
    m.triggerStatus,
    m.action,
    m.actionEmails,
    m.includeButtons,
    m.enabled,
    id,
  );
  return getAutomation(id);
}

export async function deleteAutomation(id: string) {
  await run("DELETE FROM automation_rules WHERE id = ?", id);
}

export async function markAutomationRun(id: string) {
  await run("UPDATE automation_rules SET lastRunAt = ? WHERE id = ?", now(), id);
}

/**
 * Records that a rule notified someone about a task today. Returns false if it
 * already had — the caller skips the send, so a rule running hourly does not
 * spam people.
 */
export async function claimAutomationSend(
  ruleId: string,
  taskId: string | null,
  recipient: string,
  onDate: string,
): Promise<boolean> {
  try {
    await run(
      "INSERT INTO automation_log (id, ruleId, taskId, recipient, onDate, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      newId(),
      ruleId,
      // SQLite treats NULLs as distinct in a UNIQUE index, so project-level
      // sends use "" rather than null to make the constraint actually bite.
      taskId ?? "",
      recipient,
      onDate,
      now(),
    );
    return true;
  } catch {
    return false;
  }
}

// --- Activity log ----------------------------------------------------------

export interface ActivityEntry {
  id: string;
  projectId: string;
  taskId: string | null;
  actor: string;
  message: string;
  createdAt: string;
}

export async function logActivity(input: { projectId: string; taskId?: string | null; actor: string; message: string }) {
  await run(
    "INSERT INTO activity (id, projectId, taskId, actor, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
    newId(),
    input.projectId,
    input.taskId ?? null,
    input.actor,
    input.message,
    now(),
  );
}

export async function listActivity(projectId: string, limit = 50): Promise<ActivityEntry[]> {
  return all<ActivityEntry>(
    "SELECT * FROM activity WHERE projectId = ? ORDER BY createdAt DESC LIMIT ?",
    projectId,
    limit,
  );
}
