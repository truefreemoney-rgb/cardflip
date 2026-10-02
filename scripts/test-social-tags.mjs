/**
 * Hashtags in the daily optimization loop (lib/socialTags.ts).
 * Run: npm run test:socialtags
 *
 * Pins: with no plan a post's tags are untouched; a standing swap starts on
 * its day and keeps the tag's place; a trial swaps on every other day only,
 * inside its window; the verdict waits for the last post to age, compares
 * only posts that carried one of the two tags, each against its own site's
 * average, and the challenger must win by the margin; one trial at a time, a
 * cooldown between, a loser waits before a retry; every candidate is a tag
 * Bluesky can make a facet of.
 */
import assert from "node:assert/strict";
import { TAG_CANDIDATES, TAG_COOLDOWN_DAYS, TAG_LEAD_DAYS, TAG_MARGIN, TAG_MIN_AGE_DAYS, TAG_MIN_POSTS, TAG_RETRY_DAYS, TAG_TRIAL_DAYS, challengerDay, judgeTagTrial, parseTagPlan, setTagPlan, tagStep, tagsOfText, tagsOn } from "../src/lib/socialTags.ts";

const DAY = 86_400_000;
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const noon = (day) => Date.parse(`${day}T16:00:00Z`); // noon Eastern
const TAGS = ["PokemonTCG", "PokemonCards", "TCG", "TradingCards", "CardCollector"];

// No plan: the same array back, whatever the day.
assert.equal(tagsOn(TAGS, "2026-10-10", { swaps: [], trial: null }), TAGS);
assert.equal(tagsOn(TAGS, undefined, { swaps: [{ out: "TCG", in: "TCGCommunity", from: "2026-01-01" }], trial: null }), TAGS);

// A standing swap: not before its day, from its day on, same place in the list.
const swaps = [{ out: "PokemonCards", in: "Pokemon", from: "2026-10-10" }];
assert.deepEqual(tagsOn(TAGS, "2026-10-09", { swaps, trial: null }), TAGS);
assert.deepEqual(tagsOn(TAGS, "2026-10-10", { swaps, trial: null }), ["PokemonTCG", "Pokemon", "TCG", "TradingCards", "CardCollector"]);
// A post without the tag is untouched; a post that already has the new tag is not given it twice.
assert.deepEqual(tagsOn(["MTG", "TCG"], "2026-10-10", { swaps, trial: null }), ["MTG", "TCG"]);
assert.deepEqual(tagsOn(["Pokemon", "PokemonCards"], "2026-10-10", { swaps, trial: null }), ["Pokemon", "PokemonCards"]);

// A trial: challenger on the start day and every second day after, for TAG_TRIAL_DAYS, never outside.
const trial = { out: "PokemonCards", in: "Pokemon", start: "2026-10-04" };
assert.equal(challengerDay(trial, "2026-10-03"), false);
assert.equal(challengerDay(trial, "2026-10-04"), true);
assert.equal(challengerDay(trial, "2026-10-05"), false);
assert.equal(challengerDay(trial, "2026-10-06"), true);
assert.equal(challengerDay(trial, addDays(trial.start, TAG_TRIAL_DAYS - 2)), true);
assert.equal(challengerDay(trial, addDays(trial.start, TAG_TRIAL_DAYS)), false);
assert.equal(tagsOn(TAGS, "2026-10-04", { swaps: [], trial })[1], "Pokemon");
assert.equal(tagsOn(TAGS, "2026-10-05", { swaps: [], trial })[1], "PokemonCards");
let challengerDays = 0;
for (let i = -3; i < TAG_TRIAL_DAYS + 3; i++) if (challengerDay(trial, addDays(trial.start, i))) challengerDays++;
assert.equal(challengerDays, TAG_TRIAL_DAYS / 2);

// The process-wide plan is what tagsOn reads by default (fitText passes no plan).
setTagPlan({ swaps, trial: null });
assert.equal(tagsOn(TAGS, "2026-10-10")[1], "Pokemon");
setTagPlan({ swaps: [], trial: null });
assert.equal(tagsOn(TAGS, "2026-10-10"), TAGS);

// The settings row: junk is an empty plan, a bad tag or day is dropped.
assert.deepEqual(parseTagPlan(null), { swaps: [], trial: null });
assert.deepEqual(parseTagPlan("nope"), { swaps: [], trial: null });
assert.deepEqual(parseTagPlan(JSON.stringify({ swaps: [{ out: "TCG", in: "TCG-Community", from: "2026-10-10" }, { out: "TCG", in: "TCGCommunity", from: "2026-10-10" }], trial: { out: "A", in: "B", start: "soon" } })), { swaps: [{ out: "TCG", in: "TCGCommunity", from: "2026-10-10" }], trial: null });
assert.deepEqual(parseTagPlan(JSON.stringify({ swaps: [], trial })), { swaps: [], trial });

// Tags are read back from a stored post's text; "#154" (a card number) is not a tag.
assert.deepEqual(tagsOfText("Umbreon GX #154 Holo: $135\n\ncardflip.io\n\n#PokemonTCG #Pokemon"), ["PokemonTCG", "Pokemon"]);

// Every candidate is facet-safe and swaps a tag for a different one.
for (const c of TAG_CANDIDATES) {
  assert.match(c.out, /^[A-Za-z][A-Za-z0-9]*$/);
  assert.match(c.in, /^[A-Za-z][A-Za-z0-9]*$/);
  assert.notEqual(c.out.toLowerCase(), c.in.toLowerCase());
}

// ---- The verdict ----
/** One post on a trial day: the tag line the day would have carried, on a site. "tt" reports views, "bs" likes only. */
const post = (site, dayIndex, level) => {
  const day = addDays(trial.start, dayIndex);
  const tags = tagsOn(["PokemonTCG", "PokemonCards"], day, { swaps: [], trial });
  return { site, at: `${day}T11:05:00Z`, text: `Prices.\n\n${tags.map((t) => `#${t}`).join(" ")}`, views: site === "tt" ? level * 1000 : null, likes: site === "tt" ? null : level, comments: null, shares: null };
};
/** Every trial day on two sites; challenger days at `inLevel`, the others at `outLevel`. */
const run = (inLevel, outLevel) => Array.from({ length: TAG_TRIAL_DAYS }, (_, i) => [post("tt", i, i % 2 === 0 ? inLevel : outLevel), post("bs", i, i % 2 === 0 ? inLevel : outLevel)]).flat();
const end = addDays(trial.start, TAG_TRIAL_DAYS);
const judgeDay = noon(addDays(end, TAG_MIN_AGE_DAYS));
assert.ok(TAG_TRIAL_DAYS >= TAG_MIN_POSTS, "two sites over the trial give each arm TAG_MIN_POSTS posts");

// Still running until the last trial post is old enough.
assert.equal(judgeTagTrial(run(20, 10), noon(addDays(end, TAG_MIN_AGE_DAYS - 1)), trial).verdict, "running");
// The challenger clearly better: it stays.
let v = judgeTagTrial(run(20, 10), judgeDay, trial);
assert.equal(v.verdict, "keep");
assert.equal(v.inPosts, TAG_TRIAL_DAYS);
assert.equal(v.outPosts, TAG_TRIAL_DAYS);
assert.ok(v.inScore > v.outScore);
assert.match(v.why, /#Pokemon beat #PokemonCards/);
// The same: the sitting tag stays (a tie is not a win).
v = judgeTagTrial(run(10, 10), judgeDay, trial);
assert.equal(v.verdict, "back");
assert.equal(v.inScore, 1);
assert.match(v.why, /so #PokemonCards stays\.$/);
// Better, but under the margin: still back.
assert.ok(TAG_MARGIN > 1.04);
assert.equal(judgeTagTrial(run(104, 100), judgeDay, trial).verdict, "back");
// A huge site cannot swamp: "tt" views are a thousand times "bs" likes, yet a bs-only win and a tt-only loss cancel out.
const mixed = Array.from({ length: TAG_TRIAL_DAYS }, (_, i) => [post("tt", i, i % 2 === 0 ? 10 : 20), post("bs", i, i % 2 === 0 ? 20 : 10)]).flat();
v = judgeTagTrial(mixed, judgeDay, trial);
assert.equal(v.inScore, v.outScore);
// Posts outside the window, or carrying neither tag (the site cut it), count for neither arm.
const noise = [
  { ...post("tt", 0, 999), at: `${addDays(trial.start, -1)}T11:05:00Z` },
  { ...post("tt", 0, 999), at: `${end}T11:05:00Z` },
  { ...post("tt", 0, 999), text: "Prices.\n\n#PokemonTCG" },
];
v = judgeTagTrial([...run(10, 10), ...noise], judgeDay, trial);
assert.equal(v.inPosts + v.outPosts, TAG_TRIAL_DAYS * 2);
// Too few posts: no opinion, the sitting tag stays.
v = judgeTagTrial(run(20, 10).slice(0, 8), judgeDay, trial);
assert.equal(v.verdict, "back");
assert.match(v.why, /too few posts/);

// ---- The daily step ----
const today = "2026-10-02";
const fresh = { off: false, plan: { swaps: [], trial: null }, lastChangeDay: null, failed: {} };
// Nothing running: the first candidate starts, TAG_LEAD_DAYS out, with a board line.
let s = tagStep({ posts: [], now: noon(today), state: fresh });
assert.deepEqual(s.action, { type: "start", trial: { ...TAG_CANDIDATES[0], start: addDays(today, TAG_LEAD_DAYS) } });
assert.match(s.why, /^Hashtag trial starts 2026-10-04: #Pokemon in place of #PokemonCards on every other day for 14 days/);
assert.match(s.line, /^Social optimizer 2026-10-02 — hashtag trial starts 2026-10-04: #Pokemon in place of #PokemonCards/);
// Switched off: nothing, no line.
s = tagStep({ posts: [], now: noon(today), state: { ...fresh, off: true } });
assert.equal(s.action.type, "none");
assert.equal(s.line, null);
// A trial is running: nothing else starts.
s = tagStep({ posts: [], now: noon("2026-10-08"), state: { ...fresh, plan: { swaps: [], trial } } });
assert.equal(s.action.type, "none");
assert.match(s.why, /^Hashtag trial running/);
// Verdict day, challenger won: a standing swap TAG_LEAD_DAYS out.
s = tagStep({ posts: run(20, 10), now: judgeDay, state: { ...fresh, plan: { swaps: [], trial } } });
assert.deepEqual(s.action, { type: "keep", trial, swap: { out: "PokemonCards", in: "Pokemon", from: addDays(addDays(end, TAG_MIN_AGE_DAYS), TAG_LEAD_DAYS) } });
assert.ok(s.line);
// Verdict day, challenger lost: back.
s = tagStep({ posts: run(10, 10), now: judgeDay, state: { ...fresh, plan: { swaps: [], trial } } });
assert.deepEqual(s.action, { type: "back", trial });
// Cooldown after a verdict.
s = tagStep({ posts: [], now: noon(addDays(today, TAG_COOLDOWN_DAYS - 1)), state: { ...fresh, lastChangeDay: today } });
assert.equal(s.action.type, "none");
s = tagStep({ posts: [], now: noon(addDays(today, TAG_COOLDOWN_DAYS)), state: { ...fresh, lastChangeDay: today } });
assert.equal(s.action.type, "start");
// A pair that lost waits TAG_RETRY_DAYS: the next candidate goes instead.
const lostKey = `${TAG_CANDIDATES[0].out}:${TAG_CANDIDATES[0].in}`;
s = tagStep({ posts: [], now: noon(today), state: { ...fresh, failed: { [lostKey]: addDays(today, -TAG_RETRY_DAYS + 1) } } });
assert.equal(s.action.trial.in, TAG_CANDIDATES[1].in);
s = tagStep({ posts: [], now: noon(today), state: { ...fresh, failed: { [lostKey]: addDays(today, -TAG_RETRY_DAYS) } } });
assert.equal(s.action.trial.in, TAG_CANDIDATES[0].in);
// A tag already swapped out cannot be challenged again (its other challengers are skipped).
s = tagStep({ posts: [], now: noon(today), state: { ...fresh, plan: { swaps: [{ out: "PokemonCards", in: "Pokemon", from: "2026-09-01" }], trial: null } } });
assert.notEqual(s.action.trial.out, "PokemonCards");
// Everything tried and lost recently: nothing to do, no line.
const allLost = Object.fromEntries(TAG_CANDIDATES.map((c) => [`${c.out}:${c.in}`, today]));
s = tagStep({ posts: [], now: noon(today), state: { ...fresh, failed: allLost } });
assert.equal(s.action.type, "none");
assert.equal(s.line, null);

console.log("test-social-tags: ok");
