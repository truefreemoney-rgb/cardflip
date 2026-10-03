// Social videos (09-25, Chris: "i would really like to see a prototype";
// 09-26: "pick cards that are the biggest movers and shakers"; 09-30: TikTok
// is posted BY HAND, so this renders the videos he posts). No footage: each
// is a 1080x1920 HTML scene (scripts/lib/social-scene.mjs) stepped one frame
// at a time by headless Chromium, then stitched to an H.264 MP4 by ffmpeg.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-next-stubs.mjs scripts/social-video.mjs [mode] [--day YYYY-MM-DD]
//     [--out path.mp4 | --out-dir dir] [--fps 24] [--audio path|none] [--register] [--skip-if-done] [--force]
//
// Modes:
//   (none)     the 1pm movers video for --day (today, Eastern), what every site
//              posts at 1:05pm. The morning render pings run this; it skips
//              when the night render already made it. It also fills the
//              TikTok 1pm row from the same file.
//   --package  THE NIGHT RENDER: tomorrow's three TikTok videos (--day
//              overrides; before 7am ET it means today), one per slot,
//              remaking only slots with nothing usable registered (missing,
//              or made under a day plan that has since changed):
//                7:05am  the morning picture post as video (the set spotlight)
//                1:05pm  the movers video, the SAME file every site posts
//                7:05pm  the all-games picture post as video
//              [--min-hour N] exits when a schedule ping fires earlier than N
//              o'clock Eastern (the EST-side 7pm ping runs an hour early).
//   --slot morning|midday|evening   one TikTok slot by itself (or a comma list of them).
//   --kind <kind>                   with --out: one video of that kind by itself, no slot, no register (a look at an
//                                   angle: guess, thennow, versus, sleepers, top; or set, movers, dips, games).
//   --look classic|ember|arctic     force one look (lib/social-looks.mjs); the day's rotation otherwise.
//   --force    with --slot: remake the named slot(s) even when ready (the workflow's tiktok_force), e.g. a registered video that
//              shows a card the rules now leave out. Refused without --slot, so no run can redraw every ready video. A remake
//              over an existing row is parked under a NEW blob path (Blob's CDN keeps serving an overwritten path's old bytes
//              for up to a month) and the old file is deleted; the 1pm slot rewrites both the TikTok row and the row every site posts.
//
// --register: parks the MP4 on Vercel Blob and writes the settings rows
// (lib/server/socialTiktok.ts registerTiktokVideo). The 1pm movers video is
// registered where the publisher looks (lib/socialVideo.ts videoKey), so every
// site posts it; the 7am and 7pm videos are TikTok-only rows and never make
// the other sites post video in those slots. The EXACT cards drawn are frozen
// into the row (`cards` / `leads`) and each row carries its TikTok caption,
// built from that same list, so text and video cannot disagree (09-26: a
// caption once said "Mysterious Treasures" over Base Set 2 art because each
// was computed at a different moment).
// --skip-if-done: exit 0 without rendering when the row already exists AND was made under the day plan in force now (the night render draws it
// hours ahead; a plan pushed at 9am must not be answered by "it exists").
import fs from "node:fs";
import path from "node:path";
import { artDataUri, renderMp4, sceneHtml } from "./lib/social-scene.mjs";
import { angleScene, beatsOf } from "./lib/social-angles.mjs";
import { sectionFor, timelineFor, trackIndex } from "./lib/audio-plan.mjs";
import { LOOKS, lookFor } from "./lib/social-looks.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const FPS = Number(arg("--fps", 24));
const REGISTER = has("--register");
const FORCE = has("--force");
const PACKAGE = has("--package");
const ONLY = arg("--slot", "").split(",").filter(Boolean);
/** --look classic|ember|arctic forces one look (eyeballing a template); the day's rotation otherwise. */
const FORCED_LOOK = arg("--look", "");
if (FORCED_LOOK && !LOOKS.includes(FORCED_LOOK)) { console.error(`--look must be one of ${LOOKS.join(", ")}`); process.exit(2); }

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { topMovers, mixedMovers, recentlyFeatured, setSpotlight, gameLeads, gameJumps, isJump, socialDrafts, variantLabel, angleData, thenMonth, versusVerdict } = await import(at("lib/server/social.ts"));
const { dayPlan, jumpsOn, POST_GAME_NAMES, POST_GAME_ORDER, countWord, isAngleKind, listNames } = await import(at("lib/socialPlan.ts"));
// Every video ends on the "Now scanning" card naming all the games we scan (Chris 10-02: "the final card on all 3
// doesn't list all games we scan"). It used to be the mixed-movers video only; the rest ended on a Pokémon-era line.
const ALL_GAMES_OUTRO = { games: POST_GAME_ORDER.map((g) => POST_GAME_NAMES[g]) };
const { fallbackArtUrl } = await import(at("lib/cardArt.ts"));
const { TIMELINE, VIDEO_W: W, VIDEO_H: H, videoKey, videoSeconds } = await import(at("lib/socialVideo.ts"));
const { eastern, SLOTS, VIDEO_SLOT } = await import(at("lib/server/socialPublish.ts"));
const { TIKTOK_SLOTS } = await import(at("lib/socialTiktok.ts"));
const { parseVideoSpec } = await import(at("lib/socialVideo.ts"));
const { candidateKinds, planTag, readSlot, registerTiktokVideo, sharedMovers, sharedVideo, tiktokTargetDay, TIKTOK_GAME: game } = await import(at("lib/server/socialTiktok.ts"));
const { slotKind } = await import(at("lib/server/socialPublish.ts"));
const { getSetting } = await import(at("lib/server/settings.ts"));
// The optimization loop's standing schedule (settings): loaded before planTag / candidateKinds ask what a slot posts.
await (await import(at("lib/server/socialSchedule.ts"))).ensureSchedule();

if (ONLY.some((s) => !TIKTOK_SLOTS.includes(s))) { console.error(`--slot must be one of ${TIKTOK_SLOTS.join(", ")}`); process.exit(2); }
if (FORCE && PACKAGE && !ONLY.length) { console.error("--force remakes only the slots named with --slot"); process.exit(2); }

// Same day the publisher keys on (Eastern). The night render means the day
// AFTER the night it runs in (tiktokTargetDay), never a UTC date.
const now = Date.now();
const day = arg("--day", PACKAGE ? tiktokTargetDay(now) : eastern(now).day);
if (PACKAGE && !arg("--day")) {
  const minHour = Number(arg("--min-hour", 0));
  const { hour } = eastern(now);
  if (hour >= 7 && hour < minHour) { console.log(`${hour}:00 ET is before the ${minHour}:00 ET render window, nothing to do`); process.exit(0); }
}
// The legacy (no-mode) render is the 1pm movers video, keyed by the video slot's kind.
const KIND = SLOTS[VIDEO_SLOT].kind;
if (!PACKAGE && !ONLY.length && has("--skip-if-done")) {
  const row = parseVideoSpec(await getSetting(videoKey(game, KIND, day)));
  // A row from before rows carried a plan counts as current; one made under another plan is remade.
  if (row && (!row.plan || row.plan === planTag("midday", day))) { console.log(`video already registered for ${day}, nothing to do`); process.exit(0); }
  if (row) console.log(`the registered video for ${day} was made under "${row.plan}", the plan now is "${planTag("midday", day)}": remaking it`);
}

// Backing tracks: royalty-free MP3s Chris drops into public/social/audio
// (Pixabay Content License, no attribution needed; see the README there).
// One is picked per day, rotating through the folder by name; none = silent.
// The three videos of a day are offset by slot (1pm keeps the plain day
// rotation, so the shared movers video sounds as it always did; 7am is one
// track on, 7pm two), so a day's videos do not share a track once the folder
// holds three. With fewer tracks than slots the videos that land on the same
// track start EIGHT BARS further in instead of repeating the same opening,
// moved onto the beat of the part they land in and off any drumless breakdown
// (lib/audio-plan.mjs). --audio <mp3> forces one for every video, --audio
// none forces silent. Trimmed to the video, fade-out at the end. (A
// synthesized loop was tried 09-25: "i hate the audio".)
const AUDIO_DIR = process.env.SOCIAL_AUDIO_DIR ? path.resolve(process.env.SOCIAL_AUDIO_DIR) : path.join(root, "public/social/audio");
const tracks = fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR).filter((f) => /\.mp3$/i.test(f)).sort() : [];
const dayIndex = Math.round(Date.parse(day) / 86_400_000);
const forcedAudio = arg("--audio", "");
/** { file, name, section }: the track for a slot, and how many 8-bar sections in it starts (0 = the track's own start). */
function trackFor(slot) {
  if (forcedAudio) return { file: forcedAudio, name: path.basename(forcedAudio), section: 0 };
  if (!tracks.length) return { file: "none", name: "", section: 0 };
  const i = trackIndex(slot, dayIndex, tracks.length);
  return { file: path.join(AUDIO_DIR, tracks[i]), name: tracks[i], section: sectionFor(slot, dayIndex, tracks.length) };
}
const beatCache = new Map();
async function beatOf(file) {
  if (!beatCache.has(file)) beatCache.set(file, (await import("./lib/beat.mjs")).analyzeBeat(file, { clipSeconds: 18 }));
  return beatCache.get(file);
}

const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "public/brand/cardflip-logo.png")).toString("base64")}`;
// Satori-style glyph gaps: the Ubuntu runner may have no ★ (Scryfall's foil-only numbers).
const numberText = (n) => String(n).replace(/\s*[☆★]\s*/g, " Star ").trim();
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// TCGplayer's Yu-Gi-Oh set names carry a print-run tag ("… (Worldwide English)") nobody says out loud.
const cleanSet = (s) => s.replace(/\s*\(Worldwide English\)$/i, "");

/** "▲ 12.3% this week" and its colour; a price that had not held claims no move. `hero` = big and up from the card's first second (the cover of a video that leads with its riser). */
function moveLine(c, hero = false) {
  if (c.unsettled) return { text: "", cls: "muted" };
  if (Math.abs(c.pct) < 1) return { text: "steady this week", cls: "muted" };
  const big = hero && c.pct > 0;
  return { text: `${c.pct > 0 ? "▲" : "▼"} ${Math.abs(c.pct).toFixed(1)}% this week`, cls: c.pct > 0 ? (big ? "up big" : "up") : "down", ...(big ? { early: true } : {}) };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Art for each card; strict (the TikTok videos) retries with a pause between
 * tries (a host that failed three times in a row a second apart was down for
 * that second, not for good) and leaves out a card that still has none, never
 * a blank box. Each kind then decides whether a short list is still that video.
 */
async function withArt(list, strict) {
  const out = [];
  for (const c of list) {
    let art = await artDataUri(c.imageUrl, fallbackArtUrl);
    for (let i = 1; strict && !art && i <= 4; i++) {
      await sleep(i * 1500);
      art = await artDataUri(c.imageUrl, fallbackArtUrl);
    }
    if (!art && strict) { console.warn(`no art for ${c.name}, leaving it out`); continue; }
    out.push({ ...c, art });
  }
  return out;
}

/**
 * The scene for one kind on one day: what is drawn, and the frozen list the
 * TikTok caption and the publisher's caption are built from. The lists come
 * from the same functions socialDrafts uses (lib/server/social.ts), so the
 * video shows what the picture post would.
 */
async function build(kind, strict) {
  if (kind === "movers" || kind === "dips") {
    const mixed = kind === "movers" && Boolean(dayPlan(day).mixedMovers);
    const list = mixed ? await mixedMovers(day) : await topMovers(game, day, { direction: kind === "movers" ? "up" : "down", exclude: await recentlyFeatured(game, kind, day) });
    if (list.length < 3) throw new Error(`not enough ${kind} for ${day}`);
    console.log(`${kind}: ${list.length} cards${mixed ? " (mixed)" : ""}, first ${list[0].name} ${list[0].pct > 0 ? "+" : ""}${list[0].pct.toFixed(1)}%`);
    // Countdown: the smallest move first, the biggest last (No. 1). A mixed
    // list is ranked inside each game (P1, M1, P2, M2, … reversed ends on a
    // No. 1), so the label says the game: "Magic · No. 2".
    const inGame = new Map();
    const ranked = list.map((c) => {
      const g = c.game ?? game;
      inGame.set(g, (inGame.get(g) ?? 0) + 1);
      return { ...c, rankLabel: mixed ? `${POST_GAME_NAMES[g]} · No. ${inGame.get(g)}` : "" };
    });
    const shown = await withArt([...ranked].reverse(), strict);
    // A mixed video names every game in its outro and ranks inside each game: a card short of art makes it a different video.
    if (mixed && (shown.length !== list.length || shown.some((c) => !c.art))) throw new Error(`card art missing: ${list.filter((c) => !shown.some((s) => s.cardId === c.cardId && s.art)).map((c) => c.name).join(", ")}`);
    if (shown.length < 3) throw new Error(`card art missing for ${kind}`);
    const mixedGames = POST_GAME_ORDER.filter((g) => list.some((m) => (m.game ?? game) === g)).map((g) => POST_GAME_NAMES[g]);
    const n = shown.length;
    return {
      kind,
      mixed,
      intro: kind === "dips"
        ? { kicker: "Pokémon · price drops", title: "Biggest drops", sub: `This week's steepest falls, No. ${n} to No. 1` }
        : {
            kicker: mixed ? mixedGames.join(" + ") : "Pokémon · movers of the week",
            title: "Biggest movers",
            sub: mixed ? `This week's top ${Math.ceil(n / Math.max(1, mixedGames.length)) === 3 ? "three" : Math.ceil(n / Math.max(1, mixedGames.length))} gainers in each game` : `This week's top gainers, No. ${n} to No. 1`,
          },
      cards: shown.map((c, i) => ({
        rank: mixed ? c.rankLabel : `No. ${n - i}`,
        art: c.art,
        name: c.name,
        meta: `${mixed ? `${c.setName} · ` : ""}#${numberText(c.number)}${variantLabel(c.variant) ? ` · ${variantLabel(c.variant)}` : ""}`,
        to: c.to,
        pct: moveLine(c),
      })),
      outro: ALL_GAMES_OUTRO,
      frozen: { cards: [...shown].reverse().map((c) => ({ cardId: c.cardId, name: c.name, number: c.number, setName: c.setName, variant: c.variant, from: c.from, to: c.to, pct: c.pct, ...(c.game ? { game: c.game } : {}) })) },
    };
  }
  if (kind === "set") {
    const spot = await setSpotlight(game, day);
    if (!spot) throw new Error(`no set spotlight for ${day}`);
    console.log(`set: ${spot.setName} (${spot.setId}) · ${spot.cards.length} cards${spot.leadId ? ` · leads with ${spot.cards[0].name} ${spot.cards[0].pct.toFixed(1)}%` : ""}`);
    // spot.cards is the caption's order: the biggest riser first when one rose (10-01), then the rest dearest first. The video
    // opens on the riser (its cover), then counts the others down; every card keeps its value rank in its label.
    const rest = spot.cards.filter((c) => c.cardId !== spot.leadId);
    const order = spot.leadId ? [spot.cards[0], ...[...rest].reverse()] : [...spot.cards].reverse();
    const shown = await withArt(order, strict);
    // The caption says "five of the most valuable": a set short of one card's art is not that post.
    if (shown.length !== spot.cards.length) throw new Error(`card art missing for the ${spot.setName} spotlight`);
    const n = shown.length;
    return {
      kind,
      mixed: false,
      intro: { kicker: "Pokémon · set spotlight", title: spot.setName, sub: `${countWord(n).replace(/^./, (c) => c.toUpperCase())} of the most valuable cards right now` },
      cards: shown.map((c, i) => ({
        rank: `No. ${c.rank ?? n - i}`,
        art: c.art,
        name: c.name,
        meta: `#${numberText(c.number)}${variantLabel(c.variant) ? ` · ${variantLabel(c.variant)}` : ""}`,
        to: c.to,
        pct: moveLine(c, c.cardId === spot.leadId),
      })),
      outro: ALL_GAMES_OUTRO,
      frozen: { cards: spot.cards.map((c) => ({ cardId: c.cardId, name: c.name, number: c.number, setName: c.setName, variant: c.variant, from: c.from, to: c.to, pct: c.pct, ...(c.unsettled ? { unsettled: true } : {}), ...(c.rank ? { rank: c.rank } : {}) })) },
    };
  }
  if (kind === "games") {
    // From JUMPS_FROM each game's biggest weekly jump (a game with none keeps its lead card), biggest first: the video opens on the best one.
    const leads = jumpsOn(day) ? await gameJumps(day) : await gameLeads(day);
    console.log(`games: ${leads.map((l) => `${l.game} ${l.name} $${l.price}${isJump(l) ? ` +${l.pct.toFixed(1)}%` : ""}`).join(" | ")}`);
    const shown = await withArt(leads, true);
    // Every public game is in the 7pm post (Chris 09-30): a video short of one is not that post, and its caption says so. Fail, so the run is retried.
    if (shown.length !== leads.length) throw new Error(`card art missing for the all-games video: ${leads.filter((l) => !shown.some((s) => s.game === l.game)).map((l) => `${l.game} (${l.name})`).join(", ")}`);
    if (shown.length < 3) throw new Error(`fewer than three games have card art for ${day}`);
    const n = shown.length;
    const jumped = shown.some(isJump);
    const allJumped = shown.every(isJump);
    return {
      kind,
      mixed: false,
      intro: jumped
        // "In each game" over 2 jumps + 3 price-today cards overclaimed (10-01); match the picture's "Biggest price jumps this week."
        ? { kicker: allJumped ? "Biggest price jump" : "Biggest price jumps", title: allJumped ? "In every game" : "This week", sub: allJumped ? "This week's top gainer in every game" : "This week's top gainers, and a card from the rest" }
        : { kicker: "One scanner", title: `${cap(countWord(n))} card games`, sub: "A card from each, at today's market price" },
      cards: shown.map((c) => ({
        rank: POST_GAME_NAMES[c.game],
        art: c.art,
        name: c.name,
        meta: `${cleanSet(c.setName)} · ${/^[A-Z]/.test(c.number) ? numberText(c.number) : `#${numberText(c.number)}`}${isJump(c) && variantLabel(c.variant ?? "") ? ` · ${variantLabel(c.variant)}` : ""}`,
        to: c.price,
        pct: isJump(c) ? { text: `▲ ${c.pct.toFixed(1)}% this week`, cls: "up big", early: true } : { text: "market price today", cls: "muted" },
      })),
      outro: ALL_GAMES_OUTRO,
      frozen: { leads: shown.map((c) => ({ game: c.game, name: c.name, setName: c.setName, number: c.number, price: c.price, ...(isJump(c) && c.cardId ? { cardId: c.cardId, from: c.from, pct: c.pct, ...(c.variant ? { variant: c.variant } : {}) } : {}) })) },
    };
  }
  if (isAngleKind(kind)) return buildAngle(kind, strict);
  throw new Error(`the video renderer has no scene for kind "${kind}"`);
}

/** A card's move line on an angle screen: a TCG stage card (no history) says today's price instead of a week. */
const angleMove = (c, hero = false) => (c.unsettled ? { text: "market price today", cls: "muted" } : moveLine(c, hero));

/**
 * The five content angles (10-03, docs/SOCIAL-ANGLES-PLAN.md phase 2): the SAME pick the draft and the picture use
 * (angleData), drawn on lib/social-angles.mjs screens instead of the count-down. guess = one "What's it worth?" reveal
 * per card (a mixed post: one card per game); thennow = the old price struck through, today's counts up; versus = two
 * cards, the question becomes the verdict; sleepers / top = the classic count-down screens. Every card must have art:
 * the captions say what the post is ("five of the most valuable", "one card from each game"), so a short list is not it.
 */
async function buildAngle(kind, strict) {
  const a = await angleData(kind, day);
  if (!a) throw new Error(`no ${kind} data for ${day}`);
  const gamesIn = POST_GAME_ORDER.filter((g) => a.cards.some((c) => (c.game ?? a.game) === g));
  const who = a.mixed ? listNames(gamesIn.map((g) => POST_GAME_NAMES[g])) : POST_GAME_NAMES[a.game];
  const shown = await withArt(a.cards, strict);
  if (shown.length !== a.cards.length) throw new Error(`card art missing for ${kind}: ${a.cards.filter((c) => !shown.some((s) => s.cardId === c.cardId)).map((c) => c.name).join(", ")}`);
  const metaOf = (c) => `${a.mixed ? `${POST_GAME_NAMES[c.game ?? a.game]} · ` : ""}${cleanSet(c.setName)} · ${/^[A-Z]/.test(c.number) ? numberText(c.number) : `#${numberText(c.number)}`}${variantLabel(c.variant ?? "") ? ` · ${variantLabel(c.variant)}` : ""}`;
  const frozen = {
    cards: a.cards.map((c) => ({ cardId: c.cardId, name: c.name, number: c.number, setName: c.setName, variant: c.variant ?? "", from: c.from, to: c.to, pct: c.pct, ...(c.game ? { game: c.game } : {}), ...(c.unsettled ? { unsettled: true } : {}), ...(c.thenDay ? { thenDay: c.thenDay } : {}) })),
    ...(a.pair ? { winner: a.pair.winner } : {}),
  };
  const n = shown.length;
  console.log(`${kind}: ${who} · ${shown.map((c) => `${c.name} ${c.to}${c.unsettled ? "" : ` ${c.pct > 0 ? "+" : ""}${c.pct.toFixed(1)}%`}`).join(" | ")}`);
  const base = { kind, mixed: a.mixed, outro: ALL_GAMES_OUTRO, frozen };
  if (kind === "guess") {
    return {
      ...base,
      intro: a.mixed ? { kicker: "Guess the price", title: "What's it worth?", sub: "One card from each game. Guess before it shows." } : { kicker: `${who} · guess the price`, title: "What's it worth?", sub: "One card. Guess before it shows." },
      screens: shown.map((c) => ({ type: "reveal", art: c.art, name: c.name, meta: metaOf(c), to: c.to, pct: angleMove(c, true) })),
    };
  }
  if (kind === "thennow") {
    const c = shown[0];
    const month = thenMonth(c);
    return {
      ...base,
      intro: { kicker: `${who} · then vs now`, title: `Since ${month}`, sub: "What one card did in a few months" },
      screens: [{ type: "thennow", art: c.art, name: c.name, meta: metaOf(c), thenLabel: month, then: c.from, to: c.to, pct: { text: `▲ ${Math.round(c.pct)}% since ${month}`, cls: "up big" } }],
    };
  }
  if (kind === "versus") {
    const p = a.pair;
    const side = (m) => { const c = shown.find((s) => s.cardId === m.cardId); return { art: c.art, name: c.name, meta: metaOf(c), to: c.to, pct: angleMove(c, true) }; };
    return {
      ...base,
      intro: { kicker: p.setName ? `${who} · ${p.setName}` : `${who} · head to head`, title: "Head to head", sub: p.byPrice ? "Two cards. Which is worth more?" : "Two cards, one week. Which one moved?" },
      screens: [{ type: "versus", a: side(p.a), b: side(p.b), win: p.winner, ask: p.byPrice ? "Which is worth more?" : "Which would you hold?", verdict: versusVerdict(p) }],
    };
  }
  // sleepers / top: counted down, the best last (No. 1); a mixed list labels each card with its game instead.
  const screens = [...shown].reverse().map((c, i) => ({ type: "beat", rank: a.mixed ? POST_GAME_NAMES[c.game ?? a.game] : `No. ${n - i}`, art: c.art, name: c.name, meta: metaOf(c), to: c.to, pct: angleMove(c, kind === "sleepers") }));
  if (kind === "sleepers") return { ...base, intro: { kicker: `${who} · under $5`, title: "Sleepers", sub: "Cheap cards moving the most this week" }, screens };
  return { ...base, intro: { kicker: `${who} · right now`, title: "Most valuable", sub: a.mixed ? "The dearest card in each game" : `The ${countWord(n)} dearest cards we price today` }, screens };
}

/**
 * The cold open (10-01): the card that stops a thumb, on frame 0. The biggest rise when one is 10% or more ("▲ 60%"), else the
 * dearest card at its price. Drops open on their title as before (a red number is a weak hook, 09-30 data).
 */
function hookFor(kind, cards) {
  if (kind === "dips" || !cards.length) return null;
  const rise = (c) => {
    const m = /▲ ([\d.]+)%/.exec(c.pct?.text ?? "");
    return m ? Number(m[1]) : 0;
  };
  const best = cards.reduce((a, c) => (rise(c) > rise(a) ? c : a), cards[0]);
  if (rise(best) >= 10) return { art: best.art, big: `▲ ${Math.round(rise(best))}%` };
  const dear = cards.reduce((a, c) => (Number(c.to) > Number(a.to) ? c : a), cards[0]);
  const n = Number(dear.to);
  return { art: dear.art, big: n >= 100 ? `$${Math.round(n).toLocaleString("en-US")}` : `$${n.toFixed(2)}` };
}

/** Render one video for a slot; returns what the registry needs. */
async function makeSlot(slot, kind, out, strict) {
  const built = await build(kind, strict);
  const angle = Boolean(built.screens);
  const cards = angle ? [] : built.cards;
  // How many BEATs the video holds: one per card on the count-down, a screen's own hold on an angle (a reveal holds two).
  const beats = angle ? beatsOf(built.screens) : cards.length;
  // The end card names every game we scan, one per beat (Chris 10-02: all three videos, not only the mixed one): two bars.
  const gamesOutro = Boolean(built.outro.games);
  const track = trackFor(slot);
  let withAudio = track.file !== "none" && fs.existsSync(track.file);
  if (track.file !== "none" && !withAudio) console.warn(`no backing track at ${track.file}, rendering silent`);
  // Timeline (seconds): intro → one beat per card → outro (lib/socialVideo.ts
  // defaults). With a track, the cut follows the music (Chris 09-25: "make the
  // video somewhat match the feel of the beat"): scripts/lib/beat.mjs finds the
  // tempo, the downbeat and where the track gets going; the intro is one bar,
  // card changes land on downbeats, the price pops on beat 3, and the art
  // pulses on every beat.
  let { intro: INTRO, beat: BEAT, outro: OUTRO } = TIMELINE;
  let PERIOD = 0, AUDIO_START = 0;
  if (withAudio) {
    const b = await beatOf(track.file);
    // Two bars per card (~4.2s with the 113 bpm track, ~26s for five), one-bar intro
    // and outro; the mixed outro names five games one per beat, then the address: two
    // bars. A repeat of the day's track starts 8 bars further in, moved off a drumless
    // stretch and onto the beat of the part it lands in (lib/audio-plan.mjs).
    const plan = timelineFor(b, { section: track.section, cards: beats, mixed: gamesOutro });
    PERIOD = plan.PERIOD;
    ({ INTRO, BEAT, OUTRO } = plan);
    AUDIO_START = plan.start;
    const nudge = Math.round((plan.start - plan.rawStart) * 1000);
    console.log(`beat: ${b.bpm} bpm, ${BEAT.toFixed(2)}s per card, ${track.name} from ${AUDIO_START.toFixed(2)}s${plan.rawStart !== b.start ? " (a later section: another video of the day has the opening)" : ""}${nudge ? ` (${nudge > 0 ? "+" : ""}${nudge}ms onto the beat of that part)` : ""}`);
  } else {
    console.log("audio: silent (drop MP3s into public/social/audio)");
    if (gamesOutro) OUTRO = 5;
    withAudio = false;
  }
  const TOTAL = withAudio || gamesOutro ? Math.round((INTRO + BEAT * beats + OUTRO) * 1000) / 1000 : videoSeconds(beats);
  // Every video is laid out inside TikTok's safe box (Chris 10-01, from his phone: the old layouts sat off centre under the search
  // bar with an empty bottom third). The 1pm file every site posts gets it too: Reels and Shorts cover the same edges.
  // The day's look for this slot (lib/social-looks.mjs, phase 4): classic / ember / arctic, the three handed out per day in a shuffled order.
  const look = lookFor(dayIndex, slot, FORCED_LOOK);
  console.log(`look: ${look}`);
  const html = angle
    ? angleScene({ W, H, logo, intro: built.intro, screens: built.screens, outroGames: built.outro.games, INTRO, BEAT, OUTRO, PERIOD, MUSIC: withAudio, TOTAL, look })
    : sceneHtml({ W, H, logo, intro: built.intro, hook: hookFor(kind, cards), cards, outro: built.outro, INTRO, BEAT, OUTRO, PERIOD, MUSIC: withAudio, TOTAL, safeBottom: true, look });
  const bytes = await renderMp4({ html, W, H, fps: FPS, total: TOTAL, out, audio: withAudio ? { file: track.file, start: AUDIO_START } : null });
  console.log(`wrote ${out} (${(bytes / 1e6).toFixed(1)} MB, ${TOTAL.toFixed(1)}s)`);
  return { kind, bytes, seconds: TOTAL, frozen: built.frozen, audio: track.name, look };
}

/** Park the MP4 on Blob and register it (lib/server/socialTiktok.ts). */
async function register(slot, made, out, drafts) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) throw new Error("--register needs BLOB_READ_WRITE_TOKEN");
  const draft = drafts.find((d) => d.kind === made.kind);
  if (!draft) throw new Error(`no ${made.kind} draft for ${day} to build the caption from`);
  const { put, del } = await import("@vercel/blob");
  // A video of the slot's own kind is the file every site posts in that slot (10-03: all three slots, was 1pm only) and lives under
  // social/video/; a fallback kind is TikTok-only and lives under social/tiktok/.
  const shared = made.kind === slotKind(slot, day);
  // The draft's game keys the shared row (10-03: an angle video may be Magic's; the publisher reads videoKey(d.game, …)).
  const dg = draft.game ?? game;
  // A remake over a row that exists gets its own path: Blob's CDN caches a path for up to a month, so overwriting it can keep serving the old video.
  const prior = shared ? await sharedVideo(slot, day, dg) : (await readSlot(slot, day)).spec;
  const remake = prior?.url ? `-r${Date.now().toString(36)}` : "";
  const blobPath = shared ? `social/video/${dg}-${made.kind}-${day}${remake}.mp4` : `social/tiktok/${slot}-${made.kind}-${day}${remake}.mp4`;
  const blob = await put(blobPath, fs.readFileSync(out), { access: "public", addRandomSuffix: false, contentType: "video/mp4", allowOverwrite: true });
  const r = await registerTiktokVideo({ slot, day, kind: made.kind, url: blob.url, bytes: made.bytes, seconds: made.seconds, draft, cards: made.frozen.cards, leads: made.frozen.leads, winner: made.frozen.winner, audio: made.audio });
  // A re-render on the same day replaces the row; the old file only differs by path when the naming or kind changes.
  for (const u of r.replaced) { try { await del(u); } catch { /* already gone */ } }
  console.log(`registered ${slot} ${made.kind} → ${blob.url}`);
  console.log(`caption (${r.spec.caption.length} chars):\n${r.spec.caption}`);
}

const failed = [];
const outFor = (slot) => {
  if (PACKAGE || has("--out-dir")) return path.resolve(arg("--out-dir", "tiktok-videos"), `${slot}-${day}.mp4`);
  return path.resolve(arg("--out", "social-video.mp4"));
};

const ONE_KIND = arg("--kind", "");
if (ONE_KIND) {
  if (PACKAGE || ONLY.length || REGISTER) { console.error("--kind renders one video to --out by itself: no --package, --slot or --register"); process.exit(2); }
  try {
    await makeSlot("midday", ONE_KIND, outFor("midday"), true);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else if (!PACKAGE && !ONLY.length) {
  // The 1pm movers video, exactly as it has always been made (a thin movers list is an error, not a fallback).
  try {
    const drafts = REGISTER ? await socialDrafts(game, day) : [];
    const made = await makeSlot("midday", KIND, outFor("midday"), false);
    if (REGISTER) await register("midday", made, outFor("midday"), drafts);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  const slots = ONLY.length ? TIKTOK_SLOTS.filter((s) => ONLY.includes(s)) : TIKTOK_SLOTS;
  const drafts = await socialDrafts(game, day);
  console.log(`TikTok videos for ${day}: ${slots.join(", ")}`);
  const madeKinds = [];
  for (const slot of slots) {
    try {
      const st = await readSlot(slot, day);
      if (!FORCE && st.state === "ready") { console.log(`${slot}: already made for the current plan, skipping`); continue; }
      // The 1pm file may already exist (the morning render made it, or an earlier night): reuse it, do not draw it twice.
      if (!FORCE && slot === "midday" && st.state === "missing" && REGISTER) {
        const shared = await sharedMovers(day);
        const draft = drafts.find((d) => d.kind === KIND);
        if (shared && draft && (!shared.plan || shared.plan === planTag("midday", day))) {
          const r = await registerTiktokVideo({ slot, day, kind: KIND, url: shared.url, bytes: shared.bytes, seconds: shared.seconds, width: shared.width, height: shared.height, draft, cards: shared.cards });
          console.log(`midday: the movers video is already registered, added its TikTok row (${r.spec.caption.length} chars)`);
          continue;
        }
      }
      // The slot's own kind, else the publisher's fallbacks (never skip a slot): the next kind is tried when one cannot be drawn.
      // A fallback never repeats another slot's video (09-30 review: 7am with no set draft and 7pm both became the all-games video): the kinds the
      // other slots hold (registered and current) or that this run drew already go last.
      const used = [...madeKinds];
      for (const other of TIKTOK_SLOTS) {
        if (other === slot) continue;
        const o = await readSlot(other, day);
        if (o.state === "ready" && o.spec) used.push(o.spec.kind);
      }
      const kinds = candidateKinds(slot, day, drafts, used);
      if (!kinds.length) throw new Error(`no video kind has a draft for the ${slot} slot on ${day}`);
      const out = outFor(slot);
      let made = null;
      for (const kind of kinds) {
        console.log(`${slot}: ${kind} (${planTag(slot, day)})`);
        try {
          made = await makeSlot(slot, kind, out, true);
          break;
        } catch (err) {
          console.error(`${slot}: ${kind} could not be drawn: ${err instanceof Error ? err.message : err}`);
          if (kind === kinds[kinds.length - 1]) throw err;
        }
      }
      madeKinds.push(made.kind);
      if (REGISTER) await register(slot, made, out, drafts);
    } catch (err) {
      console.error(`${slot}: ${err instanceof Error ? err.message : err}`);
      failed.push(slot);
    }
  }
  if (failed.length) { console.error(`failed: ${failed.join(", ")}`); process.exit(1); }
}
