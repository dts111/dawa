// SQLite storage layer. One file on disk, no server, no monthly bill.
//
// Every query is written in plain SQL and confined to this file, so swapping
// SQLite for Postgres later means rewriting this module only — nothing in the
// UI or the scheduling engine knows which database is underneath.

import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Assignment,
  AutomationRule,
  ConstraintType,
  Dependency,
  DependencyType,
  Project,
  Resource,
  ShareLink,
  Task,
  TaskStatus,
} from "./types";

const DB_PATH = process.env.DATABASE_FILE ?? path.join(process.cwd(), "data", "eaas-pm.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function migrate(d: Database.Database) {
  d.exec(`
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

    -- Public read-only links, so the wider team can see a plan before logins exist.
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
  `);

  addColumnIfMissing(d, "tasks", "status", "TEXT");
  addColumnIfMissing(d, "tasks", "objectives", "TEXT");
  addColumnIfMissing(d, "tasks", "guidance", "TEXT");
  addColumnIfMissing(d, "tasks", "remarks", "TEXT");
  addColumnIfMissing(d, "tasks", "risk", "TEXT");
}

/** SQLite has no "ADD COLUMN IF NOT EXISTS", so check the table info first. */
function addColumnIfMissing(d: Database.Database, table: string, column: string, type: string) {
  const cols = d.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) {
    d.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
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
  name: string;
  description: string | null;
  startDate: string;
  holidays: string;
  workingDays: string;
  createdAt: string;
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
    name: r.name,
    description: r.description,
    startDate: r.startDate,
    holidays: parseJsonArray<string>(r.holidays, []),
    workingDays: parseJsonArray<number>(r.workingDays, [1, 2, 3, 4, 5]),
    createdAt: r.createdAt,
  };
}

// --- Projects --------------------------------------------------------------

export function listProjects(): Project[] {
  return (getDb().prepare("SELECT * FROM projects ORDER BY createdAt DESC").all() as ProjectRow[]).map(
    mapProject,
  );
}

export function getProject(id: string): Project | null {
  const r = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id) as ProjectRow | undefined;
  return r ? mapProject(r) : null;
}

export function createProject(input: {
  name: string;
  description?: string | null;
  startDate: string;
  holidays?: string[];
  workingDays?: number[];
}): Project {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO projects (id, name, description, startDate, holidays, workingDays, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.name,
      input.description ?? null,
      input.startDate,
      JSON.stringify(input.holidays ?? []),
      JSON.stringify(input.workingDays ?? [1, 2, 3, 4, 5]),
      now(),
    );
  return getProject(id)!;
}

export function updateProject(id: string, patch: Partial<Project>): Project | null {
  const existing = getProject(id);
  if (!existing) return null;
  const merged = { ...existing, ...patch };
  getDb()
    .prepare(
      `UPDATE projects SET name = ?, description = ?, startDate = ?, holidays = ?, workingDays = ?
       WHERE id = ?`,
    )
    .run(
      merged.name,
      merged.description,
      merged.startDate,
      JSON.stringify(merged.holidays),
      JSON.stringify(merged.workingDays),
      id,
    );
  return getProject(id);
}

export function deleteProject(id: string) {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

// --- Tasks -----------------------------------------------------------------

export function listTasks(projectId: string): Task[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE projectId = ? ORDER BY sortOrder, createdAt")
    .all(projectId) as Task[];
}

export function getTask(id: string): Task | null {
  return (getDb().prepare("SELECT * FROM tasks WHERE id = ?").get(id) as Task) ?? null;
}

export function createTask(input: {
  projectId: string;
  name: string;
  parentId?: string | null;
  sortOrder?: number;
  duration?: number;
  constraintType?: ConstraintType;
  constraintDate?: string | null;
  percentComplete?: number;
  notes?: string | null;
}): Task {
  const id = newId();
  const order =
    input.sortOrder ??
    ((
      getDb()
        .prepare("SELECT COALESCE(MAX(sortOrder), 0) AS m FROM tasks WHERE projectId = ?")
        .get(input.projectId) as { m: number }
    ).m +
      10);
  getDb()
    .prepare(
      `INSERT INTO tasks (id, projectId, parentId, sortOrder, name, duration, constraintType,
                          constraintDate, percentComplete, notes, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
  return getTask(id)!;
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

export function updateTask(id: string, patch: Partial<Task>): Task | null {
  const keys = TASK_FIELDS.filter((k) => k in patch);
  if (!keys.length) return getTask(id);
  const sql = `UPDATE tasks SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`;
  getDb()
    .prepare(sql)
    .run(...keys.map((k) => (patch as Record<string, unknown>)[k] as never), id);
  return getTask(id);
}

export function deleteTask(id: string) {
  getDb().prepare("DELETE FROM tasks WHERE id = ?").run(id);
}

/** Persist current computed dates as the baseline for every task in a project. */
export function saveBaseline(projectId: string, computed: { id: string; start: string; finish: string; duration: number }[]) {
  const d = getDb();
  const stmt = d.prepare(
    "UPDATE tasks SET baselineStart = ?, baselineFinish = ?, baselineDuration = ? WHERE id = ? AND projectId = ?",
  );
  const tx = d.transaction(() => {
    for (const t of computed) stmt.run(t.start, t.finish, t.duration, t.id, projectId);
  });
  tx();
}

export function clearBaseline(projectId: string) {
  getDb()
    .prepare(
      "UPDATE tasks SET baselineStart = NULL, baselineFinish = NULL, baselineDuration = NULL WHERE projectId = ?",
    )
    .run(projectId);
}

// --- Dependencies ----------------------------------------------------------

export function listDependencies(projectId: string): Dependency[] {
  return getDb().prepare("SELECT * FROM dependencies WHERE projectId = ?").all(projectId) as Dependency[];
}

export function createDependency(input: {
  projectId: string;
  predecessorId: string;
  successorId: string;
  type?: DependencyType;
  lag?: number;
}): Dependency | null {
  if (input.predecessorId === input.successorId) return null;
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO dependencies (id, projectId, predecessorId, successorId, type, lag)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(predecessorId, successorId) DO UPDATE SET type = excluded.type, lag = excluded.lag`,
    )
    .run(id, input.projectId, input.predecessorId, input.successorId, input.type ?? "FS", input.lag ?? 0);
  return (
    (getDb()
      .prepare("SELECT * FROM dependencies WHERE predecessorId = ? AND successorId = ?")
      .get(input.predecessorId, input.successorId) as Dependency) ?? null
  );
}

export function deleteDependency(id: string) {
  getDb().prepare("DELETE FROM dependencies WHERE id = ?").run(id);
}

// --- Resources & assignments ----------------------------------------------

export function listResources(projectId: string): Resource[] {
  return getDb().prepare("SELECT * FROM resources WHERE projectId = ? ORDER BY name").all(projectId) as Resource[];
}

export function createResource(input: {
  projectId: string;
  name: string;
  email?: string | null;
  role?: string | null;
  dayRate?: number;
}): Resource {
  const id = newId();
  getDb()
    .prepare("INSERT INTO resources (id, projectId, name, email, role, dayRate) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, input.projectId, input.name, input.email ?? null, input.role ?? null, input.dayRate ?? 0);
  return getDb().prepare("SELECT * FROM resources WHERE id = ?").get(id) as Resource;
}

export function updateResource(id: string, patch: Partial<Resource>): Resource | null {
  const cur = getDb().prepare("SELECT * FROM resources WHERE id = ?").get(id) as Resource | undefined;
  if (!cur) return null;
  const m = { ...cur, ...patch };
  getDb()
    .prepare("UPDATE resources SET name = ?, email = ?, role = ?, dayRate = ? WHERE id = ?")
    .run(m.name, m.email, m.role, m.dayRate, id);
  return getDb().prepare("SELECT * FROM resources WHERE id = ?").get(id) as Resource;
}

export function deleteResource(id: string) {
  getDb().prepare("DELETE FROM resources WHERE id = ?").run(id);
}

export function listAssignments(projectId: string): Assignment[] {
  return getDb()
    .prepare(
      `SELECT a.* FROM assignments a JOIN tasks t ON t.id = a.taskId WHERE t.projectId = ?`,
    )
    .all(projectId) as Assignment[];
}

export function setTaskAssignments(taskId: string, resourceIds: string[]) {
  const d = getDb();
  const tx = d.transaction(() => {
    d.prepare("DELETE FROM assignments WHERE taskId = ?").run(taskId);
    const stmt = d.prepare("INSERT INTO assignments (id, taskId, resourceId, units) VALUES (?, ?, ?, 100)");
    for (const rid of resourceIds) stmt.run(newId(), taskId, rid);
  });
  tx();
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

export function createUpdateToken(input: {
  projectId: string;
  taskId?: string | null;
  recipientEmail: string;
  action: string;
  payload?: string | null;
  ttlDays?: number;
}): UpdateToken {
  const token = randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + (input.ttlDays ?? 14) * 86_400_000).toISOString();
  getDb()
    .prepare(
      `INSERT INTO update_tokens (token, projectId, taskId, recipientEmail, action, payload, expiresAt, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      token,
      input.projectId,
      input.taskId ?? null,
      input.recipientEmail,
      input.action,
      input.payload ?? null,
      expires,
      now(),
    );
  return getUpdateToken(token)!;
}

export function getUpdateToken(token: string): UpdateToken | null {
  return (getDb().prepare("SELECT * FROM update_tokens WHERE token = ?").get(token) as UpdateToken) ?? null;
}

export function consumeUpdateToken(token: string) {
  getDb().prepare("UPDATE update_tokens SET usedAt = ? WHERE token = ?").run(now(), token);
}

// --- Share links -----------------------------------------------------------

export function listShareLinks(projectId: string): ShareLink[] {
  return getDb()
    .prepare("SELECT * FROM share_links WHERE projectId = ? AND revokedAt IS NULL ORDER BY createdAt DESC")
    .all(projectId) as ShareLink[];
}

export function createShareLink(projectId: string, label?: string | null): ShareLink {
  const token = randomUUID().replace(/-/g, "");
  getDb()
    .prepare("INSERT INTO share_links (token, projectId, label, createdAt) VALUES (?, ?, ?, ?)")
    .run(token, projectId, label ?? null, now());
  return getDb().prepare("SELECT * FROM share_links WHERE token = ?").get(token) as ShareLink;
}

/** Returns the link only if it exists and has not been revoked. */
export function getActiveShareLink(token: string): ShareLink | null {
  return (
    (getDb()
      .prepare("SELECT * FROM share_links WHERE token = ? AND revokedAt IS NULL")
      .get(token) as ShareLink) ?? null
  );
}

export function revokeShareLink(token: string) {
  getDb().prepare("UPDATE share_links SET revokedAt = ? WHERE token = ?").run(now(), token);
}

// --- Automation rules ------------------------------------------------------

export function listAutomations(projectId: string): AutomationRule[] {
  return getDb()
    .prepare("SELECT * FROM automation_rules WHERE projectId = ? ORDER BY createdAt")
    .all(projectId) as AutomationRule[];
}

export function listEnabledAutomations(): AutomationRule[] {
  return getDb().prepare("SELECT * FROM automation_rules WHERE enabled = 1").all() as AutomationRule[];
}

export function getAutomation(id: string): AutomationRule | null {
  return (getDb().prepare("SELECT * FROM automation_rules WHERE id = ?").get(id) as AutomationRule) ?? null;
}

export function createAutomation(input: Omit<AutomationRule, "id" | "createdAt" | "lastRunAt">): AutomationRule {
  const id = newId();
  getDb()
    .prepare(
      `INSERT INTO automation_rules
         (id, projectId, name, trigger, triggerDays, triggerStatus, action, actionEmails,
          includeButtons, enabled, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
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
  return getAutomation(id)!;
}

export function updateAutomation(id: string, patch: Partial<AutomationRule>): AutomationRule | null {
  const cur = getAutomation(id);
  if (!cur) return null;
  const m = { ...cur, ...patch };
  getDb()
    .prepare(
      `UPDATE automation_rules SET name = ?, trigger = ?, triggerDays = ?, triggerStatus = ?,
        action = ?, actionEmails = ?, includeButtons = ?, enabled = ? WHERE id = ?`,
    )
    .run(
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

export function deleteAutomation(id: string) {
  getDb().prepare("DELETE FROM automation_rules WHERE id = ?").run(id);
}

export function markAutomationRun(id: string) {
  getDb().prepare("UPDATE automation_rules SET lastRunAt = ? WHERE id = ?").run(now(), id);
}

/**
 * Records that a rule notified someone about a task today. Returns false if it
 * already had — the caller skips the send, so a rule running hourly does not
 * spam people.
 */
export function claimAutomationSend(
  ruleId: string,
  taskId: string | null,
  recipient: string,
  onDate: string,
): boolean {
  try {
    getDb()
      .prepare(
        "INSERT INTO automation_log (id, ruleId, taskId, recipient, onDate, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      )
      // SQLite treats NULLs as distinct in a UNIQUE index, so project-level
      // sends use "" rather than null to make the constraint actually bite.
      .run(newId(), ruleId, taskId ?? "", recipient, onDate, now());
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

export function logActivity(input: {
  projectId: string;
  taskId?: string | null;
  actor: string;
  message: string;
}) {
  getDb()
    .prepare("INSERT INTO activity (id, projectId, taskId, actor, message, createdAt) VALUES (?, ?, ?, ?, ?, ?)")
    .run(newId(), input.projectId, input.taskId ?? null, input.actor, input.message, now());
}

export function listActivity(projectId: string, limit = 50): ActivityEntry[] {
  return getDb()
    .prepare("SELECT * FROM activity WHERE projectId = ? ORDER BY createdAt DESC LIMIT ?")
    .all(projectId, limit) as ActivityEntry[];
}
