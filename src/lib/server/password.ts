import "server-only";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { hasPassword } from "@/lib/googleAuth";

const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH).toString("hex");
  return `${salt}:${hash}`;
}

/**
 * The check for "type your password to confirm" on an account the person is already signed in to.
 * An account made with Google has no password to type (it set none), so the live session is the proof;
 * everyone else must match their password.
 */
export function confirmsPassword(password: string, stored: string): boolean {
  return !hasPassword(stored) || verifyPassword(password, stored);
}

/** No password we ever stored is longer than 200 characters; past this nothing is hashed (scrypt time grows with the input). */
const MAX_VERIFY_LENGTH = 1024;

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  if (password.length > MAX_VERIFY_LENGTH) return false;

  const candidate = scryptSync(password, salt, KEY_LENGTH);
  const expected = Buffer.from(hash, "hex");
  if (candidate.length !== expected.length) return false;

  return timingSafeEqual(candidate, expected);
}
