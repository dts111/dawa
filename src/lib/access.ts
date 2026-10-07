// Who is signed in, and may they touch this plan? Every signed-in API route and
// page goes through these. The proxy only checks the cookie's signature; the
// checks against the database (account still active, not signed out) are here.

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "./auth";
import { getProject, getUserById, projectIdFor } from "./db";
import type { Project, User } from "./types";

/** The signed-in, active user — or null. */
export async function currentUser(): Promise<User | null> {
  const session = verifySessionValue((await cookies()).get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await getUserById(session.userId);
  if (!user || user.status !== "active" || user.sessionVersion !== session.sessionVersion) return null;
  return user;
}

const unauthorised = () => NextResponse.json({ error: "Sign in required." }, { status: 401 });
// 404 rather than 403, so another user's plan ids can't be confirmed by probing.
const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });

type Ok<T> = { ok: true } & T;
type Denied = { ok: false; response: NextResponse };

export async function requireUser(): Promise<Ok<{ user: User }> | Denied> {
  const user = await currentUser();
  return user ? { ok: true, user } : { ok: false, response: unauthorised() };
}

export async function requireAdmin(): Promise<Ok<{ user: User }> | Denied> {
  const user = await currentUser();
  if (!user) return { ok: false, response: unauthorised() };
  if (user.role !== "admin") return { ok: false, response: notFound() };
  return { ok: true, user };
}

/** The user owns the plan, or is the admin. */
export function canAccess(user: User, project: Pick<Project, "ownerId">): boolean {
  return user.role === "admin" || project.ownerId === user.id;
}

export async function requireProject(projectId: string): Promise<Ok<{ user: User; project: Project }> | Denied> {
  // In parallel: two lookups, one round trip's worth of waiting.
  const [user, project] = await Promise.all([currentUser(), getProject(projectId)]);
  if (!user) return { ok: false, response: unauthorised() };
  if (!project || !canAccess(user, project)) return { ok: false, response: notFound() };
  return { ok: true, user, project };
}

/** For routes keyed by a task / link / team member / rule id. */
export async function requireProjectOf(
  kind: "task" | "dependency" | "resource" | "automation",
  id: string,
): Promise<Ok<{ user: User; project: Project }> | Denied> {
  const projectId = await projectIdFor(kind, id);
  if (!projectId) {
    const user = await currentUser();
    return { ok: false, response: user ? notFound() : unauthorised() };
  }
  return requireProject(projectId);
}
