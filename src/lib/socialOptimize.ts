/**
 * The daily social optimization loop, the rules (Chris 10-02: the
 * optimizing must be a job in the product, "should be daily"; 10-03: all
 * five angles in rotation, rotate the game too, "the optimizer makes the
 * choices", docs/SOCIAL-ANGLES-PLAN.md). Pure: no DB, no fetch — tested in
 * scripts/test-social-optimize.mjs. The job that feeds it and acts on it is
 * lib/server/socialOptimize.ts.
 *
 * Nine kinds exist; 1pm is always the movers video (the shared file every
 * site posts and the best-measured post). The two open slots, 7am and 7pm,
 * are a WEIGHTED DAILY ROTATION over the other eight (phase 3, replacing the
 * one-bench trial of 10-02):
 *
 * Scoring (scoreKinds):
 * - Posts 2 to 28 days old only: views keep growing for two days, and a
 *   month-old result says little about now.
 * - Each post is scored against its own site's average (1.0 = an average
 *   post there), so TikTok's view counts cannot swamp the rest. A site that
 *   reports views is scored on views, one that does not (Bluesky, Facebook)
 *   on likes + comments + shares.
 * - One runaway post cannot carry a kind: a post counts for at most
 *   SCORE_CAP times its site's average.
 * - A kind needs MIN_POSTS posts over MIN_DAYS days or there is no opinion.
 *
 * The draw (rotate), seeded by the day so every reader agrees:
 * - Weight = the kind's score. A kind with no opinion yet gets the mean of
 *   the known scores (an optimistic prior: every new kind gets aired and
 *   earns numbers). A kind scoring under FLOOR of the mean is weighted at
 *   FLOOR of it: a weak kind airs seldom, never never.
 * - Never the same kind in both slots, never the kind that sat in that slot
 *   yesterday, never a kind posted in the last NO_REPEAT_DAYS days; each rule
 *   is relaxed in turn when it would leave nothing.
 * - Game per angle kind: one strict cycle over the games that have data for
 *   it (lib/socialPlan.ts angleCycle), seeded by day. (Per-game scores wait
 *   for a game column on the post log.)
 *
 * The Off switch on /admin/social writes nothing: the entry in force stays,
 * so yesterday's picks repeat.
 */
import { easternOf } from "./socialPosts.ts";
import { ANGLE_GAMES, angleCycle, isAngleKind, type AngleGame, type PostFormat, type StandingEntry } from "./socialPlan.ts";

export type ScoredKind = "set" | "movers" | "games" | "dips" | "guess" | "thennow" | "versus" | "sleepers" | "top";
export type OpenSlot = "morning" | "evening";
export const SCORED_KINDS: ScoredKind[] = ["set", "movers", "games", "dips", "guess", "thennow", "versus", "sleepers", "top"];
/** The kinds the two open slots draw from (1pm is the movers video, never in the draw). */
export const POOL_KINDS: ScoredKind[] = SCORED_KINDS.filter((k) => k !== "movers");
export const OPEN_SLOTS: OpenSlot[] = ["morning", "evening"];
export const KIND_NAME: Record<ScoredKind, string> = {
  set: "set spotlight",
  movers: "weekly gains",
  games: "all-games jumps",
  dips: "price drops",
  guess: "guess the price",
  thennow: "then vs now",
  versus: "head to head",
  sleepers: "sleepers under $5",
  top: "most valuable",
};
export const SLOT_NAME: Record<OpenSlot, string> = { morning: "7am", evening: "7pm" };
export const GAME_NAME: Record<AngleGame, string> = { pokemon: "Pokémon", mtg: "Magic", lorcana: "Lorcana", onepiece: "One Piece", yugioh: "Yu-Gi-Oh", mixed: "all games" };

export const MIN_AGE_DAYS = 2;
export const MAX_AGE_DAYS = 28;
export const MIN_POSTS = 10;
export const MIN_DAYS = 5;
export const SCORE_CAP = 4;
/** A kind is never weighted under this share of the mean: weak kinds air seldom, not never. */
export const FLOOR = 0.25;
/** A kind posted this many days back (either slot) is not drawn again. */
export const NO_REPEAT_DAYS = 2;
/** The evening run picks this many days out: tomorrow, whose videos it then renders in the same pass. */
export const LEAD_DAYS = 1;
/**
 * The picture's weight against the video's until the picture has a score of its own (phase 5, Chris 10-03: "mostly
 * videos … occasional static images, put it in the optimizer and let it optimize itself"): one open slot in five or so
 * is the picture, never both slots on one day, and 1pm is always the video.
 */
export const PICTURE_PRIOR = 0.2;

const DAY_MS = 86_400_000;

export interface ScoredPost {
  site: string;
  kind: string;
  /** The slot it went out in (social_posts.slot). */
  slot?: string;
  /** ISO timestamp of the post. */
  at: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  /** The post's game ("mixed" for a one-per-game list); null on rows from before the log carried it. */
  game?: string | null;
  /** video or picture; null when unknown. */
  format?: string | null;
}

export interface KindScore {
  kind: ScoredKind;
  posts: number;
  /** Distinct Eastern days the kind posted on. */
  days: number;
  /** Average post against its site's average (1.0 = average); null = too few posts to say. */
  score: number | null;
}

function isScored(kind: string): kind is ScoredKind {
  return (SCORED_KINDS as string[]).includes(kind);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Normed {
  post: ScoredPost;
  kind: ScoredKind;
  /** The post against its site's average, capped. */
  norm: number;
  /** Eastern day it posted. */
  day: string;
}

/** Every countable post with its score against its own site's average. */
function normalize(posts: ScoredPost[], now: number): Normed[] {
  const bySite = new Map<string, ScoredPost[]>();
  for (const p of posts) {
    const t = Date.parse(p.at.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
    if (!isScored(p.kind) || Number.isNaN(t)) continue;
    const age = (now - t) / DAY_MS;
    if (age < MIN_AGE_DAYS || age > MAX_AGE_DAYS) continue;
    bySite.set(p.site, [...(bySite.get(p.site) ?? []), p]);
  }
  const out: Normed[] = [];
  for (const sitePosts of bySite.values()) {
    const hasViews = sitePosts.some((p) => (p.views ?? 0) > 0);
    const metric = (p: ScoredPost) => (hasViews ? (p.views ?? 0) : (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0));
    const mean = sitePosts.reduce((n, p) => n + metric(p), 0) / sitePosts.length;
    if (!(mean > 0)) continue; // a site with no numbers at all says nothing about any kind
    for (const p of sitePosts) out.push({ post: p, kind: p.kind as ScoredKind, norm: Math.min(metric(p) / mean, SCORE_CAP), day: easternOf(p.at)?.day ?? "" });
  }
  return out;
}

function scoreOf(list: Normed[]): { posts: number; days: number; score: number | null } {
  const days = new Set(list.map((n) => n.day).filter(Boolean)).size;
  const score = list.length ? round2(list.reduce((s, n) => s + n.norm, 0) / list.length) : null;
  return { posts: list.length, days, score: list.length >= MIN_POSTS && days >= MIN_DAYS ? score : null };
}

/** An angle's score for one game (null until MIN_POSTS over MIN_DAYS). */
export interface GameScore {
  kind: ScoredKind;
  game: AngleGame;
  posts: number;
  score: number | null;
}
/** video vs picture, on the sites that have posted both in the window (a picture-only site says nothing about the choice). */
export interface FormatScore {
  format: PostFormat;
  posts: number;
  score: number | null;
}

/** Score every kind, each angle's games, and the two formats. */
export function scoreKinds(posts: ScoredPost[], now: number): { counted: number; scores: KindScore[]; games: GameScore[]; formats: FormatScore[] } {
  const normed = normalize(posts, now);
  const scores = SCORED_KINDS.map((kind): KindScore => ({ kind, ...scoreOf(normed.filter((n) => n.kind === kind)) }));
  const games: GameScore[] = [];
  for (const kind of SCORED_KINDS) {
    if (!isAngleKind(kind)) continue;
    for (const game of ANGLE_GAMES[kind]) {
      const { posts: n, score } = scoreOf(normed.filter((x) => x.kind === kind && x.post.game === game));
      if (n) games.push({ kind, game, posts: n, score });
    }
  }
  const both = new Set<string>();
  for (const site of new Set(normed.map((n) => n.post.site))) {
    const f = new Set(normed.filter((n) => n.post.site === site).map((n) => n.post.format));
    if (f.has("video") && f.has("picture")) both.add(site);
  }
  const formats = (["video", "picture"] as PostFormat[]).map((format): FormatScore => {
    const { posts: n, score } = scoreOf(normed.filter((x) => both.has(x.post.site) && x.post.format === format));
    return { format, posts: n, score };
  });
  return { counted: normed.length, scores, games, formats };
}

/** A mulberry32 stream seeded by a day and a salt: the same day always draws the same. */
function seeded(day: string, salt: string): () => number {
  let a = 0;
  for (const ch of `${day}:${salt}`) a = (Math.imul(a ^ ch.charCodeAt(0), 0x85ebca6b) ^ (a >>> 13)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Pick {
  kind: ScoredKind;
  /** The angle's game; null for a kind that has no game dimension. */
  game: AngleGame | null;
  /** What the slot posts on the sites that take both. */
  format: PostFormat;
}
export type DayPicks = Record<OpenSlot, Pick>;

export interface RotateInput {
  /** The Eastern day being picked. */
  day: string;
  scores: KindScore[];
  /** Each angle's per-game scores; a kind with any scored game draws its game by score instead of the cycle. */
  games?: GameScore[];
  /** video vs picture; the picture is weighted PICTURE_PRIOR until it has a score. */
  formats?: FormatScore[];
  /** The kinds that sat in each slot the day before. */
  yesterday: Record<OpenSlot, ScoredKind>;
  /** Every kind posted in the last NO_REPEAT_DAYS days, any slot. */
  recent: ScoredKind[];
  /** The kinds in the draw; POOL_KINDS unless the caller knows better. */
  pool?: ScoredKind[];
}

/** Every pool kind's weight for the draw: its score, the mean for an unknown, never under FLOOR of the mean. */
export function weights(scores: KindScore[], pool: ScoredKind[] = POOL_KINDS): Record<string, number> {
  const known = pool.map((k) => scores.find((s) => s.kind === k)?.score).filter((s): s is number => s != null);
  const mean = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1;
  const out: Record<string, number> = {};
  for (const k of pool) {
    const s = scores.find((x) => x.kind === k)?.score;
    out[k] = round2(Math.max(s ?? mean, mean * FLOOR, 0.01));
  }
  return out;
}

function draw(cands: ScoredKind[], w: Record<string, number>, rand: () => number): ScoredKind {
  const total = cands.reduce((n, k) => n + (w[k] ?? 0), 0);
  let r = rand() * total;
  for (const k of cands) {
    r -= w[k] ?? 0;
    if (r < 0) return k;
  }
  return cands[cands.length - 1];
}

/**
 * The game an angle kind runs for on a day. With no per-game score yet, the cycle's pick (lib/socialPlan.ts, one strict
 * cycle so every game gets its turn); once any of the kind's games has a score, a seeded weighted draw over its games
 * (unknown games at the mean, nothing under FLOOR of it). null for a kind with no games.
 */
export function gameFor(kind: ScoredKind, day: string, games: GameScore[] = []): AngleGame | null {
  if (!isAngleKind(kind)) return null;
  const mine = games.filter((g) => g.kind === kind && g.score != null);
  if (!mine.length) return angleCycle(kind, day)[0] ?? ANGLE_GAMES[kind][0] ?? null;
  const mean = mine.reduce((a, g) => a + (g.score as number), 0) / mine.length;
  const w: Record<string, number> = {};
  for (const g of ANGLE_GAMES[kind]) w[g] = Math.max(mine.find((x) => x.game === g)?.score ?? mean, mean * FLOOR, 0.01);
  return draw(ANGLE_GAMES[kind] as unknown as ScoredKind[], w, seeded(day, `${kind}:game`)) as unknown as AngleGame;
}

/** The format weights: the video's score (1 when unknown) against the picture's (PICTURE_PRIOR of the video's until it has one). */
export function formatWeights(formats: FormatScore[] = []): Record<PostFormat, number> {
  const video = formats.find((f) => f.format === "video")?.score ?? 1;
  const picture = formats.find((f) => f.format === "picture")?.score;
  return { video: round2(Math.max(video, 0.01)), picture: round2(Math.max(picture ?? video * PICTURE_PRIOR, 0.01)) };
}

/** The day's picks for the two open slots: a seeded weighted draw under the no-repeat rules, each relaxed in turn when it leaves nothing. */
export function rotate(input: RotateInput): DayPicks {
  const pool = input.pool?.length ? input.pool : POOL_KINDS;
  const w = weights(input.scores, pool);
  const fw = formatWeights(input.formats);
  const chosen: ScoredKind[] = [];
  const picks = {} as DayPicks;
  let pictureDrawn = false;
  for (const slot of OPEN_SLOTS) {
    const rules: Array<(k: ScoredKind) => boolean> = [(k) => !chosen.includes(k), (k) => k !== input.yesterday[slot], (k) => !input.recent.includes(k)];
    let cands: ScoredKind[] = [];
    for (let n = rules.length; n >= 0 && cands.length === 0; n--) cands = pool.filter((k) => rules.slice(0, n).every((r) => r(k)));
    const kind = draw(cands, w, seeded(input.day, slot));
    chosen.push(kind);
    // The format: never the picture in both slots on one day (the picture is the occasional post, the video the rule).
    const format: PostFormat = pictureDrawn ? "video" : (draw(["video", "picture"] as unknown as ScoredKind[], fw, seeded(input.day, `${slot}:format`)) as unknown as PostFormat);
    if (format === "picture") pictureDrawn = true;
    picks[slot] = { kind, game: gameFor(kind, input.day, input.games), format };
  }
  return picks;
}

export interface OptimizeReport {
  /** Eastern day the report was made. */
  day: string;
  /** The day the picks are for. */
  forDay: string;
  /** Posts that counted (in the age window, on a site with numbers). */
  counted: number;
  scores: KindScore[];
  games: GameScore[];
  formats: FormatScore[];
  /** Each pool kind's weight in the draw. */
  weights: Record<string, number>;
  /** The picks written, or null (switched off). */
  picks: DayPicks | null;
  /** One plain sentence: what it picked and why. */
  why: string;
}

export interface LoopStep {
  report: OptimizeReport;
  /** The schedule entry to write, or null (switched off). */
  entry: StandingEntry | null;
}

export function describePick(p: Pick): string {
  return `${p.game ? `${KIND_NAME[p.kind]} (${GAME_NAME[p.game]})` : KIND_NAME[p.kind]}${p.format === "picture" ? ", as a picture" : ""}`;
}

function scoreLine(scores: KindScore[], w: Record<string, number>, formats: FormatScore[] = []): string {
  const parts = POOL_KINDS.map((k) => {
    const s = scores.find((x) => x.kind === k);
    return `${KIND_NAME[k]} ${s?.score != null ? s.score : `– (${s?.posts ?? 0} of ${MIN_POSTS} posts)`}`;
  });
  const unknown = POOL_KINDS.filter((k) => scores.find((x) => x.kind === k)?.score == null);
  const prior = unknown.length ? ` A kind with no score yet is weighted at the average (${w[unknown[0]]}) until it has ${MIN_POSTS} posts over ${MIN_DAYS} days.` : "";
  const fw = formatWeights(formats);
  const pic = formats.find((f) => f.format === "picture");
  const fmt = ` Video ${fw.video} vs picture ${fw.picture}${pic?.score == null ? ` (the picture's own score needs ${MIN_POSTS} posts on sites that post both; it has ${pic?.posts ?? 0})` : ""}.`;
  return `Scores (1.0 = an average post on its site): ${parts.join(", ")}.${prior}${fmt}`;
}

/** One day of the loop: the scores, and the picks for `day` (today + LEAD_DAYS). */
export function step(input: { posts: ScoredPost[]; now: number; day: string; off: boolean; yesterday: Record<OpenSlot, ScoredKind>; recent: ScoredKind[]; pool?: ScoredKind[] }): LoopStep {
  const today = easternOf(input.now)?.day ?? "";
  const { counted, scores, games, formats } = scoreKinds(input.posts, input.now);
  const w = weights(scores, input.pool?.length ? input.pool : POOL_KINDS);
  const base = { day: today, forDay: input.day, counted, scores, games, formats, weights: w };
  if (input.off) {
    const stay = `${KIND_NAME[input.yesterday.morning]} at 7am, ${KIND_NAME[input.yesterday.evening]} at 7pm`;
    return { report: { ...base, picks: null, why: `Switched off: the schedule stays as it stands (${stay}). ${scoreLine(scores, w, formats)}` }, entry: null };
  }
  const picks = rotate({ day: input.day, scores, games, formats, yesterday: input.yesterday, recent: input.recent, pool: input.pool });
  const why = `${input.day}: ${describePick(picks.morning)} at 7am, ${describePick(picks.evening)} at 7pm, drawn by score (never a kind from the last ${NO_REPEAT_DAYS} days). ${scoreLine(scores, w, formats)}`;
  const entry: StandingEntry = {
    from: input.day,
    morning: picks.morning.kind,
    evening: picks.evening.kind,
    ...(picks.morning.game ? { morningGame: picks.morning.game } : {}),
    ...(picks.evening.game ? { eveningGame: picks.evening.game } : {}),
    ...(picks.morning.format === "picture" ? { morningFormat: "picture" as const } : {}),
    ...(picks.evening.format === "picture" ? { eveningFormat: "picture" as const } : {}),
  };
  return { report: { ...base, picks, why }, entry };
}
