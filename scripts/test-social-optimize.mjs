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
import { COOLDOWN_DAYS, MARGIN, MIN_DAYS, MIN_POSTS, SCORE_CAP, optimize } from "../src/lib/socialOptimize.ts";

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

console.log("test-social-optimize: ok");
