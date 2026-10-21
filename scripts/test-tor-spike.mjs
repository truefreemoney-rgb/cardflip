/**
 * Tor exits + the site-wide alarm (lib/server/torExits.ts, rateLimitDb.noteSpike). Run: npm run test:torspike
 *
 * Pins (10-21, second probe wave: a Tor bot changed IP every few requests, no per-IP limit added up and nobody was
 * told): the stored exit list refuses those IPs at ipGate with a 403; a short or failed download keeps the old list;
 * the list is fetched at most once a day; the alarm mails once when the hour's count reaches its threshold across
 * any number of networks, not again on the next event, and the new-account count comes from countSignup.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-torspike-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const tor = await import(at("lib/server/torExits.ts"));
const { ipGate, noteGhostLogin, noteSpike, SPIKE_PER_HOUR } = await import(at("lib/server/rateLimitDb.ts"));
const { countSignup } = await import(at("lib/server/signupGuard.ts"));
const { dayBudgetUsed } = await import(at("lib/server/dayBudget.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}
const quiet = console.error;
console.error = () => {}; // the alarm's mail fails here (no mail server); the attempt is what is counted

console.log("Tor exit list");
check("parse: IPv4 and IPv6 kept, junk and blanks skipped",
  tor.parseTorList("185.220.101.12\r\n\n<html>\n2a0b:f4c2::1\nnot-an-ip\n204.8.96.100\n185.220.101.12\n"), ["185.220.101.12", "2a0b:f4c2::1", "204.8.96.100"]);

const list = Array.from({ length: 400 }, (_, i) => `198.51.${Math.floor(i / 250)}.${(i % 250) + 1}`).concat(["185.220.101.12"]).join("\n");
let fetches = 0;
const okFetch = async () => { fetches++; return { ok: true, status: 200, text: async () => list }; };
const t0 = Date.parse("2026-10-21T06:00:00Z");
check("nothing stored: nobody is Tor (fails open)", await tor.isTorExit("185.220.101.12", t0), false);
check("first refresh stores the list", await tor.refreshTorExitsIfDue(t0, okFetch), { refreshed: true, exits: 401 });
check("a listed IP is a Tor exit; another is not; ::ffff: form too",
  [await tor.isTorExit("185.220.101.12", t0), await tor.isTorExit("203.0.113.9", t0), await tor.isTorExit("::ffff:185.220.101.12", t0)], [true, false, true]);
check("within the day: no second download", [await tor.refreshTorExitsIfDue(t0 + 3_600_000, okFetch), fetches], [{ refreshed: false, exits: 401 }, 1]);
const short = async () => ({ ok: true, status: 200, text: async () => "1.2.3.4\n5.6.7.8" });
const down = async () => ({ ok: false, status: 503, text: async () => "" });
const day2 = t0 + 21 * 3_600_000;
check("a short download keeps the old list", (await tor.refreshTorExitsIfDue(day2, short)).error, "only 2 exits in the download");
check("a failed download keeps the old list", (await tor.refreshTorExitsIfDue(day2, down)).error, "HTTP 503");
tor._resetTorMemo();
check("…and the old list still answers", await tor.isTorExit("185.220.101.12", day2), true);

const req = (ip) => new Request("http://localhost/api/auth/signup", { method: "POST", headers: { "fly-client-ip": ip } });
const gateTor = await ipGate(req("185.220.101.12"), "auth:signup");
check("ipGate: a Tor exit gets a 403 with a plain sentence", [gateTor?.status, (await gateTor?.json())?.error], [403, "Sign-in isn't available over Tor. Turn it off and try again, or email support@cardflip.io."]);
check("ipGate: anyone else goes on to the usual limits", await ipGate(req("203.0.113.9"), "auth:signup"), null);

console.log("site-wide alarm");
const mails = () => dayBudgetUsed("security_alert_mail");
const before = await mails();
const now = Date.now();
for (let i = 1; i < SPIKE_PER_HOUR.ghostLogin; i++) await noteGhostLogin(`203.0.113.${i}`, `nobody${i}@gmail.com`, now);
check(`${SPIKE_PER_HOUR.ghostLogin - 1} made-up sign-in emails from as many networks: no mail yet`, (await mails()) - before, 0);
await noteGhostLogin("203.0.113.200", "nobody-last@gmail.com", now);
await new Promise((r) => setTimeout(r, 50));
check(`the ${SPIKE_PER_HOUR.ghostLogin}th, from yet another network: one mail`, (await mails()) - before, 1);
await noteGhostLogin("203.0.113.201", "nobody-more@gmail.com", now);
await new Promise((r) => setTimeout(r, 50));
check("the next one: no second mail that hour", (await mails()) - before, 1);

const before2 = await mails();
for (let i = 1; i <= SPIKE_PER_HOUR.newAccount; i++) await countSignup(`hash-${i}`);
await new Promise((r) => setTimeout(r, 50));
check(`${SPIKE_PER_HOUR.newAccount} new accounts from ${SPIKE_PER_HOUR.newAccount} networks: one mail`, (await mails()) - before2, 1);
await countSignup(null);
check("loopback/unknown sign-ups never count (tests, CI)", (await mails()) - before2, 1);
const before3 = await mails();
for (let i = 1; i < SPIKE_PER_HOUR.refusedSignup; i++) await noteSpike("refusedSignup");
check("refused sign-ups under the threshold: no mail", (await mails()) - before3, 0);

// 10-21 (Chris: "3 unconfirmed accounts in an hour makes sense"): sign-ups still waiting for their code 10 minutes on,
// across all networks. The uptime cron calls checkUnconfirmedSignups every 15 minutes.
{
  const { checkUnconfirmedSignups, UNCONFIRMED_PER_HOUR } = await import(at("lib/server/rateLimitDb.ts"));
  const { db } = await import(at("lib/db.ts"));
  const T = Date.parse("2026-10-21T08:00:00Z");
  const MIN = 60_000;
  let n = 0;
  const add = (agoMin, pending) =>
    db.prepare(`INSERT INTO users (id, name, email, password_hash, role, ebay_connected, created_at, email_pending) VALUES (?, ?, ?, 'x', 'user', 0, ?, ?)`)
      .run(`u-unconf-${++n}`, `Read Probe ${n}`, `rca17925615${n}@gmail.com`, T - agoMin * MIN, pending ? 1 : 0);
  await add(20, true);
  await add(15, true);
  await add(25, false); // confirmed: a real person
  await add(4, true); // still inside the 10-minute grace
  await add(75, true); // older than the hour
  const before4 = await mails();
  const first = await checkUnconfirmedSignups(T);
  check("unconfirmed: 2 waiting past 10 min (confirmed, too new and too old left out): no mail", [first.waiting, first.mailed, (await mails()) - before4], [UNCONFIRMED_PER_HOUR - 1, false, 0]);
  await add(12, true);
  const second = await checkUnconfirmedSignups(T);
  await new Promise((r) => setTimeout(r, 50));
  check(`unconfirmed: the ${UNCONFIRMED_PER_HOUR}rd, from any network: one mail`, [second.waiting, second.mailed, (await mails()) - before4], [UNCONFIRMED_PER_HOUR, true, 1]);
  const again = await checkUnconfirmedSignups(T + 15 * MIN);
  await new Promise((r) => setTimeout(r, 50));
  check("unconfirmed: the next cron run that hour: no second mail", [again.mailed, (await mails()) - before4], [false, 1]);
  check("unconfirmed: two hours on, those accounts no longer count", (await checkUnconfirmedSignups(T + 120 * MIN)).waiting, 0);
}

console.error = quiet;
if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall Tor + alarm checks passed");
process.exit(0);
