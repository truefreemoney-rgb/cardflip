/**
 * The daily social optimization loop's rules (lib/socialOptimize.ts), phase 3
 * of docs/SOCIAL-ANGLES-PLAN.md: a weighted daily rotation over the eight
 * pool kinds for 7am and 7pm. Run: npm run test:socialoptimize
 *
 * Pins: only posts 2 to 28 days old count; each post is scored against its
 * own site's average, so a site with huge view counts cannot swamp the
 * rest; a site with no views is scored on engagement; one runaway post is
 * capped; a kind with too few posts or days gets no opinion and the mean
 * weight; the draw is seeded by the day (deterministic); never the same kind
 * twice in a day, never yesterday's kind in the same slot, never a kind from
 * the last two days; 1pm is never touched; off writes nothing.
 */
import assert from "node:assert/strict";
import { FLOOR, LEAD_DAYS, MIN_DAYS, MIN_POSTS, NO_REPEAT_DAYS, POOL_KINDS, SCORE_CAP, SCORED_KINDS, gameFor, rotate, scoreKinds, step, weights } from "../src/lib/socialOptimize.ts";
import { ANGLE_GAMES, angleCycle } from "../src/lib/socialPlan.ts";

const NOW = Date.parse("2026-10-20T16:00:00Z"); // noon Eastern
const DAY = 86_400_000;
/** One post `age` days old (at 7am ET) on a site. */
const post = (site, kind, age, n = {}) => ({ site, kind, at: new Date(NOW - age * DAY - 5 * 3_600_000).toISOString(), views: null, likes: null, comments: null, shares: null, ...n });
/** `days` days of one kind on two sites: "tt" reports views (x1000), "bs" reports likes only. */
const run = (kind, level, days = 6, first = 3) => Array.from({ length: days }, (_, i) => [post("tt", kind, first + i, { views: level * 1000 }), post("bs", kind, first + i, { likes: level })]).flat();
const score = (r, k) => r.scores.find((s) => s.kind === k).score;

// ---- Scoring ----
assert.deepEqual(SCORED_KINDS, ["set", "movers", "games", "dips", "guess", "thennow", "versus", "sleepers", "top"]);
assert.deepEqual(POOL_KINDS, SCORED_KINDS.filter((k) => k !== "movers"), "1pm is the movers video, never in the draw");

// Every kind the same: every score is 1.0 (an average post).
let r = scoreKinds([...run("set", 10), ...run("movers", 10), ...run("games", 10), ...run("dips", 10)], NOW);
assert.deepEqual(r.scores.slice(0, 4).map((s) => s.score), [1, 1, 1, 1]);
assert.equal(r.counted, 48);
assert.equal(score(r, "guess"), null);

// Each site against its own average: TikTok's dips views are huge in absolute terms but average FOR TikTok.
r = scoreKinds([...run("set", 10), ...run("movers", 10), ...run("games", 10), ...run("dips", 10)].map((p) => (p.site === "tt" ? { ...p, views: p.views * 500 } : p)), NOW);
assert.equal(score(r, "dips"), 1);
// A better kind scores above 1, a worse one under.
r = scoreKinds([...run("set", 6), ...run("games", 10), ...run("dips", 14)], NOW);
assert.ok(score(r, "dips") > 1.3 && score(r, "set") < 0.7, `${score(r, "dips")} / ${score(r, "set")}`);

// A site with no views is scored on likes + comments + shares; a site with no numbers at all is left out.
r = scoreKinds([...run("set", 10), ...run("games", 10), ...run("dips", 10)].filter((p) => p.site === "bs").map((p) => (p.kind === "dips" ? { ...p, likes: 5, comments: 5, shares: 10 } : p)), NOW);
assert.equal(r.counted, 18);
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 6); // 6 posts < MIN_POSTS: no opinion yet
assert.equal(score(r, "dips"), null);
r = scoreKinds([...run("set", 10), ...run("games", 10), ...run("dips", 10)].map((p) => (p.site === "bs" ? { ...p, likes: 0 } : p)), NOW);
assert.equal(r.counted, 18, "the all-zero site is not counted");

// Too few posts or too few days: no opinion.
assert.ok(MIN_POSTS === 10 && MIN_DAYS === 5);
r = scoreKinds([...run("set", 10), ...run("dips", 50, 4)], NOW);
assert.equal(score(r, "dips"), null);
assert.deepEqual([r.scores.find((s) => s.kind === "dips").posts, r.scores.find((s) => s.kind === "dips").days], [8, 4]);

// The age window: yesterday's posts (views still growing) and month-old ones do not count.
r = scoreKinds([...run("set", 10), ...run("dips", 10), ...run("dips", 999, 2, 0), ...run("dips", 999, 6, 29)], NOW);
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 12);
assert.equal(score(r, "dips"), 1);

// One runaway post cannot carry a kind: it counts for at most SCORE_CAP times its site's average.
const viral = [...run("set", 10), ...run("games", 10), ...run("dips", 10)];
viral.find((p) => p.kind === "dips" && p.site === "tt").views = 100_000_000;
r = scoreKinds(viral, NOW);
assert.ok(score(r, "dips") <= (SCORE_CAP + 11) / 12 + 0.01, `capped, got ${score(r, "dips")}`);

// Posts that are none of ours, or with a timestamp that does not parse, are ignored; nothing at all is not a crash.
r = scoreKinds([post("tt", "", 5, { views: 9 }), post("tt", "card", 5, { views: 9 }), { ...post("tt", "set", 5, { views: 9 }), at: "nonsense" }], NOW);
assert.equal(r.counted, 0);
assert.equal(scoreKinds([], NOW).counted, 0);
// Meta's "+0000" timestamps parse.
assert.equal(scoreKinds([{ ...post("ig", "set", 5, { views: 9 }), at: "2026-10-15T11:06:09+0000" }], NOW).counted, 1);

// ---- Weights ----
// Known scores are the weights; an unknown kind gets the mean (optimistic prior); nothing under FLOOR of the mean.
let w = weights(scoreKinds([...run("set", 6), ...run("games", 10), ...run("dips", 14)], NOW).scores);
assert.ok(FLOOR === 0.25);
const mean = (w.set + w.games + w.dips) / 3;
assert.ok(Math.abs(w.guess - mean) < 0.02 && w.guess === w.top, "unknown kinds share the mean");
assert.ok(w.dips > w.games && w.games > w.set);
w = weights(scoreKinds([...run("set", 1), ...run("games", 100), ...run("dips", 100)], NOW).scores);
assert.ok(w.set >= 0.2 && w.set < w.games / 3, `floored at a quarter of the mean score, got ${w.set}`);
assert.deepEqual(Object.values(weights([])), POOL_KINDS.map(() => 1), "no numbers at all: every kind weighs the same");

// ---- The draw (rotate) ----
const none = () => scoreKinds([], NOW).scores;
const base = { scores: none(), yesterday: { morning: "set", evening: "games" }, recent: ["set", "games"] };
let p = rotate({ ...base, day: "2026-10-21" });
assert.deepEqual(p, rotate({ ...base, day: "2026-10-21" }), "seeded by the day: the same day draws the same");
assert.notEqual(p.morning.kind, p.evening.kind, "never the same kind in both slots");
assert.ok(!["set", "games"].includes(p.morning.kind) && !["set", "games"].includes(p.evening.kind), "never a kind from the last two days");
// Over a month of days every pool kind gets aired, and different days differ.
const month = Array.from({ length: 30 }, (_, i) => rotate({ ...base, day: `2026-11-${String(i + 1).padStart(2, "0")}` }));
assert.equal(new Set(month.flatMap((d) => [d.morning.kind, d.evening.kind])).size, POOL_KINDS.length - 2, "every kind outside the recent two is aired in a month");
assert.ok(new Set(month.map((d) => `${d.morning.kind}/${d.evening.kind}`)).size > 10, "the days differ");
// Weight tells: a kind scoring far above the rest is drawn far more often.
const strong = scoreKinds([...run("set", 1), ...run("games", 1), ...run("dips", 1), ...run("top", 40)], NOW).scores;
const draws = Array.from({ length: 60 }, (_, i) => rotate({ scores: strong, yesterday: { morning: "set", evening: "games" }, recent: [], day: `2027-01-${String((i % 28) + 1).padStart(2, "0")}${i >= 28 ? "" : ""}` }));
const topDays = draws.filter((d) => d.morning.kind === "top" || d.evening.kind === "top").length;
assert.ok(topDays >= 40, `most valuable should be drawn most days, got ${topDays} of 60`);
// Yesterday's kind in the same slot is passed over, but may take the other slot.
const ys = Array.from({ length: 40 }, (_, i) => rotate({ scores: none(), yesterday: { morning: "dips", evening: "top" }, recent: [], day: `2027-02-${String((i % 28) + 1).padStart(2, "0")}` }));
assert.ok(ys.every((d) => d.morning.kind !== "dips" && d.evening.kind !== "top"));
assert.ok(ys.some((d) => d.evening.kind === "dips" || d.morning.kind === "top"), "the other slot is open to it");
// When the rules leave nothing, they relax in turn: a two-kind pool, both recent, still posts.
p = rotate({ scores: none(), yesterday: { morning: "set", evening: "games" }, recent: ["set", "games"], pool: ["set", "games"], day: "2026-10-21" });
assert.deepEqual([p.morning.kind, p.evening.kind].sort(), ["games", "set"]);
assert.deepEqual([p.morning.kind, p.evening.kind], ["games", "set"], "…and not in yesterday's slots");
// Each angle carries its game: the day's cycle pick; the originals carry none.
p = rotate({ ...base, day: "2026-10-21", pool: ["guess", "versus", "dips"] });
for (const slot of ["morning", "evening"]) {
  const k = p[slot].kind;
  assert.equal(p[slot].game, k === "dips" ? null : angleCycle(k, "2026-10-21")[0]);
}
assert.equal(gameFor("thennow", "2026-10-21"), angleCycle("thennow", "2026-10-21")[0]);
assert.ok(ANGLE_GAMES.thennow.includes(gameFor("thennow", "2026-10-21")));
assert.equal(gameFor("set", "2026-10-21"), null);

// ---- One day of the loop (step) ----
assert.ok(LEAD_DAYS === 1 && NO_REPEAT_DAYS === 2);
const posts = [...run("set", 6), ...run("movers", 10), ...run("games", 10), ...run("dips", 14)];
let s = step({ posts, now: NOW, day: "2026-10-21", off: false, yesterday: { morning: "set", evening: "games" }, recent: ["set", "games", "dips", "set"] });
assert.equal(s.report.day, "2026-10-20");
assert.equal(s.report.forDay, "2026-10-21");
assert.ok(s.entry && s.entry.from === "2026-10-21" && s.entry.morning === s.report.picks.morning.kind && s.entry.evening === s.report.picks.evening.kind);
assert.ok(!["set", "games", "dips"].includes(s.entry.morning) && !["set", "games", "dips"].includes(s.entry.evening), "the last two days' kinds sit out");
assert.equal(s.entry.morningGame, s.report.picks.morning.game ?? undefined, "the entry carries the angle's game");
assert.match(s.report.why, /^2026-10-21: .+ at 7am, .+ at 7pm, drawn by score \(never a kind from the last 2 days\)\. Scores \(1\.0 = an average post on its site\): set spotlight 0\.\d+, all-games jumps 1(\.\d+)?, price drops 1\.\d+, guess the price – \(0 of 10 posts\)/);
assert.match(s.report.why, /A kind with no score yet is weighted at the average \([\d.]+\) until it has 10 posts over 5 days\.$/);
assert.equal(s.report.counted, 48);
assert.equal(Object.keys(s.report.weights).length, POOL_KINDS.length);
// Switched off: the same numbers, nothing written, the sentence says what stays.
s = step({ posts, now: NOW, day: "2026-10-21", off: true, yesterday: { morning: "set", evening: "games" }, recent: ["set", "games"] });
assert.deepEqual([s.entry, s.report.picks], [null, null]);
assert.match(s.report.why, /^Switched off: the schedule stays as it stands \(set spotlight at 7am, all-games jumps at 7pm\)\. Scores/);
// Deterministic: the same day and numbers give the same entry.
assert.deepEqual(step({ posts, now: NOW, day: "2026-10-21", off: false, yesterday: { morning: "set", evening: "games" }, recent: [] }).entry, step({ posts, now: NOW + 1000, day: "2026-10-21", off: false, yesterday: { morning: "set", evening: "games" }, recent: [] }).entry);

console.log("test-social-optimize: ok");
