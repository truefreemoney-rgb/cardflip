/**
 * Two-step verification (TOTP) — the RFC 6238 math behind login codes.
 * Run: npm run test:totp
 *
 * Pins: the RFC's own SHA-1 test vectors (Appendix B, truncated to our 6
 * digits), the ±1-step verify window with rejection outside it, input
 * hygiene (spaces ok, non-6-digit refused), base32 round-trip, secret
 * shape, and the otpauth URL an authenticator app enrolls from.
 */
import { base32Encode, generateTotpSecret, otpauthUrl, totpCode, verifyTotp, generateBackupCodes, hashBackupCode, normalizeBackupCode, BACKUP_CODE_COUNT } from "../src/lib/server/totp.ts";

let failures = 0;
function check(name, cond) {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures++;
    console.error(`  FAIL  ${name}`);
  }
}

// RFC 6238 Appendix B vectors use the ASCII secret "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));
check("rfc secret base32", RFC_SECRET === "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
// [unix seconds, full 8-digit value] — we compare our 6 digits to the tail.
for (const [t, eight] of [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
]) {
  check(`rfc vector T=${t}`, totpCode(RFC_SECRET, t * 1000) === eight.slice(-6));
}

// Verify window: current, previous, and next step pass; two steps out fails.
const NOW = 1234567890 * 1000;
const cur = totpCode(RFC_SECRET, NOW);
const prev = totpCode(RFC_SECRET, NOW, -1);
const next = totpCode(RFC_SECRET, NOW, +1);
const far = totpCode(RFC_SECRET, NOW, +2);
check("current code verifies", verifyTotp(RFC_SECRET, cur, NOW));
check("previous step verifies", verifyTotp(RFC_SECRET, prev, NOW));
check("next step verifies", verifyTotp(RFC_SECRET, next, NOW));
check("two steps out rejected", !verifyTotp(RFC_SECRET, far, NOW));
check("spaces tolerated", verifyTotp(RFC_SECRET, ` ${cur.slice(0, 3)} ${cur.slice(3)} `, NOW));
check("wrong code rejected", !verifyTotp(RFC_SECRET, cur === "000000" ? "000001" : "000000", NOW));
check("short input rejected", !verifyTotp(RFC_SECRET, cur.slice(0, 5), NOW));
check("non-digits rejected", !verifyTotp(RFC_SECRET, "abcdef", NOW));

// Secrets: 20 bytes -> 32 base32 chars, alphabet only, unique per call.
const s1 = generateTotpSecret();
const s2 = generateTotpSecret();
check("secret shape", /^[A-Z2-7]{32}$/.test(s1));
check("secrets unique", s1 !== s2);

// otpauth URL: scheme, issuer, secret, and an encoded label.
const url = otpauthUrl("chris@example.com", s1);
check("otpauth scheme+issuer", url.startsWith("otpauth://totp/CardFlip%3Achris%40example.com?") && url.includes("issuer=CardFlip"));
check("otpauth carries secret", url.includes(`secret=${s1}`));
check("otpauth standard params", url.includes("digits=6") && url.includes("period=30") && url.includes("algorithm=SHA1"));

// --- backup codes (09-04) ---------------------------------------------------
const bk = generateBackupCodes();
check("eight codes, eight hashes", bk.codes.length === BACKUP_CODE_COUNT && bk.hashes.length === BACKUP_CODE_COUNT);
check("codes look like xxxxx-xxxxx from the base32 alphabet", bk.codes.every((c) => /^[A-Z2-7]{5}-[A-Z2-7]{5}$/.test(c)));
check("codes are distinct", new Set(bk.codes).size === BACKUP_CODE_COUNT);
check("hash matches the code", bk.hashes[0] === hashBackupCode(bk.codes[0]));
check("hash ignores case, dashes and spaces", hashBackupCode(bk.codes[0].toLowerCase().replace("-", " ")) === bk.hashes[0]);
check("normalize strips everything but the alphabet", normalizeBackupCode(" ab-cd 23 ") === "ABCD23");
check("two runs differ", generateBackupCodes().codes[0] !== bk.codes[0]);

if (failures > 0) {
  console.error(`\n${failures} TOTP check(s) failed`);
  process.exit(1);
}
console.log("\nAll TOTP checks passed");
