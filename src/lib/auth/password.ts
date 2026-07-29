import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Password hashing with Node's built-in scrypt — no external dependency.
// Stored format: "<saltHex>:<derivedKeyHex>".

const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, KEYLEN).toString("hex");
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(":");
  if (!salt || !key) return false;
  const derived = scryptSync(password, salt, KEYLEN);
  const keyBuf = Buffer.from(key, "hex");
  // Constant-time compare; guard against length mismatch.
  return keyBuf.length === derived.length && timingSafeEqual(keyBuf, derived);
}
