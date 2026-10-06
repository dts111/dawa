// Password hashing and one-time tokens, using only node:crypto.

import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const KEY_LENGTH = 64;
// N=2^15 is the current OWASP-recommended floor for scrypt; maxmem must be raised to fit it.
const PARAMS: ScryptOptions = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export { MIN_PASSWORD_LENGTH } from "./passwordRules";

function scrypt(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scryptCb(password, salt, KEY_LENGTH, PARAMS, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns `scrypt$<salt>$<hash>`, both base64url. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A random URL-safe token. Only its hash is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}
