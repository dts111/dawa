// Single-admin session auth. One email/password pair from env, a signed
// cookie for the session — no user table, no external auth provider.

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

export function adminEmail(): string {
  return (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
}

export function checkCredentials(email: string, password: string): boolean {
  const admin = adminEmail();
  const expectedPassword = process.env.ADMIN_PASSWORD ?? "";
  if (!admin || !expectedPassword) return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), admin);
  const passwordOk = safeEqual(password, expectedPassword);
  return emailOk && passwordOk;
}

export function createSessionValue(email: string): string {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const payload = `${email}|${exp}`;
  return `${Buffer.from(payload, "utf8").toString("base64url")}.${sign(payload)}`;
}

export function verifySessionValue(value: string | undefined | null): { email: string } | null {
  if (!value) return null;
  const dot = value.lastIndexOf(".");
  if (dot < 0) return null;
  const encoded = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  const payload = Buffer.from(encoded, "base64url").toString("utf8");
  if (!safeEqual(sig, sign(payload))) return null;
  const bar = payload.lastIndexOf("|");
  if (bar < 0) return null;
  const email = payload.slice(0, bar);
  const exp = Number(payload.slice(bar + 1));
  if (!email || !Number.isFinite(exp) || Date.now() > exp) return null;
  return { email };
}
