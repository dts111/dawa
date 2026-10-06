// Session cookie: `userId|sessionVersion|expiry`, signed with SESSION_SECRET.
// This file only signs and checks the cookie (it's used by the proxy too); whether
// the user still exists, is active and has the same sessionVersion is checked
// against the database in src/lib/access.ts.

import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "eaas_session";
const SESSION_DAYS = 30;
export const SESSION_MAX_AGE = SESSION_DAYS * 86_400;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set.");
  return s;
}

function sign(value: string): string {
  return createHmac("sha256", secret()).update(value).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** The administrator's email from the environment; used to seed the admin account. */
export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

export function createSessionValue(userId: string, sessionVersion: number): string {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${userId}|${sessionVersion}|${exp}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export function verifySessionValue(
  value: string | undefined | null,
): { userId: string; sessionVersion: number } | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  if (!safeEqual(sig, sign(payload))) return null;
  const [userId, version, expiry] = payload.split("|");
  const sessionVersion = Number(version);
  const exp = Number(expiry);
  if (!userId || !Number.isInteger(sessionVersion) || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { userId, sessionVersion };
}

/** Cookie options shared by sign-in and invite acceptance. */
export function sessionCookieOptions() {
  return {
    httpOnly: true,
    // APP_URL, not NODE_ENV — `next start` sets NODE_ENV=production even for
    // plain-HTTP LAN/localhost use, and a Secure cookie would silently stop
    // being sent by the browser in that case.
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}
