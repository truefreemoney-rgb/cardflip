/**
 * The daily social optimization loop's rules (lib/socialOptimize.ts).
 * Run: npm run test:socialoptimize
 *
 * Pins: only posts 2 to 28 days old count; each post is scored against its
 * own site's average, so a site with huge view counts cannot swamp the
 * rest; a site with no views is scored on engagement; one runaway post is
 * capped; a kind with too few posts or days gets no opinion; the bench must
 * win by 20%; at most one change; nothing moves inside the cooldown; 1pm is
 * never touched.
 */
import assert from "node:assert/strict";
import { COOLDOWN_DAYS, EXPLORE_DAYS, LEAD_DAYS, MARGIN, MIN_DAYS, MIN_POSTS, RETRY_DAYS, SCORE_CAP, TRIAL_DAYS, TRIAL_MAX_DAYS, judgeTrial, optimize, step } from "../src/lib/socialOptimize.ts";

const NOW = Date.parse("2026-10-20T16:00:00Z"); // noon Eastern
const DAY = 86_400_000;
const sitting = { morning: "set", midday: "movers", evening: "games" };
/** One post `age` days old (at 7am ET) on a site. */
const post = (site, kind, age, n = {}) => ({ site, kind, at: new Date(NOW - age * DAY - 5 * 3_600_000).toISOString(), views: null, likes: null, comments: null, shares: null, ...n });
/** `days` days of one kind on two sites: "tt" reports views (x1000), "bs" reports likes only. */
const run = (kind, level, days = 6, first = 3) => Array.from({ length: days }, (_, i) => [post("tt", kind, first + i, { views: level * 1000 }), post("bs", kind, first + i, { likes: level })]).flat();
const score = (r, k) => r.scores.find((s) => s.kind === k).score;

// Every kind the same: no change, and every score is 1.0 (an average post).
let r = optimize({ posts: [...run("set", 10), ...run("movers", 10), ...run("games", 10), ...run("dips", 10)], now: NOW, sitting });
assert.equal(r.day, "2026-10-20");
assert.equal(r.change, null);
assert.deepEqual(r.scores.map((s) => s.score), [1, 1, 1, 1]);
assert.equal(r.counted, 48);
assert.match(r.why, /^No change: nothing on the bench beats what is posting by 20%\.$/);

// The bench (dips) clearly beats the weakest sitting kind: it takes that kind's slot, one change only.
r = optimize({ posts: [...run("set", 6), ...run("movers", 10), ...run("games", 10), ...run("dips", 14)], now: NOW, sitting });
assert.deepEqual(r.change, { slot: "morning", from: "set", to: "dips" });
assert.match(r.why, /price drops posts did 133% better than the set spotlight posts/);
assert.match(r.why, /so price drops is worth a trial at 7am\. The two posted at different times of day, so this is a lead, not proof\.$/);
// Both sitting kinds lose to it: the bigger gap wins, still one change.
r = optimize({ posts: [...run("set", 9), ...run("movers", 10), ...run("games", 5), ...run("dips", 14)], now: NOW, sitting });
assert.deepEqual(r.change, { slot: "evening", from: "games", to: "dips" });

// The margin: 19% better is noise, 20% is a change.
const edge = (dips) => optimize({ posts: [...run("set", 100), ...run("movers", 100), ...run("games", 100), ...run("dips", dips)], now: NOW, sitting });
assert.equal(edge(118).change, null);
assert.ok(MARGIN === 1.2 && edge(125).change);

// 1pm is never touched, however weak the movers posts are.
r = optimize({ posts: [...run("set", 10), ...run("movers", 1), ...run("games", 10), ...run("dips", 10)], now: NOW, sitting });
assert.equal(r.change, null);

// Each site against its own average: TikTok's dips views are huge in absolute terms but average FOR TikTok,
// and Bluesky's dips likes are average for Bluesky, so dips is an average kind and nothing changes.
r = optimize({ posts: [...run("set", 10), ...run("movers", 10), ...run("games", 10), ...run("dips", 10)].map((p) => (p.site === "tt" ? { ...p, views: p.views * 500 } : p)), now: NOW, sitting });
assert.equal(r.change, null);
assert.equal(score(r, "dips"), 1);

// A site with no views is scored on likes + comments + shares; a site with no numbers at all is left out.
r = optimize({ posts: [...run("set", 10), ...run("games", 10), ...run("dips", 10)].filter((p) => p.site === "bs").map((p) => (p.kind === "dips" ? { ...p, likes: 5, comments: 5, shares: 10 } : p)), now: NOW, sitting });
assert.equal(r.counted, 18);
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 6); // 6 posts < MIN_POSTS: no opinion yet
assert.equal(score(r, "dips"), null);
r = optimize({ posts: [...run("set", 10), ...run("games", 10), ...run("dips", 10)].map((p) => (p.site === "bs" ? { ...p, likes: 0 } : p)), now: NOW, sitting });
assert.equal(r.counted, 18, "the all-zero site is not counted");

// Too few posts or too few days: no opinion, and the sentence says which kind and how many it has.
assert.ok(MIN_POSTS === 10 && MIN_DAYS === 5);
r = optimize({ posts: [...run("set", 10), ...run("movers", 10), ...run("games", 10), ...run("dips", 50, 4)], now: NOW, sitting });
assert.equal(score(r, "dips"), null);
assert.equal(r.change, null);
assert.equal(r.why, "No change: not enough posts yet to judge price drops (8 posts over 4 days); a kind needs 10 posts over 5 days.");
// A sitting kind with too little to judge is never replaced either.
r = optimize({ posts: [...run("set", 10), ...run("movers", 10), ...run("games", 1, 1), ...run("dips", 10)], now: NOW, sitting });
assert.equal(r.change, null);
assert.match(r.why, /not enough posts yet to judge all-games jumps \(2 posts over 1 day\)/);

// The age window: yesterday's posts (views still growing) and month-old ones do not count.
r = optimize({ posts: [...run("set", 10), ...run("games", 10), ...run("dips", 10), ...run("dips", 999, 2, 0), ...run("dips", 999, 6, 29)], now: NOW, sitting });
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 12);
assert.equal(r.change, null);

// One runaway post cannot carry a kind: it counts for at most SCORE_CAP times its site's average.
const viral = [...run("set", 10), ...run("games", 10), ...run("dips", 10)];
viral.find((p) => p.kind === "dips" && p.site === "tt").views = 100_000_000;
r = optimize({ posts: viral, now: NOW, sitting });
assert.ok(score(r, "dips") <= (SCORE_CAP + 11) / 12 + 0.01, `capped, got ${score(r, "dips")}`);

// Cooldown: after a change nothing moves for a week, then it can again.
const strong = [...run("set", 6), ...run("movers", 10), ...run("games", 10), ...run("dips", 14)];
r = optimize({ posts: strong, now: NOW, sitting, lastChangeDay: "2026-10-17" });
assert.equal(r.change, null);
assert.equal(r.why, `No change: the schedule changed 3 days ago, and the new post needs ${COOLDOWN_DAYS} days of numbers first.`);
assert.ok(optimize({ posts: strong, now: NOW, sitting, lastChangeDay: "2026-10-13" }).change);

// Posts that are none of ours, or with a timestamp that does not parse, are ignored; nothing at all is not a crash.
r = optimize({ posts: [post("tt", "", 5, { views: 9 }), post("tt", "card", 5, { views: 9 }), { ...post("tt", "set", 5, { views: 9 }), at: "nonsense" }], now: NOW, sitting });
assert.equal(r.counted, 0);
assert.equal(optimize({ posts: [], now: NOW, sitting }).change, null);
// Meta's "+0000" timestamps parse.
r = optimize({ posts: [{ ...post("ig", "set", 5, { views: 9 }), at: "2026-10-15T11:06:09+0000" }], now: NOW, sitting });
assert.equal(r.counted, 1);

// ---- Trials (Chris 10-02: a finding is a lead; a week in the same slot settles it) ----
const dayOf = (age) => new Date(NOW - age * DAY).toISOString().slice(0, 10);
/** `days` days of one kind in one slot on both sites, the newest `first` days old. */
const inSlot = (kind, slot, level, days, first) => run(kind, level, days, first).map((p) => ({ ...p, slot }));
// The trial: dips took 7am from set, starting 9 days ago. Before it, set posted at 7am for 12 days.
const trial = { slot: "morning", from: "set", to: "dips", start: dayOf(9) };
const before = [...inSlot("set", "morning", 10, 12, 10), ...inSlot("movers", "midday", 10, 20, 2), ...inSlot("games", "evening", 10, 20, 2)];

// Not enough counted days yet: running (posts under 2 days old do not count).
let v = judgeTrial([...before, ...inSlot("dips", "morning", 10, 5, 2)], NOW, trial);
assert.deepEqual([v.verdict, v.days], ["running", 5]);
assert.match(v.why, /^No change: trial running, price drops at 7am in place of set spotlight, 5 of 7 days counted/);
assert.match(judgeTrial(before, NOW, { ...trial, start: dayOf(-2) }).why, /starts 2026-10-22\.$/);
// Seven counted days, at least as good as set was IN THE SAME SLOT: it stays. Equal counts as "at least as well".
v = judgeTrial([...before, ...inSlot("dips", "morning", 10, 7, 2)], NOW, trial);
assert.deepEqual([v.verdict, v.trialScore, v.oldScore], ["keep", 1, 1]);
assert.match(v.why, /^Trial over: price drops at 7am did at least as well \(1 vs 1 for set spotlight in the same slot/);
// Worse than set was in that slot: set goes back.
v = judgeTrial([...before, ...inSlot("dips", "morning", 6, 7, 2)], NOW, trial);
assert.equal(v.verdict, "back");
assert.match(v.why, /did worse .* so set spotlight goes back\.$/);
// Same slot only: dips' strong 7pm posts from before the trial, and set's posts in another slot, do not count.
v = judgeTrial([...before, ...inSlot("dips", "morning", 6, 7, 2), ...inSlot("dips", "evening", 99, 6, 10), ...inSlot("set", "evening", 1, 6, 10)], NOW, trial);
assert.equal(v.verdict, "back");
// Nothing left to compare against (the old kind has too few posts in that slot): it stays.
v = judgeTrial([...before.filter((p) => p.kind !== "set"), ...inSlot("dips", "morning", 6, 7, 2)], NOW, trial);
assert.equal(v.verdict, "keep");
assert.match(v.why, /too few posts left in that slot to compare/);
// A trial kind that hardly ever had a draft: ended after TRIAL_MAX_DAYS, the old kind goes back.
v = judgeTrial([...before, ...inSlot("dips", "morning", 10, 2, 3)], NOW, { ...trial, start: dayOf(TRIAL_MAX_DAYS) });
assert.equal(v.verdict, "back");
assert.match(v.why, /only had a post on 2 days in 16/);

// ---- One day of the loop (step) ----
const idle = { off: false, trial: null, lastChangeDay: null, sinceDay: "2026-10-15", failed: {} };
const lead = [...run("set", 6), ...run("movers", 10), ...run("games", 10), ...run("dips", 14)];
// A lead starts a trial two days out, with a board line.
let s = step({ posts: lead, now: NOW, sitting, state: idle });
assert.ok(LEAD_DAYS === 2 && TRIAL_DAYS === 7);
assert.deepEqual(s.action, { type: "start", trial: { slot: "morning", from: "set", to: "dips", start: "2026-10-22" } });
assert.match(s.line, /^Social optimizer 2026-10-20 — trial: price drops takes 7am from set spotlight for a week, starting 2026-10-22\. /);
// Switched off: the same numbers, nothing done, nothing on the board.
s = step({ posts: lead, now: NOW, sitting, state: { ...idle, off: true } });
assert.deepEqual([s.action.type, s.line, s.report.change], ["none", null, null]);
assert.match(s.report.why, /^Switched off: nothing changes\. /);
// A running trial blocks everything else; its verdict is the day's one action.
const during = { ...sitting, morning: "dips" };
s = step({ posts: [...before, ...inSlot("dips", "morning", 10, 3, 2)], now: NOW, sitting: during, state: { ...idle, trial } });
assert.deepEqual([s.action.type, s.line], ["none", null]);
s = step({ posts: [...before, ...inSlot("dips", "morning", 10, 7, 2)], now: NOW, sitting: during, state: { ...idle, trial } });
assert.equal(s.action.type, "keep");
assert.match(s.line, /^Social optimizer 2026-10-20 — Trial over: price drops at 7am did at least as well/);
s = step({ posts: [...before, ...inSlot("dips", "morning", 6, 7, 2)], now: NOW, sitting: during, state: { ...idle, trial } });
assert.deepEqual(s.action, { type: "back", trial, from: "2026-10-22" });
assert.match(s.line, /so set spotlight goes back\. Back from 2026-10-22\.$/);
// A failed trial is not tried again in that slot for RETRY_DAYS; the lead may still point at the other slot.
s = step({ posts: lead, now: NOW, sitting, state: { ...idle, failed: { "morning:dips": "2026-10-01" } } });
assert.deepEqual([s.action.type, s.action.trial?.slot], ["start", "evening"]);
s = step({ posts: lead, now: NOW, sitting, state: { ...idle, failed: { "morning:dips": "2026-10-01", "evening:dips": "2026-10-01" } } });
assert.equal(s.action.type, "none");
assert.ok(RETRY_DAYS === 56 && step({ posts: lead, now: NOW, sitting, state: { ...idle, failed: { "morning:dips": "2026-08-20" } } }).action.trial?.slot === "morning");
// Cooldown after a verdict: nothing starts for a week.
assert.equal(step({ posts: lead, now: NOW, sitting, state: { ...idle, lastChangeDay: "2026-10-17" } }).action.type, "none");

// The bench's turn: no lead, nothing changed for EXPLORE_DAYS, so the benched kind gets a week in the weaker slot.
const flat = [...run("set", 9), ...run("movers", 10), ...run("games", 10)]; // dips has no posts at all
assert.equal(step({ posts: flat, now: NOW, sitting, state: idle }).action.type, "none"); // 5 days since the first run: too soon
s = step({ posts: flat, now: NOW, sitting, state: { ...idle, sinceDay: "2026-09-22" } });
assert.ok(EXPLORE_DAYS === 28);
assert.deepEqual(s.action, { type: "start", trial: { slot: "morning", from: "set", to: "dips", start: "2026-10-22", explore: true } });
assert.match(s.line, /Nothing has changed for 28 days and price drops has not posted, so it gets a week at 7am/);
assert.deepEqual(s.report.change, { slot: "morning", from: "set", to: "dips" });
// The clock restarts at the last change, and a slot it failed in recently is passed over.
assert.equal(step({ posts: flat, now: NOW, sitting, state: { ...idle, sinceDay: "2026-08-01", lastChangeDay: "2026-10-01" } }).action.type, "none");
assert.equal(step({ posts: flat, now: NOW, sitting, state: { ...idle, sinceDay: "2026-09-22", failed: { "morning:dips": "2026-09-20" } } }).action.trial.slot, "evening");
// Switched off, the bench waits too.
assert.equal(step({ posts: flat, now: NOW, sitting, state: { ...idle, off: true, sinceDay: "2026-09-22" } }).action.type, "none");

console.log("test-social-optimize: ok");
