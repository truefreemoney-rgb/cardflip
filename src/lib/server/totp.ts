// No "server-only" marker: scripts/test-totp.mjs imports this directly.
// Nothing here touches the DB or secrets — it's pure RFC math.
import crypto from "node:crypto";

/**
 * RFC 6238 TOTP for two-step verification — SHA-1, 30s step, 6 digits, the
 * parameters every authenticator app (Google Authenticator, Authy, 1Password,
 * Microsoft Authenticator) defaults to. No dependency: the whole algorithm is
 * one HMAC. Verification accepts the neighbouring steps (±1) so a code typed
 * near the boundary, or from a phone whose clock drifts a little, still works.
 */

const STEP_SECONDS = 30;
const DIGITS = 6;
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** 20 random bytes as base32 — the string the user's authenticator app stores. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | B32_ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code for one time step (default: now). */
export function totpCode(secret: string, atMs = Date.now(), stepOffset = 0): string {
  const counter = Math.floor(atMs / 1000 / STEP_SECONDS) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS).toString();
  return code.padStart(DIGITS, "0");
}

/** Constant-time check of a user-typed code against the current ±1 steps. */
export function verifyTotp(secret: string, input: string, atMs = Date.now()): boolean {
  const typed = input.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(typed)) return false;
  let ok = false;
  for (const offset of [0, -1, 1]) {
    const expect = totpCode(secret, atMs, offset);
    // No early exit — every candidate is compared so timing reveals nothing.
    if (crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(typed))) ok = true;
  }
  return ok;
}

/** The otpauth:// URL an authenticator app enrolls from (shown as a QR). */
export function otpauthUrl(email: string, secret: string): string {
  const label = encodeURIComponent(`CardFlip:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=CardFlip&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

/**
 * Backup codes (09-04): eight one-time codes handed over when two-step is
 * turned on, for the day the phone is gone. Stored hashed; a used code is
 * removed. Format "xxxxx-xxxxx" from the same base32 alphabet as the
 * secret, so there are no look-alike characters to mistype.
 */
export const BACKUP_CODE_COUNT = 8;

export function normalizeBackupCode(input: string): string {
  return input.replace(/[^a-z2-7]/gi, "").toUpperCase();
}

export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(normalizeBackupCode(code)).digest("hex");
}

export function generateBackupCodes(): { codes: string[]; hashes: string[] } {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const raw = base32Encode(crypto.randomBytes(7)).replace(/=+$/, "").slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`);
  }
  return { codes, hashes: codes.map(hashBackupCode) };
}
