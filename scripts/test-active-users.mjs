/**
 * Admin → Users → Active Users (lib/server/activeUsers.ts).
 * Run: npm run test:activeusers
 *
 * Pins (Chris 09-30, "add a active users tab to the users section in
 * admin"): a seller is active when their latest signal (opened the app, a
 * scan, a price check, a saved card, a watchlist add, a help chat question,
 * a support ticket or seller note) is inside the window. Staff (role admin
 * and the owner's email) are left out and only counted. cards.updated_at is
 * NOT a signal: the daily price jobs write it for sellers who never open the
 * app. Robot help replies and admin ticket notes are not the seller doing
 * anything. A deleted account's scan_usage rows drop out, and its locate and
 * tiebreak rows are vision calls, not scans. Window edges are
 * inclusive: Today starts at Eastern midnight, 7 and 30 Days are rolling.
 * The last_seen_at heartbeat writes at most once per 10 minutes, and the
 * throttle holds in SQL too, not only in the route's check.
 *
 * Same throwaway-db trick as test-auth-routes.mjs: chdir to a temp dir
 * before any import so `data/cardflip.db` lands there with the real schema.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-activeusers-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const { createUser, findUserById, markSeen, seenDue, SEEN_EVERY_MS, OWNER_EMAIL } = await import(at("lib/server/users.ts"));
const { loadActiveUsers, activeUsers, activeIn, windowStarts, parseActiveWindow } = await import(at("lib/server/activeUsers.ts"));
const { etDayStart } = await import(at("lib/time.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

// --- Eastern midnight --------------------------------------------------------
check("etDayStart: noon EDT starts at 04:00 UTC", etDayStart(Date.UTC(2026, 8, 30, 16)), Date.UTC(2026, 8, 30, 4));
check("etDayStart: 11:59 PM ET is still the day before", etDayStart(Date.UTC(2026, 8, 30, 3, 59)), Date.UTC(2026, 8, 29, 4));
check("etDayStart: winter (EST) starts at 05:00 UTC", etDayStart(Date.UTC(2026, 0, 15, 18)), Date.UTC(2026, 0, 15, 5));
check("etDayStart: spring-forward day starts on EST", etDayStart(Date.UTC(2026, 2, 8, 18)), Date.UTC(2026, 2, 8, 5));
check("etDayStart: fall-back day starts on EDT", etDayStart(Date.UTC(2026, 10, 1, 18)), Date.UTC(2026, 10, 1, 4));
check("parseActiveWindow: default is 7 Days", [parseActiveWindow(undefined), parseActiveWindow("junk"), parseActiveWindow("today"), parseActiveWindow("30d")], ["7d", "7d", "today", "30d"]);

// --- fixtures ----------------------------------------------------------------
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.UTC(2026, 8, 30, 16); // Sep 30, 12:00 PM EDT
const since = windowStarts(now);
check("windows: Today = Eastern midnight, 7/30 Days rolling", since, { today: Date.UTC(2026, 8, 30, 4), "7d": now - 7 * DAY, "30d": now - 30 * DAY });

let seq = 0;
const nextId = () => `row-${++seq}`;
const run = (sql, ...args) => db.prepare(sql).run(...args);
const mk = (name, role = "user", email) => createUser(name, email ?? `${name.split(" ")[0].toLowerCase()}@example.com`, "test-pass-123", role);
const lastSeen = (u, t) => run("UPDATE users SET last_seen_at = ? WHERE id = ?", t, u.id);
const scan = (userId, t, read = null) =>
  run("INSERT INTO scan_usage (id, user_id, at, model, input_tokens, output_tokens, cost_micros, read) VALUES (?, ?, ?, 'test', 1, 1, 1, ?)", nextId(), userId, t, read);
const priceCheck = (u, t) =>
  run("INSERT INTO price_checks (id, user_id, card_name, set_name, card_number, language, prices_json, checked_at) VALUES (?, ?, 'Pikachu', 'Base', '58', 'en', '{}', ?)", nextId(), u.id, t);
const card = (u, created, updated) =>
  run("INSERT INTO cards (id, user_id, card_name, set_name, card_number, image_url, condition, status, created_at, updated_at) VALUES (?, ?, 'Pikachu', 'Base', '58', '', 'NM', 'ready', ?, ?)", nextId(), u.id, created, updated);
const watch = (u, t) =>
  run("INSERT INTO wishlist_items (id, user_id, card_name, set_name, card_number, language, added_at) VALUES (?, ?, ?, 'Base', '58', 'en', ?)", nextId(), u.id, `Card ${seq}`, t);
const help = (u, role, t) => run("INSERT INTO help_messages (id, user_id, role, content, created_at) VALUES (?, ?, ?, 'hi', ?)", nextId(), u.id, role, t);

const ava = await mk("Ava Scan");
await scan(ava.id, now - 2 * HOUR, JSON.stringify({ game: "pokemon", name: "Pikachu", number: "58" }));
await scan(ava.id, now - 10 * DAY);
// A multi-card photo's locate call and a picture tiebreak are vision calls, not scans.
await scan(ava.id, now - 2 * HOUR - MIN, JSON.stringify({ locate: true, found: 3, w: 1200, h: 1600 }));
await scan(ava.id, now - 2 * HOUR + MIN, JSON.stringify({ game: "pokemon", tiebreak: ["a", "b"], pick: "a", conf: 0.9 }));
await lastSeen(ava, now - 3 * HOUR); // older than her scan: the scan is the label
const ben = await mk("Ben Price");
await priceCheck(ben, now - 3 * DAY);
await run("UPDATE users SET sub_status = 'active', plan = 'pro' WHERE id = ?", ben.id);
const cal = await mk("Cal Opened");
await lastSeen(cal, now - 20 * DAY);
const dee = await mk("Dee Admin", "admin");
await scan(dee.id, now - HOUR);
const owner = await mk("Owner", "user", OWNER_EMAIL);
await lastSeen(owner, now - 5 * DAY);
await scan("deleted-account", now - HOUR); // scan_usage outlives a deleted account
const fay = await mk("Fay Stale");
await card(fay, now - 60 * DAY, now - HOUR); // daily price job touched updated_at only
const gus = await mk("Gus Old");
await lastSeen(gus, now - 31 * DAY);
const hal = await mk("Hal Help");
await help(hal, "user", since.today); // exactly Eastern midnight: in Today
const ivy = await mk("Ivy Watch");
await watch(ivy, since.today - 1); // 1 ms before midnight: not Today
const jo = await mk("Jo Support");
await run("INSERT INTO support_tickets (id, number, user_id, subject, body, created_at, updated_at) VALUES ('tk1', 1, ?, 'Help', 'x', ?, ?)", jo.id, now - 12 * DAY, now - HOUR);
await run("INSERT INTO support_ticket_notes (id, ticket_id, user_id, author, body, created_at) VALUES ('n1', 'tk1', ?, 'seller', 'more', ?)", jo.id, now - 7 * DAY);
await run("INSERT INTO support_ticket_notes (id, ticket_id, user_id, author, body, created_at) VALUES ('n2', 'tk1', ?, 'admin', 'reply', ?)", jo.id, now - HOUR);
const kit = await mk("Kit Card");
await card(kit, now - 7 * DAY - 1, now - 7 * DAY - 1); // 1 ms outside 7 Days
const lu = await mk("Lu Robot");
await help(lu, "assistant", now - HOUR); // the robot talking is not the seller doing anything
const mo = await mk("Mo Back");
await scan(mo.id, now - 5 * DAY);
await lastSeen(mo, now - HOUR);

// --- who is active, by window ------------------------------------------------
const snap = await loadActiveUsers(now);
const names = (win) => activeIn(snap, win).users.map((u) => u.name);
check("Today: latest first, Eastern midnight included", names("today"), ["Mo Back", "Ava Scan", "Hal Help"]);
check("7 Days: adds 1 ms before midnight and exactly 7 days back", names("7d"), ["Mo Back", "Ava Scan", "Hal Help", "Ivy Watch", "Ben Price", "Jo Support"]);
check("30 Days: adds 7 days + 1 ms and the 20-day open, not 31 days", names("30d"), ["Mo Back", "Ava Scan", "Hal Help", "Ivy Watch", "Ben Price", "Jo Support", "Kit Card", "Cal Opened"]);
check("staff hidden per window (admin today; owner email by 7 Days)", ["today", "7d", "30d"].map((w) => activeIn(snap, w).staffHidden), [1, 2, 2]);

const all = snap.users.map((u) => u.name);
check("staff never listed (admin role, owner email)", all.filter((n) => n === "Dee Admin" || n === "Owner"), []);
check("cards.updated_at is not activity", all.includes("Fay Stale"), false);
check("robot help replies are not activity", all.includes("Lu Robot"), false);
check("deleted account's scans drop out (8 listed + 2 staff, no orphan row)", [snap.users.length, snap.staffAt.length], [8, 2]);

const byName = Object.fromEntries(snap.users.map((u) => [u.name, u]));
check("labels: the latest signal wins", Object.fromEntries(snap.users.map((u) => [u.name, u.what])), {
  "Mo Back": "Opened the App",
  "Ava Scan": "Scanned",
  "Hal Help": "Used Help Chat",
  "Ivy Watch": "Added to Watchlist",
  "Ben Price": "Checked a Price",
  "Jo Support": "Wrote to Support",
  "Kit Card": "Saved a Card",
  "Cal Opened": "Opened the App",
});
check("admin reply on a ticket is not the seller's activity", byName["Jo Support"].activeAt, now - 7 * DAY);
check("scans per window (Ava; locate and tiebreak rows skipped)", byName["Ava Scan"].scans, { today: 1, "7d": 1, "30d": 2 });
check("a later tiebreak call does not move Ava's last scan", byName["Ava Scan"].activeAt, now - 2 * HOUR);
check("scans per window (Mo opened today, scanned 5 days ago)", byName["Mo Back"].scans, { today: 0, "7d": 1, "30d": 1 });
check("plan: Stripe Pro subscriber", [byName["Ben Price"].tier, byName["Ben Price"].plan], ["subscribed", "pro"]);
check("plan: a fresh account is on the trial", [byName["Cal Opened"].tier, byName["Cal Opened"].plan], ["trial", null]);

// --- last_seen_at throttle ----------------------------------------------------
check("seenDue: never stamped", seenDue({ lastSeenAt: null }, now), true);
check("seenDue: 1 ms short of 10 minutes", seenDue({ lastSeenAt: now }, now + SEEN_EVERY_MS - 1), false);
check("seenDue: 10 minutes on", seenDue({ lastSeenAt: now }, now + SEEN_EVERY_MS), true);
check("markSeen: stale stamp writes", await markSeen(gus.id, now), true);
check("markSeen: 9 minutes later does not write", await markSeen(gus.id, now + 9 * MIN), false);
check("markSeen: 1 ms short of 10 minutes does not write", await markSeen(gus.id, now + SEEN_EVERY_MS - 1), false);
check("markSeen: the first stamp stands", (await findUserById(gus.id)).lastSeenAt, now);
check("markSeen: 10 minutes later writes again", await markSeen(gus.id, now + SEEN_EVERY_MS), true);
check("markSeen: new stamp reads back", (await findUserById(gus.id)).lastSeenAt, now + SEEN_EVERY_MS);
const later = await loadActiveUsers(now + SEEN_EVERY_MS);
check("an app open puts Gus in Today", activeIn(later, "today").users.find((u) => u.name === "Gus Old")?.what ?? null, "Opened the App");

// --- the 60 s memo ------------------------------------------------------------
const m1 = await activeUsers(now);
check("memo: same snapshot inside 60 s", (await activeUsers(now + 59_999)) === m1, true);
check("memo: fresh read at 60 s", (await activeUsers(now + 60_000)) === m1, false);

console.log(failures === 0 ? "\nAll active-users checks passed" : `\n${failures} active-users check(s) failed`);
// No process.exit(): it would skip the beforeExit hook that closes the libsql
// client, and on Windows that open handle asserts at exit (see lib/db.ts).
process.exitCode = failures === 0 ? 0 : 1;
