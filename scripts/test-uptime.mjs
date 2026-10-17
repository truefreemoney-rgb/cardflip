/**
 * 15-minute uptime ping (#57, 10-17).
 * Run: npm run test:uptime
 *
 * Pins: a probe that fails once then passes is not a failure (retry); one that fails twice is, with its detail;
 * every probe is tried; the alert still mails when the database can't be read or written (the outage being
 * reported must not silence its own alert); the hourly gap still holds when the database answers.
 */
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { runUptime, uptimeMessage } = await import(at("lib/server/uptime.ts"));
const { opsAlert, OPS_ALERT_GAP_MS } = await import(at("lib/server/opsAlert.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n      got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`}`);
}

const noSleep = { retryMs: 0, sleep: async () => {} };
const healthy = { label: "healthy", run: async () => {} };
let flakyCalls = 0;
const flaky = { label: "flaky", run: async () => { if (flakyCalls++ === 0) throw new Error("cold start"); } };
let deadCalls = 0;
const dead = { label: "database read", run: async () => { deadCalls++; throw new Error("SERVER_ERROR: blocked"); } };

const allGood = await runUptime([healthy, flaky], noSleep);
check("one failure then a pass = healthy (retry absorbs a cold start)", allGood, { ok: true, failures: [] });
check("the flaky probe ran twice", flakyCalls, 2);

const down = await runUptime([healthy, dead], noSleep);
check("a probe failing twice is reported", down, { ok: false, failures: [{ label: "database read", detail: "SERVER_ERROR: blocked" }] });
check("the dead probe was retried once", deadCalls, 2);
check("alert text names the probe", uptimeMessage(down).includes("database read: SERVER_ERROR: blocked"));

let waited = 0;
await runUptime([dead], { retryMs: 1234, sleep: async (ms) => { waited = ms; } });
check("retry waits the given gap", waited, 1234);

// opsAlert with a dead database
const sent = [];
const broken = { get: async () => { throw new Error("db down"); }, set: async () => { throw new Error("db down"); }, send: async (a) => { sent.push(a.workflow); } };
check("db down: alert still sends", await opsAlert({ workflow: "Uptime" }, 1e12, broken), "sent");
check("db down: mail went out", sent, ["Uptime"]);

// opsAlert gap still holds with a working database
const T0 = 2e12;
const store = new Map();
const ok = { get: async (k) => store.get(k) ?? null, set: async (k, v) => { store.set(k, v); }, send: async () => {} };
check("first alert sends", await opsAlert({ workflow: "Uptime" }, T0, ok), "sent");
check("second inside the hour is quiet", await opsAlert({ workflow: "Uptime" }, T0 + 15 * 60_000, ok), "quiet");
check("after the hour it sends again", await opsAlert({ workflow: "Uptime" }, T0 + OPS_ALERT_GAP_MS, ok), "sent");

console.log(failures ? `\n${failures} uptime check(s) FAILED` : "\nuptime: all checks passed");
process.exitCode = failures ? 1 : 0;
