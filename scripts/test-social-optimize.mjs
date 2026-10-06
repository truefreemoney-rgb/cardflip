/**
 * The daily social optimization loop's rules (lib/socialOptimize.ts), phase 3
 * of docs/SOCIAL-ANGLES-PLAN.md: a deterministic fair rotation over all nine
 * kinds for 7am, 1pm and 7pm. Run: npm run test:socialoptimize
 *
 * Pins: only posts 2 to 28 days old count; each post is scored against its
 * own site's average, so a site with huge view counts cannot swamp the
 * rest; a site with no views is scored on engagement; one runaway post is
 * capped; a kind with too few posts or days gets no opinion and the mean
 * weight; the kind choice is deterministic (least-used first, then score-weighted
 * shares); never the same kind twice in a day, never yesterday's kind in the same
 * slot, never a kind from the last two days; 1pm rotates too (always video);
 * off writes nothing.
 */
import assert from "node:assert/strict";
import { DATA_FROM, FLOOR, LEAD_DAYS, MIN_DAYS, MIN_POSTS, PRIOR_WEIGHT, SITE_WEIGHT, NO_REPEAT_DAYS, PICTURE_PRIOR, USAGE_DAYS, POOL_KINDS, SCORE_CAP, SCORED_KINDS, formatWeights, gameFor, rotate, scoreKinds, step, weights } from "../src/lib/socialOptimize.ts";
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
assert.deepEqual(POOL_KINDS, SCORED_KINDS, "1pm joined the rotation: every kind is in the pool");
assert.ok(USAGE_DAYS === 14);

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
assert.ok(score(r, "dips") > 1.15 && score(r, "set") < 0.85, `${score(r, "dips")} / ${score(r, "set")}`);
// Shrinkage (10-06): the score sits between 1.0 and the raw result, closer to the raw as weight builds.
const raw = (14 / 10) ; // dips vs the site mean
assert.ok(score(r, "dips") < raw, "pulled toward the average by PRIOR_WEIGHT");
assert.ok(PRIOR_WEIGHT === 4);

// A site with no views is scored on likes + comments + shares; a site with no numbers at all is left out.
r = scoreKinds([...run("set", 10), ...run("games", 10), ...run("dips", 10)].filter((p) => p.site === "bs").map((p) => (p.kind === "dips" ? { ...p, likes: 5, comments: 5, shares: 10 } : p)), NOW);
assert.equal(r.counted, 18);
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 6); // 6 posts over 6 days: an opinion (10-06 thresholds)
assert.ok(score(r, "dips") > 1);
r = scoreKinds([...run("set", 10), ...run("games", 10), ...run("dips", 10)].map((p) => (p.site === "bs" ? { ...p, likes: 0 } : p)), NOW);
assert.equal(r.counted, 18, "the all-zero site is not counted");

// No number for a post = left out, never a zero (Instagram gives no views for a picture); 0 views on a views site = left out.
r = scoreKinds([...run("set", 10), ...run("dips", 10)].map((p) => (p.site === "tt" && p.kind === "dips" ? { ...p, views: null } : p)), NOW);
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 6, "the six view-less TikTok rows are skipped, the likes site still counts");
r = scoreKinds([...run("set", 10), ...run("dips", 10), post("tt", "dips", 3, { views: 0 })], NOW);
assert.equal(r.scores.find((s) => s.kind === "dips").posts, 12, "the 0-view post (deleted / held back) is skipped");
assert.equal(score(r, "dips"), 1);

// Same-slot baseline: 1pm posts doing 3x the 7am ones do not make the 1pm kind a winner.
const at = (site, kind, age, slot, views) => ({ ...post(site, kind, age, { views }), slot });
const slotted = [];
for (let i = 3; i < 9; i++) slotted.push(at("tt", "set", i, "morning", 1000), at("tt", "movers", i, "midday", 3000));
r = scoreKinds(slotted, NOW);
assert.deepEqual([score(r, "set"), score(r, "movers")], [1, 1], "each judged against its own slot");

// Sites count by reach: a TikTok verdict outweighs a Bluesky one.
assert.ok(SITE_WEIGHT.tiktok > SITE_WEIGHT.x && SITE_WEIGHT.x > SITE_WEIGHT.bluesky);
const mixedSites = [];
for (let i = 3; i < 9; i++) mixedSites.push(post("tiktok", "dips", i, { views: 2000 }), post("tiktok", "set", i, { views: 1000 }), post("bluesky", "dips", i, { likes: 1 }), post("bluesky", "set", i, { likes: 2 }));
r = scoreKinds(mixedSites, NOW);
assert.ok(score(r, "dips") > 1 && score(r, "set") < 1, `TikTok wins the argument: ${score(r, "dips")} / ${score(r, "set")}`);

// Nothing from before DATA_FROM (when only 1pm was a video).
assert.equal(DATA_FROM, "2026-10-03");
assert.equal(scoreKinds([{ ...post("tt", "set", 5, { views: 9 }), at: "2026-10-02T11:00:00Z" }], Date.parse("2026-10-08T16:00:00Z")).counted, 0);

// Too few posts or too few days: no opinion.
assert.ok(MIN_POSTS === 6 && MIN_DAYS === 2);
r = scoreKinds([...run("set", 10), ...run("dips", 50, 1)], NOW);
assert.equal(score(r, "dips"), null);
assert.deepEqual([r.scores.find((s) => s.kind === "dips").posts, r.scores.find((s) => s.kind === "dips").days], [2, 1]);

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

// ---- The pick (rotate): deterministic, least-used first, then score-weighted shares ----
const none = () => scoreKinds([], NOW).scores;
const yday = { morning: "set", midday: "movers", evening: "games" };
const base = { scores: none(), yesterday: yday, recent: ["set", "movers", "games"] };
let p = rotate({ ...base, day: "2026-10-21" });
assert.deepEqual(p, rotate({ ...base, day: "2026-10-21" }), "deterministic: the same input gives the same picks");
const kindsOf = (d) => [d.morning.kind, d.midday.kind, d.evening.kind];
assert.equal(new Set(kindsOf(p)).size, 3, "never the same kind twice in a day");
assert.ok(kindsOf(p).every((k) => !["set", "movers", "games"].includes(k)), "never a kind from the last two days");
assert.equal(p.midday.format, "video", "1pm is always the video");
// The owner's complaint (10-06): movers 4, games 4, set/dips/sleepers/top 1, guess/versus/thennow 0. The never-used kinds come first, in some order.
const usedBefore = { movers: 4, games: 4, set: 1, dips: 1, sleepers: 1, top: 1 };
for (const day of ["2026-10-07", "2026-10-08", "2026-10-09", "2026-11-15"]) {
  p = rotate({ scores: none(), yesterday: { morning: "movers", midday: "games", evening: "set" }, recent: [], used: usedBefore, day });
  assert.deepEqual(kindsOf(p).sort(), ["guess", "thennow", "versus"], `the three unused styles take the three slots (${day})`);
}
// Fair over time with no scores at all: feed each day's picks back as usage, two days no-repeat; after 30 days every kind has aired and no kind leads another by more than two.
{
  const count = Object.fromEntries(SCORED_KINDS.map((k) => [k, 0]));
  let yesterday = yday;
  let recent = [];
  for (let i = 0; i < 30; i++) {
    const d = rotate({ scores: none(), yesterday, recent: recent.flat().slice(-6), used: { ...count }, day: `2026-11-${String(i + 1).padStart(2, "0")}` });
    const ks = kindsOf(d);
    for (const k of ks) count[k]++;
    yesterday = { morning: d.morning.kind, midday: d.midday.kind, evening: d.evening.kind };
    recent.push(ks);
    recent = recent.slice(-2);
  }
  const counts = Object.values(count);
  assert.equal(counts.reduce((a, b) => a + b, 0), 90);
  assert.ok(Math.min(...counts) >= 9 && Math.max(...counts) - Math.min(...counts) <= 2, `fair rotation over 30 days, got ${JSON.stringify(count)}`);
}
// Exploitation (the caller's no-repeat list is left empty here: with nine kinds, three a day and NO_REPEAT_DAYS 2, only three kinds are ever eligible and the rotation is a plain round robin whatever the scores): with every kind scored, a kind scoring 3x airs about 3x as often (its target share), a floor-weak kind still airs, and the order is deterministic.
const scoredAll = scoreKinds(SCORED_KINDS.flatMap((k) => run(k, k === "top" ? 4 : k === "dips" ? 0.05 : 1)), NOW).scores;
assert.ok(scoredAll.every((s) => s.score != null));
const noRules = { scores: scoredAll, yesterday: { morning: "set", midday: "set", evening: "set" }, recent: [] };
p = rotate({ ...noRules, day: "2026-12-01" });
assert.equal(p.morning.kind, "top", "all scored, nothing used: the best-scoring kind is furthest behind its share");
assert.deepEqual(p, rotate({ ...noRules, day: "2026-12-01" }), "deterministic");
p = rotate({ ...noRules, used: { top: 10 }, day: "2026-12-01" });
assert.ok(!kindsOf(p).includes("top"), "a kind already over its share waits");
p = rotate({ ...noRules, used: { top: 1, sleepers: 1, versus: 1, guess: 1, thennow: 1, games: 1, movers: 1, set: 1, dips: 1 }, day: "2026-12-01" });
assert.equal(p.morning.kind, "top", "level usage: the higher-scored kind is the one furthest behind its share");
{
  const count = Object.fromEntries(SCORED_KINDS.map((k) => [k, 0]));
  let yesterday = { morning: "set", midday: "set", evening: "set" };
  let recent = [];
  for (let i = 0; i < 90; i++) {
    const d = rotate({ scores: scoredAll, yesterday, recent: [], used: { ...count }, day: `2027-01-${String((i % 28) + 1).padStart(2, "0")}` });
    const ks = kindsOf(d);
    for (const k of ks) count[k]++;
    yesterday = { morning: d.morning.kind, midday: d.midday.kind, evening: d.evening.kind };
    recent.push(ks);
    recent = recent.slice(-2);
  }
  const others = SCORED_KINDS.filter((k) => k !== "top" && k !== "dips");
  assert.ok(others.every((k) => count.top > count[k]), `the 3x kind airs most, got ${JSON.stringify(count)}`);
  assert.ok(count.dips >= 3 && count.dips < Math.min(...others.map((k) => count[k])), `the floor-weak kind airs seldom, never never, got ${JSON.stringify(count)}`);
}
// Yesterday's kind in the same slot is passed over, but may take another slot.
const ys = Array.from({ length: 40 }, (_, i) => rotate({ scores: none(), yesterday: { morning: "dips", midday: "movers", evening: "top" }, recent: [], day: `2027-02-${String((i % 28) + 1).padStart(2, "0")}` }));
assert.ok(ys.every((d) => d.morning.kind !== "dips" && d.midday.kind !== "movers" && d.evening.kind !== "top"));
// When the rules leave nothing, they relax in turn: a two-kind pool, both recent, still posts all three slots.
p = rotate({ scores: none(), yesterday: { morning: "set", midday: "movers", evening: "games" }, recent: ["set", "games"], pool: ["set", "games"], day: "2026-10-21" });
assert.deepEqual([p.morning.kind, p.midday.kind], ["games", "set"], "…and not in yesterday's slots");
assert.ok(["set", "games"].includes(p.evening.kind));
// Each angle carries its game: the day's cycle pick; the originals carry none.
p = rotate({ ...base, day: "2026-10-21", pool: ["guess", "versus", "dips"] });
for (const slot of ["morning", "midday", "evening"]) {
  const k = p[slot].kind;
  assert.equal(p[slot].game, k === "dips" ? null : angleCycle(k, "2026-10-21")[0]);
}
assert.equal(gameFor("thennow", "2026-10-21"), angleCycle("thennow", "2026-10-21")[0]);
assert.ok(ANGLE_GAMES.thennow.includes(gameFor("thennow", "2026-10-21")));
assert.equal(gameFor("set", "2026-10-21"), null);

// ---- Phase 5: the game by score, the format by score ----
// Per-game scores: once any of an angle's games has a score, the game is drawn by score (unknown games at the mean), seeded by day.
const { angleCycle: _ac } = await import("../src/lib/socialPlan.ts");
const tagged = (kind, game, level, days = 6) => run(kind, level, days).map((p) => ({ ...p, game, format: "video" }));
let sk = scoreKinds([...tagged("guess", "mtg", 40), ...tagged("guess", "pokemon", 1), ...tagged("guess", "lorcana", 1)], NOW);
assert.deepEqual(sk.games.filter((g) => g.score != null).map((g) => [g.game, g.posts]), [["pokemon", 12], ["mtg", 12], ["lorcana", 12]]);
assert.equal(sk.scores.find((s) => s.kind === "guess").posts, 36);
const gameDraws = Array.from({ length: 60 }, (_, i) => gameFor("guess", `2027-03-${String((i % 28) + 1).padStart(2, "0")}`, sk.games));
// Magic scores ~2.9, the two weak games sit at the floor, the three unscored games at the mean (~1.0 each): Magic is the most drawn, about a half.
const mtgDays = gameDraws.filter((g) => g === "mtg").length;
assert.ok(mtgDays >= 20 && mtgDays > gameDraws.filter((g) => g === "pokemon").length, `Magic should be drawn most, got ${mtgDays} of 60`);
assert.ok(new Set(gameDraws).size >= 3, "the other games still get aired (mean weight for the unknown, a floor for the weak)");
assert.equal(gameFor("guess", "2027-03-01", sk.games), gameFor("guess", "2027-03-01", sk.games), "seeded");
assert.equal(gameFor("guess", "2027-03-01", sk.games.filter((g) => g.kind !== "guess")), angleCycle("guess", "2027-03-01")[0], "no score for this kind: the cycle");
// Formats: scored only on sites that posted both; the picture starts at PICTURE_PRIOR of the video.
assert.ok(PICTURE_PRIOR === 0.2);
assert.deepEqual(formatWeights([]), { video: 1, picture: 0.2 });
sk = scoreKinds([...run("set", 10).map((p) => ({ ...p, format: "video" })), ...run("games", 10).map((p) => ({ ...p, format: "picture" }))], NOW);
assert.deepEqual(sk.formats.map((f) => [f.format, f.posts, f.score]), [["video", 12, 1], ["picture", 12, 1]]);
// A site that only ever posts one format is left out of the format scores (it says nothing about the choice): here "tt" is video-only, so only "bs" counts.
sk = scoreKinds([...run("set", 10).map((p) => ({ ...p, format: "video" })), ...run("games", 10).map((p) => ({ ...p, format: p.site === "bs" ? "picture" : "video" }))], NOW);
assert.deepEqual(sk.formats.map((f) => f.posts), [6, 6]);
// The draw: with no score the picture takes about a fifth of the open slots and never both slots on one day.
const noRepeat = { scores: none(), yesterday: { morning: "set", midday: "movers", evening: "games" }, recent: [] };
const fmtDays = Array.from({ length: 100 }, (_, i) => rotate({ ...noRepeat, day: `2027-${String(4 + Math.floor(i / 28)).padStart(2, "0")}-${String((i % 28) + 1).padStart(2, "0")}` }));
const pictures = fmtDays.flatMap((d) => [d.morning.format, d.evening.format]).filter((f) => f === "picture").length;
assert.ok(pictures >= 15 && pictures <= 50, `about a fifth of 200 slots, got ${pictures}`);
assert.ok(fmtDays.every((d) => !(d.morning.format === "picture" && d.evening.format === "picture")), "never both");
assert.ok(fmtDays.every((d) => d.midday.format === "video"), "1pm is never the picture");
// A picture that scores well is drawn more; one that scores badly, less.
const good = [{ format: "video", posts: 20, score: 0.8 }, { format: "picture", posts: 20, score: 2.4 }];
const goodDays = Array.from({ length: 60 }, (_, i) => rotate({ ...noRepeat, formats: good, day: `2027-05-${String((i % 28) + 1).padStart(2, "0")}` }));
assert.ok(goodDays.filter((d) => d.morning.format === "picture").length >= 35, "a strong picture score wins most mornings");
assert.deepEqual(formatWeights([{ format: "video", posts: 20, score: 1.5 }, { format: "picture", posts: 20, score: 0.3 }]), { video: 1.5, picture: 0.3 });

// ---- One day of the loop (step) ----
assert.ok(LEAD_DAYS === 1 && NO_REPEAT_DAYS === 1);
const posts = [...run("set", 6), ...run("movers", 10), ...run("games", 10), ...run("dips", 14)];
let s = step({ posts, now: NOW, day: "2026-10-21", off: false, yesterday: yday, recent: ["set", "games", "dips", "set"] });
assert.equal(s.report.day, "2026-10-20");
assert.equal(s.report.forDay, "2026-10-21");
assert.ok(s.entry && s.entry.from === "2026-10-21" && s.entry.morning === s.report.picks.morning.kind && s.entry.midday === s.report.picks.midday.kind && s.entry.evening === s.report.picks.evening.kind);
assert.equal(s.entry.middayGame, s.report.picks.midday.game ?? undefined, "the entry carries the 1pm angle's game");
assert.equal(s.entry.middayFormat, undefined);
assert.ok(![s.entry.morning, s.entry.midday, s.entry.evening].some((k) => ["set", "games", "dips"].includes(k)), "the last two days' kinds sit out");
assert.equal(s.entry.morningGame, s.report.picks.morning.game ?? undefined, "the entry carries the angle's game");
assert.match(s.report.why, /^2026-10-21: .+ at 7am, .+ at 1pm, .+ at 7pm\. Never-scored styles first \(least-used\), then each style gets slots in proportion to its score; the pick is the one furthest behind its share \(never a kind posted the day before\)\. Scores \(1\.0 = an average post on its site\): set spotlight 0\.\d+, weekly gains \d+(\.\d+)?, all-games jumps 1(\.\d+)?, price drops 1\.\d+, guess the price – \(0 of 6 posts\)/);
assert.match(s.report.why, /A kind with no score yet airs first \(least-used\) until it has 6 posts over 2 days\. Video 1 vs picture 0\.2 \(the picture's own score needs 6 posts on sites that post both; it has 0\)\.$/);
// The entry carries "picture" only when drawn (absent = video), and the sentence says so.
const pic = Array.from({ length: 60 }, (_, i) => step({ posts, now: NOW, day: `2027-06-${String((i % 28) + 1).padStart(2, "0")}`, off: false, yesterday: yday, recent: [] })).find((x) => x.report.picks.morning.format === "picture" || x.report.picks.evening.format === "picture");
assert.ok(pic, "some day draws a picture");
const picSlot = pic.report.picks.morning.format === "picture" ? "morning" : "evening";
assert.equal(pic.entry[`${picSlot}Format`], "picture");
assert.equal(pic.entry[`${picSlot === "morning" ? "evening" : "morning"}Format`], undefined);
assert.match(pic.report.why, /, as a picture at 7[ap]m/);
assert.equal(s.entry.morningFormat === undefined || s.entry.morningFormat === "picture", true);
assert.equal(s.report.counted, 48);
assert.equal(Object.keys(s.report.weights).length, POOL_KINDS.length);
// Switched off: the same numbers, nothing written, the sentence says what stays.
s = step({ posts, now: NOW, day: "2026-10-21", off: true, yesterday: yday, recent: ["set", "games"] });
assert.deepEqual([s.entry, s.report.picks], [null, null]);
assert.match(s.report.why, /^Switched off: the schedule stays as it stands \(set spotlight at 7am, weekly gains at 1pm, all-games jumps at 7pm\)\. Scores/);
// Deterministic: the same day and numbers give the same entry.
assert.deepEqual(step({ posts, now: NOW, day: "2026-10-21", off: false, yesterday: yday, recent: [] }).entry, step({ posts, now: NOW + 1000, day: "2026-10-21", off: false, yesterday: yday, recent: [] }).entry);

console.log("test-social-optimize: ok");
