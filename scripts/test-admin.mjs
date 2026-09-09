/**
 * Admin console auth — credentials + signed session tokens.
 * Run: npm run test:admin
 */
import {
  ADMIN_SESSION_TTL_MS,
  adminCredentials,
  adminUsingDefaults,
  signAdminToken,
  verifyAdminCredentials,
  verifyAdminToken,
} from "../src/lib/adminAuth.ts";
import { cronLabel, nextCronRun } from "../src/lib/cronSchedule.ts";

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const env = { ADMIN_PANEL_USER: "ops", ADMIN_PANEL_PASSWORD: "s3cret", EBAY_TOKEN_KEY: "k" };
const creds = adminCredentials(env);
check("env credentials win", creds, { user: "ops", password: "s3cret" });
check("defaults when unset", adminCredentials({}), { user: "admin", password: "password" });
check("defaults flagged", adminUsingDefaults({}), true);
check("custom not flagged", adminUsingDefaults(env), false);
check("correct login", verifyAdminCredentials("ops", "s3cret", creds), true);
check("username case-insensitive, trimmed", verifyAdminCredentials("  OPS ", "s3cret", creds), true);
check("password case-sensitive", verifyAdminCredentials("ops", "S3cret", creds), false);
check("wrong user", verifyAdminCredentials("admin", "s3cret", creds), false);
check("empty rejected", verifyAdminCredentials("", "", creds), false);

const now = 1_700_000_000_000;
const { token, expiresAt } = signAdminToken(now, creds, env);
check("expiry = now + ttl", expiresAt, now + ADMIN_SESSION_TTL_MS);
check("valid token verifies", verifyAdminToken(token, now + 1000, creds, env), true);
check("expired token rejected", verifyAdminToken(token, expiresAt + 1, creds, env), false);
check("tampered expiry rejected", verifyAdminToken(`${expiresAt + 5}.${token.split(".")[1]}`, now, creds, env), false);
check("tampered mac rejected", verifyAdminToken(`${expiresAt}.AAAA`, now, creds, env), false);
check("password change invalidates sessions", verifyAdminToken(token, now, { user: "ops", password: "other" }, env), false);
check("garbage rejected", [verifyAdminToken(undefined), verifyAdminToken(""), verifyAdminToken("nodot"), verifyAdminToken(".x")], [false, false, false, false]);

// /admin/system's cron schedule — vercel.json's "M H * * *" shape, UTC.
const t = Date.UTC(2026, 8, 9, 8, 0); // 2026-09-09 08:00Z
check("cron later today", nextCronRun("45 9 * * *", t), Date.UTC(2026, 8, 9, 9, 45));
check("cron already passed → tomorrow", nextCronRun("0 9 * * *", Date.UTC(2026, 8, 9, 9, 0)), Date.UTC(2026, 8, 10, 9, 0));
check("cron exactly now → tomorrow", nextCronRun("0 8 * * *", t), Date.UTC(2026, 8, 10, 8, 0));
check("non-daily shape is not guessed", [nextCronRun("*/15 * * * *", t), nextCronRun("0 9 * * 1", t), nextCronRun("99 9 * * *", t)], [null, null, null]);
check("cron label", [cronLabel("45 9 * * *"), cronLabel("0 9 * * *"), cronLabel("*/15 * * * *")], ["09:45 UTC daily", "09:00 UTC daily", "*/15 * * * *"]);

console.log(failures === 0 ? "\nAll admin checks passed" : `\n${failures} admin check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
