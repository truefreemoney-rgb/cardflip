import type { GameId } from "@/lib/types";
import type { PostKind } from "@/lib/server/social";

/**
 * One-off social plans for a given Eastern day (Chris 09-30: "for the posts
 * on 9/30 … i want to make sure we get as many users coming in as
 * possible"). A day with no entry posts the standing mix (socialPublish.ts
 * SLOTS: 7am set spotlight, 1pm Pokémon movers video, 7pm Pokémon drops).
 * Pure, so the publisher, the picture route and the video script
 * (scripts/social-video.mjs) all read the same plan.
 */
export interface DayPlan {
  /** The 7am slot posts this kind instead of SLOTS.morning. */
  morning?: PostKind;
  /** The 7pm slot posts this kind instead of SLOTS.evening ("games" = all five games in one picture). */
  evening?: PostKind;
  /** The game the 7am angle runs for (phase 3: the optimizer's pick; angleGameOrder puts it first). */
  morningGame?: AngleGame;
  eveningGame?: AngleGame;
  /** The 1pm slot posts this kind instead of SLOTS.midday (10-06, Chris: all styles rotate across all three slots; 1pm is always the video). */
  midday?: PostKind;
  middayGame?: AngleGame;
  /** The slot posts its picture instead of its video on the sites that take both (phase 5; absent = video). */
  morningFormat?: PostFormat;
  eveningFormat?: PostFormat;
  /** The 1pm movers post and video mix Pokémon and Magic gainers (MIXED_PER_GAME each) and the video ends on every game. */
  mixedMovers?: boolean;
  /** Pokémon pictures and captions say the scanner also reads the other games. */
  alsoScans?: boolean;
  /**
   * The set spotlight's set (a Pokémon set id, "base4"), when Chris approved a
   * preview: the date hash runs over the sets that qualify that minute, so a
   * price run or an engine change can move the pick after he said yes (09-30:
   * Base Set 2 approved, a pool fix turned it into Call of Legends).
   */
  set?: string;
}

export const DAY_PLANS: Record<string, DayPlan> = {
  // 7am keeps the set spotlight (Pokémon, "also scans"), 7pm is the all-games picture (Chris: "switch 7am and 7pm";
  // that day's drops were -8% moves, so the set post stayed and the drops sat out).
  "2026-09-30": { mixedMovers: true, alsoScans: true, evening: "games", set: "base4" },
};

/** "five" for the small counts a caption says out loud. */
export function countWord(n: number): string {
  return ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"][n] ?? String(n);
}

/**
 * A standing change to the schedule (10-02, the daily optimization loop):
 * from this Eastern day on, 7am and 7pm post these kinds, until a later
 * entry says otherwise. Each entry is the whole picture for both slots; a
 * slot it leaves out posts its SLOTS kind. The entries live in settings
 * (lib/server/socialSchedule.ts loads them into this module, so dayPlan
 * stays sync and every reader of it sees the same schedule). A one-off
 * DAY_PLANS entry still wins on its day.
 */
export interface StandingEntry {
  from: string;
  morning?: PostKind;
  evening?: PostKind;
  /** The game an angle kind in that slot runs for (phase 3, the daily rotation). */
  morningGame?: AngleGame;
  eveningGame?: AngleGame;
  /** 1pm (10-06): the kind and its game; always the video, so no format. */
  midday?: PostKind;
  middayGame?: AngleGame;
  /** video (the default when absent) or picture (phase 5: the optimizer's occasional static post). */
  morningFormat?: PostFormat;
  eveningFormat?: PostFormat;
}
/** What a slot posts on the sites that take both: the rendered MP4, or the picture drawn from the same cards. */
export type PostFormat = "video" | "picture";
export const POST_FORMATS: PostFormat[] = ["video", "picture"];
let standing: StandingEntry[] = [];
/** Replace the standing schedule this process reads (oldest first inside). */
export function setStanding(entries: StandingEntry[]): void {
  standing = [...entries].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}
/** The standing entry in force on a day: the latest one that has started. */
export function standingFor(day: string): StandingEntry | undefined {
  let hit: StandingEntry | undefined;
  for (const e of standing) if (e.from <= day) hit = e;
  return hit;
}

export function dayPlan(day: string | undefined): DayPlan {
  if (!day) return {};
  const s = standingFor(day);
  if (!s) return DAY_PLANS[day] || {};
  return {
    ...(s.morning ? { morning: s.morning } : {}),
    ...(s.evening ? { evening: s.evening } : {}),
    ...(s.morning && s.morningGame ? { morningGame: s.morningGame } : {}),
    ...(s.evening && s.eveningGame ? { eveningGame: s.eveningGame } : {}),
    ...(s.midday ? { midday: s.midday } : {}),
    ...(s.midday && s.middayGame ? { middayGame: s.middayGame } : {}),
    ...(s.morningFormat ? { morningFormat: s.morningFormat } : {}),
    ...(s.eveningFormat ? { eveningFormat: s.eveningFormat } : {}),
    ...DAY_PLANS[day],
  };
}

/** The format a slot posts on a day: the plan's, else video (1pm is always the video: the shared file every site posts). */
export function slotFormat(slot: "morning" | "midday" | "evening", day: string | undefined): PostFormat {
  const p = dayPlan(day);
  return (slot === "morning" ? p.morningFormat : slot === "evening" ? p.eveningFormat : undefined) ?? "video";
}

/** The games a mixed movers post draws from, in the order they alternate. */
export const MIXED_GAMES: GameId[] = ["pokemon", "mtg"];
export const MIXED_PER_GAME = 3;

/** Every game, in the site's switch order. */
export const POST_GAME_ORDER: GameId[] = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"];

/** Game names as posts write them: "Yu-Gi-Oh" without the "!" (house voice, no exclamation marks). */
export const POST_GAME_NAMES: Record<GameId, string> = {
  pokemon: "Pokémon",
  mtg: "Magic",
  lorcana: "Lorcana",
  onepiece: "One Piece",
  yugioh: "Yu-Gi-Oh",
};

/** "A, B, C and D". */
export function listNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** The games a post does NOT cover, by post name, in switch order. */
export function otherGameNames(covered: GameId[]): string[] {
  return POST_GAME_ORDER.filter((g) => !covered.includes(g)).map((g) => POST_GAME_NAMES[g]);
}

/**
 * Hashtags. Threads turns only the FIRST into its topic, so the biggest
 * community goes first; Bluesky makes a facet only of [A-Za-z][A-Za-z0-9]*,
 * so no hyphens. Lists are cut from the END to fit a site (fitText: X and
 * Bluesky by length, Instagram and TikTok at five tags), so order = priority.
 * games (Chris 09-30: "include hashtags for all the games, i want the
 * biggest reach possible"): one tag per game first, so every site names every
 * game. Capped at FIVE (10-01: more reads as spam and TikTok shows five):
 * gamesTags picks the five best for the games a post covers.
 */
export const GAME_HASHTAGS: Record<GameId, string[]> = {
  pokemon: ["PokemonTCG", "PokemonCards"],
  mtg: ["MTG", "MagicTheGathering"],
  lorcana: ["DisneyLorcana", "Lorcana"],
  onepiece: ["OPTCG", "OnePieceCardGame"],
  yugioh: ["Yugioh", "YuGiOhTCG"],
};
/** The general tags that fill the room a post's game tags leave. */
export const GENERAL_TAGS = ["TCG", "TradingCards", "CardCollector"];
/** The most hashtags any post carries (TikTok and Instagram both stop at five). */
export const MAX_TAGS = 5;

/**
 * The tags for a post that covers `games`: each game's own first tag (in the
 * order given), then the general ones, then each game's second tag, cut at
 * MAX_TAGS. Five games = the five game tags; four = four plus #TCG.
 */
export function gamesTags(games: GameId[]): string[] {
  const out: string[] = [];
  const add = (t: string | undefined) => {
    if (t && !out.includes(t)) out.push(t);
  };
  // The site's game order, not the post's (Threads makes the first tag its topic: the biggest community goes first).
  const ordered = POST_GAME_ORDER.filter((g) => games.includes(g));
  for (const g of ordered) add(GAME_HASHTAGS[g][0]);
  for (const t of GENERAL_TAGS) add(t);
  for (const g of ordered) add(GAME_HASHTAGS[g][1]);
  return out.slice(0, MAX_TAGS);
}

export const PLAN_TAGS = {
  games: gamesTags(POST_GAME_ORDER),
  mixedMovers: ["PokemonTCG", "MTG", "MagicTheGathering", "TCG", "TradingCards"],
  pokemonAlsoScans: ["PokemonTCG", "PokemonCards", "TCG", "TradingCards"],
} as const;

/**
 * 10-01 (the owner: "most views and clicks on every site"). From this Eastern
 * day on, the standing 7pm post is "the biggest price jump in each game this
 * week" (a per-game top gainer, the old lead card where a game has none), and
 * the 7am set spotlight leads with the card that moved UP the most. Earlier
 * days keep what already went out, so a re-render of an old day is unchanged.
 */
export const JUMPS_FROM = "2026-10-01";
export function jumpsOn(day: string | undefined): boolean {
  return Boolean(day) && (day as string) >= JUMPS_FROM;
}
/**
 * 10-02 (first read of a week of stats: gains posts 22 views a post, set
 * spotlights 13). From this Eastern day on, the 7am set spotlight picks its
 * set from the sets that have a real riser among their five most valuable
 * cards, when any do, so the cover is a gain. Earlier days keep their set.
 */
export const RISER_SETS_FROM = "2026-10-03";
export function riserSetsOn(day: string | undefined): boolean {
  return Boolean(day) && (day as string) >= RISER_SETS_FROM;
}

/**
 * 10-02 (the 7pm video opened on the same card as the 1pm: Dark Porygon2 ▲130%
 * twice in one day, twin covers side by side). From this Eastern day on, a
 * game's 7pm jump skips the cards that day's 1pm gains post shows, when
 * another gainer is there to take its place. Earlier days keep their card.
 */
export const FRESH_JUMPS_FROM = "2026-10-02";
export function freshJumpsOn(day: string | undefined): boolean {
  return Boolean(day) && (day as string) >= FRESH_JUMPS_FROM;
}

/**
 * A game's top gainer must have moved at least this much to be "the biggest jump" (a +2% week is no headline: that game
 * keeps its lead card). The set spotlight uses it too: a riser takes the lead over the set's most valuable card when it
 * rose this much, or when that card fell (a +3% riser under a steady leader changes nothing).
 */
export const JUMP_MIN_PCT = 5;

/**
 * One short question per post (the owner 10-01: likes, comments and shares
 * up). Plain, no emoji, no link, no "comment below"; a small pool per kind,
 * shuffled per cycle like the backing tracks (scripts/lib/audio-plan.mjs
 * dayShuffle: a mulberry32 stream seeded by the day), so the same question
 * never runs two days in a row and every one gets its turn. An entry may
 * name the set ("Which card from Base Set 2 is your favourite?").
 */
type QuestionPool = Array<string | ((setName: string) => string)>;
export const QUESTIONS: Record<PostKind, QuestionPool> = {
  movers: ["Which one would you hold?", "Did you see any of these coming?", "Which of these are you watching?"],
  dips: ["Buying the dip on any of these?", "Which of these would you pick up at this price?", "Is this a dip to buy or a card to skip?"],
  set: [(s) => `Which card from ${s} is your favourite?`, "Did you pull any of these back in the day?", (s) => `Do you still have any ${s} cards?`],
  games: ["Which game are you collecting?", "Which of these games do you collect?", "Which game has your best card?"],
  card: ["Is this one in your collection?", "Would you keep it or sell it?"],
  guess: ["Did you guess it?", "Were you close?", "Higher or lower than you thought?"],
  thennow: ["Did you pick one up back then?", "Still climbing, or has it peaked?", "Would you buy it at today's price?"],
  versus: ["Which one would you rather own?", "Did you back the right card?", "Which one gets your pick?"],
  sleepers: ["Any of these in your binder?", "Which one would you grab for under five dollars?", "Which cheap card are you watching?"],
  top: ["Which of these would you most like to own?", "Have you ever held one of these?", "Which one surprised you?"],
};

/**
 * The five content angles (Chris 10-03, all five sample videos approved, docs/SOCIAL-ANGLES-PLAN.md):
 * guess the price, then vs now, head to head, sleepers under $5, most valuable. Each runs for the
 * games that have the data for it ("mixed" = one card per public game in one post); head to head
 * never pits cards of different games. The game ROTATES by day, one strict cycle per kind, each
 * kind's cycle offset from the others so two kinds do not land on the same game all week. Phase 3
 * hands the choice to the optimizer; until then this cycle is the choice.
 */
export const ANGLE_KINDS = ["guess", "thennow", "versus", "sleepers", "top"] as const;
export type AngleKind = (typeof ANGLE_KINDS)[number];
export type AngleGame = GameId | "mixed";
export const ANGLE_GAMES: Record<AngleKind, AngleGame[]> = {
  guess: ["pokemon", "mtg", "lorcana", "onepiece", "yugioh", "mixed"],
  // Needs months of history and a second price source: Pokémon's and Magic's began mid-May 2026, the other three 09-30.
  thennow: ["pokemon", "mtg"],
  versus: ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"],
  sleepers: ["pokemon", "mtg", "mixed"],
  // Only the refereed games (social.ts TOP_GAMES): the dearest Yu-Gi-Oh rows are TCGplayer placeholders. "mixed" needs three games, so it falls through to Pokémon until a third game has a referee.
  top: ["pokemon", "mtg", "mixed"],
};
export function isAngleKind(kind: string): kind is AngleKind {
  return (ANGLE_KINDS as readonly string[]).includes(kind);
}

/**
 * A kind's game cycle on an Eastern day: the cycle's pick first, then the rest
 * in ANGLE_GAMES order. One strict cycle per kind, offset per kind.
 */
export function angleCycle(kind: AngleKind, day: string): AngleGame[] {
  const list = ANGLE_GAMES[kind];
  const n = Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000) + ANGLE_KINDS.indexOf(kind) * 2;
  const i = ((n % list.length) + list.length) % list.length;
  return [...list.slice(i), ...list.slice(0, i)];
}

/**
 * A kind's game order on an Eastern day: the day plan's game first when the
 * schedule names this kind for a slot (phase 3, the optimizer's pick, so the
 * draft, the picture and the video all agree with the plan tag), else the
 * cycle's pick; then the rest, so the caller takes the first that has data
 * that day (a game that is not public yet, or has nothing to say, hands the
 * day to the next).
 */
export function angleGameOrder(kind: AngleKind, day: string): AngleGame[] {
  const list = angleCycle(kind, day);
  const p = dayPlan(day);
  const planned = p.morning === kind ? p.morningGame : p.evening === kind ? p.eveningGame : p.midday === kind ? p.middayGame : undefined;
  if (!planned || !list.includes(planned)) return list;
  return [planned, ...list.filter((g) => g !== planned)];
}

/** The plan's game for a kind on a day, when the schedule names it for a slot (planTag reads it). */
export function plannedGame(kind: PostKind, day: string): AngleGame | undefined {
  const p = dayPlan(day);
  return p.morning === kind ? p.morningGame : p.evening === kind ? p.eveningGame : p.midday === kind ? p.middayGame : undefined;
}

/** The pool's order for one cycle; the first of a cycle never repeats the last of the one before it. */
function cycleOrder(cycle: number, n: number): number[] {
  const shuffle = (c: number) => {
    let a = (Math.imul(c ^ 0x9e3779b9, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0;
    const rand = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    return order;
  };
  const order = shuffle(cycle);
  if (n > 1 && order[0] === shuffle(cycle - 1)[n - 1]) [order[0], order[1]] = [order[1], order[0]];
  return order;
}

/** The question a post of this kind carries on an Eastern day. */
export function questionFor(kind: PostKind, day: string, setName = ""): string {
  const pool = QUESTIONS[kind];
  const n = Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const pick = pool[cycleOrder(Math.floor(n / pool.length), pool.length)[((n % pool.length) + pool.length) % pool.length]];
  return typeof pick === "function" ? pick(setName || "this set") : pick;
}

/** Items laid out as a fan, the middle one on top: the first of `sorted` goes in the centre, the rest alternate right and left of it. */
export function fanOrder<T>(sorted: T[]): T[] {
  const n = sorted.length;
  const out: (T | undefined)[] = new Array(n).fill(undefined);
  const mid = Math.floor((n - 1) / 2);
  let k = 0;
  for (let d = 0; k < n; d++) {
    for (const i of d === 0 ? [mid] : [mid + d, mid - d]) if (i >= 0 && i < n && k < n && out[i] === undefined) out[i] = sorted[k++];
  }
  return out as T[];
}
