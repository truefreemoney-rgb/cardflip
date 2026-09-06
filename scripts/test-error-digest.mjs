/**
 * Daily error-digest email — the one alert the site sends the owner.
 * Run: npm run test:errordigest
 *
 * Pins: nothing sent at or under the threshold; over it, the owner gets one
 * mail with the grouped rows; mail-not-configured is a quiet skip; a
 * throwing mailer never escapes (the cron must finish regardless); the
 * grouped query collapses repeats and orders by count.
 *
 * Throwaway db: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-errdigest-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { sendErrorDigestIfNeeded } = await import(at("lib/server/errorDigest.ts"));
const { reportServerError, errorGroups24h, errorCount24h } = await import(at("lib/server/errorLog.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

// --- grouped query ---------------------------------------------------------
for (let i = 0; i < 3; i++) await reportServerError("cron/pokemon", new Error("TCGCSV 502"));
await reportServerError("api/scan", new Error("vision timeout"));
check("count24h sees all rows", await errorCount24h(), 4);
const groups = await errorGroups24h();
check("groups collapse repeats, busiest first", groups.map((g) => [g.source, g.message, g.count]), [
  ["cron/pokemon", "TCGCSV 502", 3],
  ["api/scan", "vision timeout", 1],
]);

// --- threshold -------------------------------------------------------------
const sent = [];
const send = async (to, total, gs) => { sent.push({ to, total, n: gs.length }); };
const configured = () => true;

let r = await sendErrorDigestIfNeeded({ count: async () => 5, send, configured, min: 5 });
check("at threshold: not sent", [r.sent, sent.length], [false, 0]);
r = await sendErrorDigestIfNeeded({ count: async () => 0, send, configured, min: 0 });
check("zero errors with min 0: not sent", r.sent, false);

r = await sendErrorDigestIfNeeded({ count: async () => 6, groups: async () => groups, send, configured, min: 5 });
check("over threshold: one mail to the owner with the groups", [r.sent, sent], [true, [{ to: "truefreemoney@gmail.com", total: 6, n: 2 }]]);

process.env.ERROR_DIGEST_TO = "ops@example.com";
sent.length = 0;
await sendErrorDigestIfNeeded({ count: async () => 9, groups: async () => [], send, configured, min: 1 });
check("ERROR_DIGEST_TO overrides the recipient", sent[0]?.to, "ops@example.com");
delete process.env.ERROR_DIGEST_TO;

r = await sendErrorDigestIfNeeded({ count: async () => 99, send, configured: () => false, min: 1 });
check("mail unconfigured: quiet skip", [r.sent, r.reason], [false, "mail not configured"]);

// --- never throws ----------------------------------------------------------
const before = await errorCount24h();
r = await sendErrorDigestIfNeeded({ count: async () => 99, groups: async () => [], send: async () => { throw new Error("SMTP down"); }, configured, min: 1 });
check("mailer failure is swallowed and reported", [r.sent, r.reason, (await errorCount24h()) - before], [false, "SMTP down", 1]);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
