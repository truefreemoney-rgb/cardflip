/**
 * TikTok by hand (lib/socialTiktok.ts, lib/server/socialTiktok.ts, the night
 * render, /admin/social's hand-over). Run: npm run test:socialtiktok
 *
 * Pins: TikTok is out of the autopilot (not a site, nothing calls TikTok, no
 * failed slot, no alert) while the other six sites post exactly as before in
 * all three slots; the 7am and 7pm TikTok registrations never make another
 * site post video, and tomorrow's movers registration IS what tomorrow's
 * 1:05pm post finds; the night render registers under TOMORROW's Eastern day
 * (across the EDT→EST switch on Nov 1-2, never a UTC date); every row carries
 * its caption with the hashtags; a day-plan change makes a slot stale so the
 * safety net remakes it (also at 12:40pm for a plan pushed after 7am, and a
 * video that exists but was made under the old plan counts as missing); the
 * "ready" mail goes out once, to the owner; the audio rotates by slot and every
 * cut of every video lands on the beat of the committed track (measured
 * against the audio, not the analyzer's own grid), off its breakdown; Mark
 * Posted keeps one mark per slot AND day; the picture follows the video's
 * frozen cards; the cron, workflow, routes and the phone card are pinned.
 *
 * Same throwaway-db trick as test-social-video.mjs.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-social-tiktok-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});
process.env.CRON_SECRET = "cron-test";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const social = await import(at("lib/server/social.ts"));
const { publishSocial, videoFor, applyVideoCards, applyGameLeads, fitText, slotKind, SLOTS, SLOT_PREFIX, LAST_POST_PREFIX } = await import(at("lib/server/socialPublish.ts"));
const { SOCIAL_SITES } = await import(at("lib/server/socialSites.ts"));
const T = await import(at("lib/server/socialTiktok.ts"));
const P = await import(at("lib/socialTiktok.ts"));
const { DAY_PLANS } = await import(at("lib/socialPlan.ts"));
const { videoKey, parseVideoSpec } = await import(at("lib/socialVideo.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
const { addDays } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));
const audio = await import(new URL("./lib/audio-plan.mjs", import.meta.url).href);
const beat = await import(new URL("./lib/beat.mjs", import.meta.url).href);
const scene = await import(new URL("./lib/social-scene.mjs", import.meta.url).href);
const { currentVideoFor, frozenMovers } = await import(at("lib/server/socialPublish.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

// ---- fixture: a Friday (EDT), six cards, five games' stage cards ----------------------------
const FRI = "2026-09-11";
const THU = "2026-09-10";
const day = (back) => addDays(FRI, -back);
async function catalog(id, name, num) {
  await db.prepare("INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES (?, ?, 'sv1', 'Scarlet & Violet', ?, ?, 0)").run(id, name, num, `https://assets.tcgdex.net/en/sv/sv1/${num}/low.webp`);
}
async function series(id, from, to) {
  await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", from, day(7));
  for (const back of [3, 2, 1, 0]) await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", to, day(back));
}
await catalog("sv1-2", "Miraidon ex", "81"); await series("sv1-2", 10, 15);
await catalog("sv1-3", "Koraidon ex", "125"); await series("sv1-3", 40, 20);
await catalog("sv1-4", "Gardevoir ex", "86"); await series("sv1-4", 20, 24);
await catalog("sv1-5", "Arcanine ex", "32"); await series("sv1-5", 30, 30);
await catalog("sv1-6", "Pawmot", "76"); await series("sv1-6", 12, 12);
await catalog("sv1-7", "Pawmi", "74"); await series("sv1-7", 12, 16);
for (const key of ["magic_public", "lorcana_public", "onepiece_public", "yugioh_public"]) await setSetting(key, "1");
const stage = (name, setName, number, price, extra = {}) => ({ name, setName, number, imageUrl: `https://img.example/${encodeURIComponent(name)}.png`, price, ...extra });
const STAGES = {
  "stage:v8:pokemon": [stage("Charizard ex", "Obsidian Flames", "125", 48.5, { lead: true })],
  "stage:v14:mtg": [stage("Sol Ring", "Commander Masters", "410", 32.1, { lead: true })],
  "stage:v14:lorcana": [stage("Elsa", "The First Chapter", "42", 61, { lead: true })],
  "stage:v14:onepiece": [stage("Portgas.D.Ace", "Premium Booster", "P-055", 75, { lead: true })],
  "stage:v14:yugioh": [stage("Dark Magician", "Legend of Blue Eyes (Worldwide English)", "LOB-005", 55.25, { lead: true })],
};
for (const [key, cards] of Object.entries(STAGES)) await db.prepare("INSERT INTO card_cache (key, payload, cached_at) VALUES (?, ?, ?)").run(key, JSON.stringify(cards), Date.now());

const clock = (h, m = 30) => Date.UTC(2026, 8, 11, h, m); // Sep 11 UTC hour h (7am ET = 11)
const fetchImage = async () => Buffer.from("png");
const fetchVideo = async () => Buffer.from("mp4-bytes");
function fakeSite(id, { postsVideo = false } = {}) {
  const posts = [];
  return { id, label: id, maxChars: 5000, maxImageBytes: 1_000_000, postsVideo, posts, connected: () => true, async post(p) { posts.push(p); return { uri: `https://${id}/${posts.length}` }; } };
}
const drafts = await social.socialDrafts("pokemon", FRI);
check("fixture: the Friday has games, movers and set drafts (no drops), plus the angles the data allows (10-03; no slot names them, so the package never draws them yet)", drafts.map((d) => d.kind).sort(), ["games", "guess", "movers", "set", "top", "versus"]);

// What the render job draws and freezes for each kind (scripts/social-video.mjs build()).
async function frozenFor(kind) {
  if (kind === "set") {
    const spot = await social.setSpotlight("pokemon", FRI);
    return { cards: spot.cards.map((c) => ({ cardId: c.cardId, name: c.name, number: c.number, setName: c.setName, variant: c.variant, from: c.from, to: c.to, pct: c.pct, ...(c.unsettled ? { unsettled: true } : {}) })) };
  }
  if (kind === "movers") {
    const list = await social.topMovers("pokemon", FRI, { direction: "up", exclude: await social.recentlyFeatured("pokemon", "movers", FRI) });
    return { cards: list.map((c) => ({ cardId: c.cardId, name: c.name, number: c.number, setName: c.setName, variant: c.variant, from: c.from, to: c.to, pct: c.pct })) };
  }
  const leads = await social.gameLeads(FRI);
  return { leads: leads.map((l) => ({ game: l.game, name: l.name, setName: l.setName, number: l.number, price: l.price })) };
}
async function register(slot, dayKey, { url, kind } = {}) {
  const ds = await social.socialDrafts("pokemon", dayKey);
  const k = kind ?? T.pickVideoKind(slot, dayKey, ds);
  const frozen = await frozenFor(k);
  return T.registerTiktokVideo({ slot, day: dayKey, kind: k, url: url ?? `https://blob/tiktok/${slot}-${k}-${dayKey}.mp4`, bytes: 9_000_000, seconds: 26.2, draft: ds.find((d) => d.kind === k), ...frozen, audio: "track.mp3", now: 1_800_000_000_000 });
}

// ---- 1. TikTok is out of the autopilot -------------------------------------------------------------
console.log("TikTok is out of the autopilot");
check("the publisher's sites are the six, TikTok is not one", SOCIAL_SITES.map((s) => s.id), ["bluesky", "x", "facebook", "instagram", "threads", "pinterest"]);
check("the site list still has nothing video-only or TikTok-shaped", SOCIAL_SITES.some((s) => "videoOnly" in s || /tiktok/i.test(s.id)), false);
check("the publisher source has no video-only branch and no TikTok upload", [/videoOnly/.test(read("src/lib/server/socialPublish.ts")), /video\/init|creator_info/.test(read("src/lib/server/socialPublish.ts") + read("src/lib/server/sites/tiktok.ts"))], [false, false]);
{
  const realFetch = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response("{}", { status: 500 }); };
  Object.assign(process.env, { TIKTOK_CLIENT_KEY: "ck", TIKTOK_CLIENT_SECRET: "cs" });
  const { createHash } = await import("node:crypto");
  await setSetting("social_token:tiktok", JSON.stringify({ access_token: "a", refresh_token: "r", expires_at: Date.now() + 3600_000, refresh_expires_at: Date.now() + 9e9, open_id: "o", scope: "video.list", from: createHash("sha256").update("ck").digest("hex").slice(0, 16) }));
  const a = fakeSite("a_pic"); const b = fakeSite("a_vid", { postsVideo: true });
  for (const [slot, h] of [["morning", 11], ["midday", 17], ["evening", 23]]) {
    var rr = await publishSocial({ day: FRI, now: clock(h), origin: "http://x", slot, force: true, sites: [...SOCIAL_SITES, a, b], fetchImage, fetchVideo });
  }
  check("a connected TikTok token and app keys change nothing: no report row, no TikTok request, no failed slot", [rr.sites.some((s) => /tiktok/i.test(s.site)), seen.filter((u) => /tiktok/i.test(u)).length, await getSetting(`${SLOT_PREFIX}failed:tiktok:morning`), await getSetting(`${SLOT_PREFIX}alerted:tiktok`), await getSetting(`${LAST_POST_PREFIX}tiktok`)], [false, 0, null, null, null]);
  globalThis.fetch = realFetch;
  delete process.env.TIKTOK_CLIENT_KEY; delete process.env.TIKTOK_CLIENT_SECRET;
  var BASE = { pic: a.posts, vid: b.posts };
}
check("baseline (nothing registered): the picture site posts a picture in all three slots, none of them video", BASE.pic.map((p) => p.video ?? null), [null, null, null]);
check("baseline: the video site posts video only when a video is registered (none yet)", BASE.vid.map((p) => p.video ?? null), [null, null, null]);
const baseKinds = BASE.pic.map((p) => p.alt.split(".")[0]);
check("baseline kinds: set spotlight, movers, all games", baseKinds.map((k) => k.split(":")[0]), ["Set spotlight", "Pokémon movers of the week", "One scanner, five card games"]);

// ---- 2. Register the package for the same Friday ------------------------------------------------------
console.log("the package");
const before = { movers: await videoFor({ game: "pokemon", kind: "movers", day: FRI }), set: await videoFor({ game: "pokemon", kind: "set", day: FRI }), games: await videoFor({ game: "pokemon", kind: "games", day: FRI }) };
check("nothing registered yet: all three slots need a render", await T.slotsToRender(FRI), ["morning", "midday", "evening"]);
const morning = await register("morning", FRI);
const evening = await register("evening", FRI);
check("7am is the set spotlight, 7pm the all-games post (kinds follow the slot mapping)", [morning.spec.kind, evening.spec.kind], ["set", "games"]);
// 10-03 (Chris: every autopilot post is a video where the site can take one): 7am and 7pm share their file like 1pm does.
check("7am and 7pm ALSO register the row every site posts in that slot (set and games), the games row carrying its leads", [(await videoFor({ game: "pokemon", kind: "set", day: FRI }))?.url === morning.spec.url, (await videoFor({ game: "pokemon", kind: "games", day: FRI }))?.url === evening.spec.url, morning.shared?.cards?.length, evening.shared?.leads?.length], [true, true, 5, 5]);
check("…under social_tiktok:<slot>:<day>", [await getSetting(P.tiktokKey("morning", FRI)) !== null, await getSetting(P.tiktokKey("evening", FRI)) !== null, await getSetting(P.tiktokKey("midday", FRI))], [true, true, null]);
const midday = await register("midday", FRI);
const shared = await videoFor({ game: "pokemon", kind: "movers", day: FRI });
check("1pm is the movers video, and it is ALSO the row every site posts (the same file)", [midday.spec.kind, shared?.url, shared?.url === midday.spec.url, shared?.cards?.length], ["movers", "https://blob/tiktok/midday-movers-2026-09-11.mp4", true, 3]);
check("the package is complete and current", [await T.slotsToRender(FRI), T.packageReady(await T.loadPackage(FRI))], [[], true]);

console.log("captions are stored with each registration, with tags");
const rows = {};
for (const slot of ["morning", "midday", "evening"]) rows[slot] = P.parseTiktokSpec(await getSetting(P.tiktokKey(slot, FRI)));
check("every row parses with a caption, its plan tag and the day", ["morning", "midday", "evening"].map((s) => [rows[s].caption.length > 40, rows[s].plan, rows[s].day, rows[s].slot === s]), [[true, "set", FRI, true], [true, "movers", FRI, true], [true, "games", FRI, true]]);
check("the set caption names the set's cards and carries the game's hashtags and the address", [rows.morning.caption.includes("Arcanine ex"), rows.morning.caption.includes("#PokemonTCG #PokemonCards #TCG"), rows.morning.caption.includes("cardflip.io")], [true, true, true]);
check("the movers caption carries the frozen numbers and tags", [rows.midday.caption.includes("Miraidon ex"), rows.midday.caption.includes("$15.00"), rows.midday.caption.includes("#PokemonTCG")], [true, true, true]);
check("the all-games caption says video, not picture, on TikTok only (the other sites keep the picture wording)", [rows.evening.caption.includes("In the video, one card from each game"), rows.evening.caption.includes("In the picture"), drafts.find((d) => d.kind === "games").caption.includes("In the picture, one card")], [true, false, true]);
check("the all-games caption names each game's lead card and carries all five game tags", [rows.evening.caption.includes("Charizard ex"), rows.evening.caption.includes("Dark Magician, Legend of Blue Eyes LOB-005: $55.25"), rows.evening.caption.includes("#PokemonTCG #MTG #DisneyLorcana #OPTCG #Yugioh")], [true, true, true]);
const setDraft = drafts.find((d) => d.kind === "set");
check("the stored caption IS the publisher's own text builder at TikTok's limit and seven tags (fitText of the draft with the frozen cards), with the sign-off moved to the top", rows.morning.caption, (() => { const a = applyVideoCards(setDraft, morning.spec.cards); return T.tiktokLead(fitText({ ...a, hashtags: T.tiktokTags(a.hashtags) }, 2200, 7)); })());
// 10-02 (Chris: views but no clicks): TikTok never links a caption URL and shows one line before "more", so the
// sign-off leads, worded "link in bio", and the bottom copy of it is gone; the tags stay last after one blank.
check("every TikTok caption opens with the link-in-bio line and ends with the tags, the old sign-off gone from the bottom", ["morning", "midday", "evening"].map((s) => { const c = rows[s].caption; const lines = c.split("\n"); return [lines[0] === T.TIKTOK_LEAD, lines[1] === "", c.includes("\nScan a card, see what it's worth. cardflip.io"), lines[lines.length - 1].startsWith("#"), lines[lines.length - 2] === "", c.includes("\n\n\n")]; }), [[true, true, false, true, true, false], [true, true, false, true, true, false], [true, true, false, true, true, false]]);
check("tiktokLead is idempotent", T.tiktokLead(T.tiktokLead("Body\n\nScan a card, see what it's worth. cardflip.io\n\n#A #B")), `${T.TIKTOK_LEAD}\n\nBody\n\n#A #B`);
check("a row keeps the frozen cards and leads it drew (text can never drift from the video)", [rows.morning.cards.length, rows.evening.leads.map((l) => l.game)], [5, ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]]);
check("the parser refuses a row with no caption or no plan", [P.parseTiktokSpec(JSON.stringify({ ...rows.morning, caption: "" })), P.parseTiktokSpec(JSON.stringify({ ...rows.morning, plan: undefined })), P.parseTiktokSpec("nope")], [null, null, null]);

console.log("the other six sites are untouched by the package");
const bPic = fakeSite("b_pic"); const bVid = fakeSite("b_vid", { postsVideo: true });
for (const [slot, h] of [["morning", 11], ["midday", 17], ["evening", 23]]) await publishSocial({ day: FRI, now: clock(h), origin: "http://x", slot, force: true, sites: [bPic, bVid], fetchImage, fetchVideo });
check("7am and 7pm: the picture site posts the same pictures as before, the video site gets the registered files", [0, 2].map((i) => [bPic.posts[i].text === BASE.pic[i].text, bPic.posts[i].alt === BASE.pic[i].alt, bPic.posts[i].video ?? null, bVid.posts[i].video?.url]), [[true, true, null, morning.spec.url], [true, true, null, evening.spec.url]]);
check("7pm with the video attached says 'In the video', the picture site keeps 'In the picture'", [bVid.posts[2].text.includes("In the video, one card"), bVid.posts[2].text.includes("In the picture"), bPic.posts[2].text.includes("In the picture, one card")], [true, false, true]);
check("1pm: tomorrow's registered movers video is what the 1:05pm post finds (the video site gets that file)", [bVid.posts[1].video?.url, bVid.posts[1].video?.seconds, bPic.posts[1].video ?? null], ["https://blob/tiktok/midday-movers-2026-09-11.mp4", 26.2, null]);
check("1pm text is the same movers post (the frozen cards are the ones the draft had)", bVid.posts[1].text === BASE.vid[1].text, true);
check("no site row existed for any kind before the package", [before.movers, before.set, before.games], [null, null, null]);

// ---- 3. The night render's day ----------------------------------------------------------------------------
console.log("the night render registers under TOMORROW's Eastern day");
const etTarget = (y, m, d, h, min = 0) => T.tiktokTargetDay(Date.UTC(y, m - 1, d, h, min));
check("8pm EDT Sep 30 (already Oct 1 in UTC) → Oct 1, never UTC's Oct 2", etTarget(2026, 10, 1, 0, 0), "2026-10-01");
check("8:30pm EDT (00:30 UTC) is still tomorrow's Eastern date", etTarget(2026, 10, 1, 0, 30), "2026-10-01");
check("8pm EDT Oct 31 (00:00 UTC Nov 1) → Nov 1", etTarget(2026, 11, 1, 0, 0), "2026-11-01");
check("8pm EST Nov 1 (01:00 UTC Nov 2, after the switch) → Nov 2", etTarget(2026, 11, 2, 1, 0), "2026-11-02");
check("7pm EST Nov 1 (00:00 UTC Nov 2, the early EST-side ping) → Nov 2", etTarget(2026, 11, 2, 0, 0), "2026-11-02");
check("the 9pm EDT re-check on Oct 31 (01:00 UTC Nov 1) → Nov 1", etTarget(2026, 11, 1, 1, 0), "2026-11-01");
check("a ping GitHub ran past midnight (1:30am EDT Nov 1, and the repeated 1:30am EST) still means the day that is now today", [etTarget(2026, 11, 1, 5, 30), etTarget(2026, 11, 1, 6, 30)], ["2026-11-01", "2026-11-01"]);
check("tomorrow's date by calendar arithmetic across the switch", [T.tomorrowEastern(Date.UTC(2026, 10, 1, 0, 0)), T.tomorrowEastern(Date.UTC(2026, 10, 2, 1, 0))], ["2026-11-01", "2026-11-02"]);
{
  // The job as scripts/social-video.mjs runs it: the day is the target day, the rows are keyed by it.
  const NOV1 = etTarget(2026, 11, 1, 0, 0), NOV2 = etTarget(2026, 11, 2, 1, 0);
  const seenDays = [];
  for (const d of [NOV1, NOV2]) {
    const r = await T.registerTiktokVideo({ slot: "evening", day: d, kind: "set", url: `https://blob/e-${d}.mp4`, bytes: 1, seconds: 26, draft: { ...setDraft, day: d }, cards: (await frozenFor("set")).cards });
    seenDays.push(r.spec.day, (await db.prepare("SELECT key FROM settings WHERE key = ?").get(P.tiktokKey("evening", d)))?.key);
  }
  check("registered under Nov 1 and Nov 2 keys, each carrying its own day", seenDays, ["2026-11-01", "social_tiktok:evening:2026-11-01", "2026-11-02", "social_tiktok:evening:2026-11-02"]);
  const script = read("scripts/social-video.mjs");
  check("the render script takes its package day from tiktokTargetDay, not a UTC date", [script.includes("PACKAGE ? tiktokTargetDay(now)"), /toISOString|todayUtc/.test(script)], [true, false]);
}

// ---- 4. A changed plan makes a slot stale --------------------------------------------------------------------
console.log("a day-plan change triggers a re-render");
check("the plan tag is the kind plus the flags that change the video or caption", [T.planTag("morning", FRI), T.planTag("midday", FRI), T.planTag("evening", FRI)], ["set", "movers", "games"]);
DAY_PLANS[FRI] = { evening: "movers" };
check("evening now maps to movers: the stored games video is stale, morning and 1pm are not", [slotKind("evening", FRI), (await T.readSlot("evening", FRI)).state, (await T.readSlot("morning", FRI)).state, (await T.readSlot("midday", FRI)).state, await T.slotsToRender(FRI)], ["movers", "stale", "ready", "ready", ["evening"]]);
check("the hand-over hides a stale video and says it is being remade", ((await T.loadPackage(FRI, Date.UTC(2026, 8, 10, 22, 0))).rows[2]), { slot: "evening", time: "7:05pm ET", state: "stale", posted: false, title: null, caption: null, url: null, seconds: 0, bytes: 0, note: "Made for an older plan. Ready by about 9:30pm ET tonight." });
DAY_PLANS[FRI] = { mixedMovers: true, alsoScans: true };
check("a flag change (mixed movers, also-scans) is a plan change too", [T.planTag("midday", FRI), await T.slotsToRender(FRI)], ["movers+mixed+also", ["morning", "midday"]]);
delete DAY_PLANS[FRI];
check("back to the standing plan: current again", await T.slotsToRender(FRI), []);
await setSetting(videoKey("pokemon", "movers", FRI), JSON.stringify({ ...shared, url: "https://blob/other.mp4" }));
check("a 1pm row whose file is no longer the one the sites post is stale", [(await T.readSlot("midday", FRI)).state, await T.slotsToRender(FRI)], ["stale", ["midday"]]);
await setSetting(videoKey("pokemon", "movers", FRI), JSON.stringify(shared));
check("…and current again once they agree", await T.slotsToRender(FRI), []);
check("the slot's fallback follows the publisher: no games draft → the evening video is the set (never skipped)", [T.pickVideoKind("evening", FRI, drafts), T.pickVideoKind("evening", FRI, drafts.filter((d) => d.kind !== "games")), T.pickVideoKind("morning", FRI, [])], ["games", "set", null]);

check("…and the render tries the next kind when one cannot be drawn (a card with no art): games, then set, then movers", [T.candidateKinds("evening", FRI, drafts), T.candidateKinds("morning", FRI, drafts), T.candidateKinds("midday", FRI, drafts.filter((d) => d.kind !== "movers"))], [["games", "set", "movers"], ["set", "games", "movers"], ["games", "set"]]);
check("a fallback never repeats another slot's video: the kinds the others hold go last (7am with no set draft, 7pm holding the all-games video)", [T.candidateKinds("morning", FRI, drafts, ["games"]), T.candidateKinds("morning", FRI, drafts, ["set", "games"]), T.candidateKinds("evening", FRI, drafts, ["games"]), T.pickVideoKind("morning", FRI, drafts.filter((d) => d.kind !== "set"), ["games"])], [["set", "movers", "games"], ["movers", "set", "games"], ["set", "movers", "games"], "movers"]);
check("…but the 1pm video keeps its own kind first (it is the file every site posts)", [T.candidateKinds("midday", FRI, drafts, ["movers", "games"])], [["movers", "set", "games"]]);

console.log("the safety net");
const dispatched = []; const alerts = []; const notified = [];
const deps = { dispatch: async (d) => void dispatched.push(d), alert: async (d, e) => (alerts.push([d, e]), true), notify: async (d) => (notified.push(d), "sent") };
const at915pm = Date.UTC(2026, 8, 11, 1, 15); // 9:15pm EDT Sep 10, for Sep 11
let net = await T.packageSafetyNet({ now: at915pm }, deps);
check("9:15pm ET, tomorrow's package complete: nothing dispatched, the ready mail asked for once", [net.day, net.action, dispatched.length, notified], ["2026-09-11", "ready", 0, ["2026-09-11"]]);
await setSetting(P.tiktokKey("evening", FRI), "");
net = await T.packageSafetyNet({ now: at915pm }, deps);
check("a missing slot → a render-only run for tomorrow, naming the day", [net.action, net.need, dispatched], ["dispatched", ["evening"], ["2026-09-11"]]);
net = await T.packageSafetyNet({ now: at915pm + 20 * 60_000 }, deps);
check("20 minutes later it waits for that render instead of dispatching again", [net.action, dispatched.length, alerts.length], ["waiting", 1, 0]);
net = await T.packageSafetyNet({ now: at915pm + 50 * 60_000 }, deps);
check("50 minutes later it is still missing: the failure alert goes out and it tries again", [net.action, dispatched.length, alerts.length, alerts[0][0], net.alerted], ["dispatched", 2, 1, "2026-09-11", true]);
await register("evening", FRI);
net = await T.packageSafetyNet({ now: at915pm + 70 * 60_000 }, deps);
check("done: it forgets the dispatch, so a later plan change starts clean", [net.action, await getSetting(`${P.TIKTOK_DISPATCH_PREFIX}${FRI}`)], ["ready", ""]);
DAY_PLANS[FRI] = { evening: "movers" };
dispatched.length = 0; alerts.length = 0;
net = await T.packageSafetyNet({ now: at915pm + 80 * 60_000 }, deps);
check("a plan pushed after the render → the stale slot is remade by the next run (no false failure alert)", [net.action, net.need, dispatched, alerts.length], ["dispatched", ["evening"], ["2026-09-11"], 0]);
delete DAY_PLANS[FRI];
await setSetting(`${P.TIKTOK_DISPATCH_PREFIX}${FRI}`, "");
net = await T.packageSafetyNet({ now: Date.UTC(2026, 8, 11, 19, 0) }, deps);
check("mid-afternoon, outside both windows: it does nothing", [net.action, net.day], ["outside-window", null]);
DAY_PLANS[FRI] = { morning: "movers" };
net = await T.packageSafetyNet({ now: Date.UTC(2026, 8, 11, 9, 45) }, deps);
check("5:45am ET checks TODAY's package for a plan pushed overnight, before the 7am post", [net.day, net.action, net.need], ["2026-09-11", "dispatched", ["morning"]]);
delete DAY_PLANS[FRI];
{
  // A plan pushed at 9am: the movers video and the 7pm row were made last night and both EXIST. Existing is not the same as right.
  const dispatchKey = `${P.TIKTOK_DISPATCH_PREFIX}${FRI}`;
  const at1240 = Date.UTC(2026, 8, 11, 16, 40); // 12:40pm EDT Sep 11
  const seen = []; const noisy = [];
  const dd = { dispatch: async (d, slots) => void seen.push([d, slots]), notify: async () => "sent", alert: async (d, e) => (noisy.push([d, e]), true) };
  await setSetting(dispatchKey, "");
  check("12:40pm with nothing changed: the shared 1pm video is current and the same-day check has nothing to do", [(await T.middayVideo(FRI)).state, (await T.packageSafetyNet({ now: at1240, sameDay: true }, dd)).action, seen.length], ["ready", "ready", 0]);
  DAY_PLANS[FRI] = { alsoScans: true };
  check("a plan pushed after the render: the registered 1pm movers video exists but is the old plan's, so it is stale, not registered", [(await T.middayVideo(FRI)).state, (await T.readSlot("midday", FRI)).state, (await T.readSlot("morning", FRI)).state], ["stale", "stale", "stale"]);
  net = await T.packageSafetyNet({ now: at1240, sameDay: true }, dd);
  check("12:40pm: the same-day check dispatches for the videos still to post (1pm, not the 7am one whose time has passed), naming the slots", [net.action, net.need, seen], ["dispatched", ["midday"], [[FRI, ["midday"]]]]);
  await setSetting(dispatchKey, ""); seen.length = 0;
  net = await T.packageSafetyNet({ now: at1240, sameDay: true, skip: ["midday"] }, dd);
  check("…and leaves the 1pm video alone when the caller (the 12:40 route) is already remaking it", [net.action, net.need, seen.length], ["ready", [], 0]);
  DAY_PLANS[FRI] = { evening: "movers" };
  check("a plan that moves the 7pm post stales the 7pm row only", [(await T.readSlot("evening", FRI)).state, (await T.readSlot("midday", FRI)).state], ["stale", "ready"]);
  await setSetting(dispatchKey, ""); seen.length = 0;
  net = await T.packageSafetyNet({ now: at1240, sameDay: true }, dd);
  check("12:40pm: a stale 7pm video is remade the same day (the 9:15pm check looks at tomorrow, so it was lost for good)", [net.action, net.need, seen], ["dispatched", ["evening"], [[FRI, ["evening"]]]]);
  await setSetting(dispatchKey, ""); seen.length = 0;
  net = await T.packageSafetyNet({ now: Date.UTC(2026, 8, 11, 23, 30), sameDay: true }, dd);
  check("7:30pm: the 7pm post is out, nothing is worth a render any more", [net.action, net.need, seen.length], ["ready", [], 0]);
  // A dispatch from last night is history, not "a render that failed to fix this".
  await setSetting(dispatchKey, JSON.stringify({ at: at1240 - 7 * 3600_000, n: 1 }));
  net = await T.packageSafetyNet({ now: at1240, sameDay: true }, dd);
  check("a dispatch from 7 hours ago (last night's render, done since) is forgotten: dispatched again, no false 'still missing' alert", [net.action, net.alerted, noisy.length, JSON.parse(await getSetting(dispatchKey)).n], ["dispatched", false, 0, 1]);
  await setSetting(dispatchKey, JSON.stringify({ at: at1240 - 2 * 3600_000, n: 1 }));
  net = await T.packageSafetyNet({ now: at1240, sameDay: true }, dd);
  check("…but one from 2 hours ago that left the slot missing IS a failing render: alert, and try again", [net.action, net.alerted, noisy.length, JSON.parse(await getSetting(dispatchKey)).n], ["dispatched", true, 1, 2]);
  delete DAY_PLANS[FRI];
  await setSetting(dispatchKey, "");
  check("back to the standing plan: everything current again", [await T.slotsToRender(FRI), (await T.middayVideo(FRI)).state], [[], "ready"]);
}
{
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization }), new Response(null, { status: 204 }));
  process.env.GITHUB_TOKEN = "gh-test";
  await T.dispatchTiktokRender("2026-09-11");
  check("the dispatch is the social-post workflow with tiktok=1 and the day", [sent[0].url.endsWith("/actions/workflows/social-post.yml/dispatches"), sent[0].body, sent[0].auth], [true, { ref: "main", inputs: { tiktok: "1", tiktok_day: "2026-09-11" } }, "Bearer gh-test"]);
  await T.dispatchTiktokRender("2026-09-11", ["evening", "morning"]);
  check("…and can be limited to the slots the net found missing (a run must not remake the 1pm video another run is making)", sent[1].body.inputs, { tiktok: "1", tiktok_day: "2026-09-11", tiktok_slots: "evening,morning" });
  delete process.env.GITHUB_TOKEN;
  check("no GitHub token → it says so instead of pretending", await T.dispatchTiktokRender("2026-09-11").then(() => "ok", (e) => e.message), "GITHUB_TOKEN not configured");
  globalThis.fetch = realFetch;
}
dispatched.length = 0; alerts.length = 0;
await setSetting(`${P.TIKTOK_DISPATCH_PREFIX}${FRI}`, "");
await setSetting(P.tiktokKey("midday", FRI), "");
net = await T.packageSafetyNet({ now: at915pm + 95 * 60_000, day: FRI }, { ...deps, dispatch: async () => { throw new Error("GitHub 401"); } });
check("…a dispatch that fails raises the failure alert once", [net.action, net.error, alerts.length, alerts[0]?.[1]], ["dispatch-failed", "GitHub 401", 1, "Could not start the render: GitHub 401"]);
await register("midday", FRI);

// ---- 5. The mail ------------------------------------------------------------------------------------------------------
console.log("the package mail fires once");
const mails = [];
const store = new Map();
const mnow = Date.UTC(2026, 8, 11, 1, 30); // 9:30pm EDT Sep 10: the packages below are all "tomorrow's"
const mdeps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), send: async (m) => void mails.push(m), now: mnow };
const pkg = await T.loadPackage(FRI);
check("ready: one mail with the three post times and captions", [await T.notifyPackageReady(FRI, { ...mdeps, pkg }), mails.length, mails[0].rows.map((r) => r.time), mails[0].rows.every((r) => r.caption.includes("cardflip.io")), mails[0].label], ["sent", 1, ["7:05am ET", "1:05pm ET", "7:05pm ET"], true, "Fri, Sep 11"]);
check("the same day again (the render job's ping, then the 9:15pm net): no second mail", [await T.notifyPackageReady(FRI, { ...mdeps, pkg }), await T.notifyPackageReady(FRI, { ...mdeps, pkg }), mails.length], ["already", "already", 1]);
check("the next package day mails again", [await T.notifyPackageReady("2026-09-12", { ...mdeps, pkg: { ...pkg, day: "2026-09-12" } }), mails.length], ["sent", 2]);
check("an incomplete package sends nothing", [await T.notifyPackageReady("2026-09-13", { ...mdeps, pkg: { ...pkg, rows: [...pkg.rows.slice(0, 2), { ...pkg.rows[2], state: "missing" }] } }), mails.length], ["not-ready", 2]);
check("a send that fails gives the day back, so the next ping tries again", [await T.notifyPackageReady("2026-09-14", { ...mdeps, pkg, send: async () => { throw new Error("smtp down"); } }).catch((e) => e.message), store.get(`${P.TIKTOK_MAILED_PREFIX}2026-09-14`)], ["smtp down", ""]);
check("no mail server here → it says so and does not claim the day", [await T.notifyPackageReady(FRI, { pkg, now: mnow }), await getSetting(`${P.TIKTOK_MAILED_PREFIX}${FRI}`)], ["no-mail", null]);
check("a package for today (a same-day remake finishing) is not mailed as 'Tomorrow's'", [await T.notifyPackageReady(FRI, { ...mdeps, pkg, now: Date.UTC(2026, 8, 11, 17, 0) }), mails.length], ["not-tomorrow", 2]);
{
  const dispatchKey = `${P.TIKTOK_DISPATCH_PREFIX}2026-09-15`;
  store.set(dispatchKey, JSON.stringify({ at: 1, n: 1 }));
  await T.notifyPackageReady("2026-09-15", { ...mdeps, pkg: { ...pkg, day: "2026-09-15" } });
  check("the render's own 'ready' ping forgets its dispatch, so a plan pushed at 11pm is not met with a false 'still missing' alert", store.get(dispatchKey), "");
}
{
  const mail = read("src/lib/server/mail.ts");
  const fn = mail.slice(mail.indexOf("export async function sendTiktokReadyEmail"));
  check("the ready mail is the owner helper: exact subject, to the given address only, links to /admin/social", [fn.includes(`subject: "Tomorrow's TikTok Videos Are Ready"`), /sendMail\(\{ from: fromAddress\(\), to,/.test(fn), fn.includes("/admin/social")], [true, true, true]);
  const tt = read("src/lib/server/socialTiktok.ts");
  check("…and it only ever goes to OWNER_EMAIL", [tt.includes("sendTiktokReadyEmail(OWNER_EMAIL"), tt.includes("sendSocialFailureEmail(OWNER_EMAIL")], [true, true]);
}
{
  const alertStore = new Map(); const failMails = [];
  const adeps = { get: async (k) => alertStore.get(k) ?? null, set: async (k, v) => void alertStore.set(k, v), send: async (f) => void failMails.push(f) };
  check("a failed night render uses the failure alert path, once per day", [await T.alertPackageFailure(FRI, "boom", adeps), await T.alertPackageFailure(FRI, "boom again", adeps), await T.alertPackageFailure("2026-09-12", "boom", adeps), failMails.length, failMails[0][0].label, failMails[0][0].error], [true, false, true, 2, "TikTok Videos", "2026-09-11: boom"]);
}

// ---- 6. The hand-over card's data ---------------------------------------------------------------------------------------
console.log("the hand-over card");
const tomorrowPkg = await T.loadPackage(FRI, Date.UTC(2026, 8, 11, 0, 30));
check("tomorrow's rows: the three post times, ready, with the file and the caption to copy", tomorrowPkg.rows.map((r) => [r.time, r.state, r.url?.startsWith("https://"), r.caption?.length > 40, r.posted]), [["7:05am ET", "ready", true, true, false], ["1:05pm ET", "ready", true, true, false], ["7:05pm ET", "ready", true, true, false]]);
const emptyPkg = await T.loadPackage("2026-09-20", Date.UTC(2026, 8, 19, 22, 0));
check("a slot not rendered yet says when it will be ready", [emptyPkg.rows.every((r) => r.state === "missing"), emptyPkg.rows[0].note], [true, "Ready by about 9:30pm ET tonight."]);
check("today's missing slots say what happens (the 7pm one is remade by the 12:40pm check)", [(await T.loadPackage("2026-09-20", Date.UTC(2026, 8, 20, 14, 0))).rows.map((r) => r.note), (await T.loadPackage("2026-09-20", Date.UTC(2026, 8, 20, 16, 0))).rows[1].note, (await T.loadPackage("2026-09-20", Date.UTC(2026, 8, 20, 22, 0))).rows.map((r) => r.note)], [["Not made.", "Renders around 10:30am ET.", "The midday check remakes it around 12:40pm ET."], "Rendering now. Check back in a few minutes.", ["Not made.", "Not made.", "Not made."]]);
await T.markTiktokPosted("morning", FRI, true);
check("Mark Posted records social_slot:tiktok:<slot>:<day> = 1: a key per slot AND day", [await getSetting("social_slot:tiktok:morning:2026-09-11"), P.tiktokPostedKey("morning", FRI) === `${SLOT_PREFIX}tiktok:morning:${FRI}`, (await T.loadPackage(FRI)).rows.map((r) => r.posted)], ["1", true, [true, false, false]]);
check("…it only shows for its own day", (await T.loadPackage(THU)).rows.map((r) => r.posted), [false, false, false]);
await T.markTiktokPosted("morning", THU, true);
await T.markTiktokPosted("midday", THU, true);
check("marking one day's slots does not un-post another's (09-30: marking tomorrow's 7:05am flipped today's back to Share Video)", [(await T.loadPackage(FRI)).rows[0].posted, (await T.loadPackage(THU)).rows.map((r) => r.posted)], [true, [true, true, false]]);
await T.markTiktokPosted("morning", FRI, false);
check("Undo clears only that day's mark", [(await T.loadPackage(FRI)).rows[0].posted, (await T.loadPackage(THU)).rows[0].posted], [false, true]);
check("marking posted is not a failure and is not a post: no failed/alerted rows, no last-post line", [await getSetting(`${SLOT_PREFIX}failed:tiktok:morning`), await getSetting(`${LAST_POST_PREFIX}tiktok`)], [null, null]);
check("the analytics Social panel counts his marks: newest marked day and how many that day; old per-slot rows and cleared marks are skipped (10-01: TikTok sat on 09-29)", [
  P.tiktokHandPosted([
    { key: "social_slot:tiktok:midday", value: "2026-09-29" },
    { key: "social_slot:tiktok:morning:2026-09-30", value: "1" },
    { key: "social_slot:tiktok:morning:2026-10-01", value: "1" },
    { key: "social_slot:tiktok:midday:2026-10-01", value: "1" },
    { key: "social_slot:tiktok:evening:2026-10-01", value: "" },
    { key: "social_slot:tiktok:evening:2026-10-02", value: "" },
  ]),
  P.tiktokHandPosted([{ key: "social_slot:tiktok:midday", value: "2026-09-29" }]),
], [{ lastDay: "2026-10-01", postsThatDay: 2 }, null]);

// ---- 7. Audio, crons, workflow, routes ---------------------------------------------------------------------------------
console.log("audio rotation");
{
  const di = 20_000;
  // Chris 09-30: "randomize the audio to audio we used in previous posts" — a seeded shuffle per day, no repeat inside a day.
  const slots = ["midday", "morning", "evening"];
  const days = Array.from({ length: 90 }, (_, k) => di + k);
  check("three tracks: every day's three videos get three different ones", days.every((d) => new Set(slots.map((s) => audio.trackIndex(s, d, 3))).size === 3), true);
  check("three tracks: the same day always picks the same (a re-render sounds the same)", slots.map((s) => audio.trackIndex(s, di, 3)), slots.map((s) => audio.trackIndex(s, di, 3)));
  check("three tracks: random, not a rotation — over 90 days every track lands in every slot and the day orders vary", [slots.every((s) => new Set(days.map((d) => audio.trackIndex(s, d, 3))).size === 3), new Set(days.map((d) => slots.map((s) => audio.trackIndex(s, d, 3)).join(""))).size >= 5], [true, true]);
  check("three tracks: nobody starts deeper in", slots.map((s) => audio.sectionFor(s, di, 3)), [0, 0, 0]);
  check("one track: the opening, then 8 bars in, then 16", [slots.map((s) => audio.trackIndex(s, di, 1)), slots.map((s) => audio.sectionFor(s, di, 1))], [[0, 0, 0], [0, 1, 2]]);
  check("two tracks: 7am gets the other track, 7pm shares 1pm's and starts deeper", days.every((d) => audio.trackIndex("morning", d, 2) !== audio.trackIndex("midday", d, 2) && audio.trackIndex("evening", d, 2) === audio.trackIndex("midday", d, 2)) && slots.map((s) => audio.sectionFor(s, di, 2)).join() === "0,0,1", true);
  const track = { start: 10.08, duration: 73.35 }, bar = 2.1333;
  check("a later section starts a whole number of bars in (8 per step) and fits the track", [audio.audioStart(track, bar, 0, 26.2), +audio.audioStart(track, bar, 1, 26.2).toFixed(3), +audio.audioStart(track, bar, 2, 26.2).toFixed(3)], [10.08, +(10.08 + 8 * bar).toFixed(3), +(10.08 + 16 * bar).toFixed(3)]);
  check("a video too long to fit that deep starts at the deepest bar that does, then at the opening", [+audio.audioStart(track, bar, 2, 40).toFixed(3), audio.audioStart(track, bar, 2, 70)], [+(10.08 + 10 * bar).toFixed(3), 10.08]);
  // A breakdown (no kick for 3s) in the middle of a track: nothing may play over it, and the videos of a day must not start on the same bar.
  const gapped = { period: 60 / 113, start: 10, duration: 73.35, gaps: [{ from: 34.6, to: 37.7 }] };
  const plans = [0, 1, 2].map((section) => audio.timelineFor(gapped, { section, cards: 5 }));
  const starts = plans.map((p) => p.rawStart);
  check("a section whose intro or cards would play over the breakdown moves to the nearest bar that clears it (the outro may)", [plans.map((p) => audio.bodyHitsGap(p.rawStart, gapped.gaps, { intro: p.INTRO, beat: p.BEAT, cards: 5 })), audio.bodyHitsGap(10 + 8 * 4 * gapped.period * 1, gapped.gaps, { intro: 2.124, beat: 4.248, cards: 5 }), audio.bodyHitsGap(9, [{ from: 34.6, to: 37.7 }], { intro: 2.124, beat: 4.248, cards: 5 })], [[false, false, false], true, false]);
  check("…and the three videos start on three different bars", [Math.abs(starts[0] - starts[1]) >= plans[0].oneBar, Math.abs(starts[0] - starts[2]) >= plans[0].oneBar, Math.abs(starts[1] - starts[2]) >= plans[0].oneBar], [true, true, true]);
  check("a start is moved onto the beat of the part it plays, by no more than 150ms, and not at all where the beat is unclear", [audio.nudgeStart(10, { offset: 0.06, strength: 0.1 }), audio.nudgeStart(10, { offset: 0.4, strength: 0.1 }), audio.nudgeStart(10, { offset: -0.4, strength: 0.1 }), audio.nudgeStart(10, { offset: 0.06, strength: 0.01 }), audio.nudgeStart(10, undefined)], [10.06, 10.15, 9.85, 10, 10]);
}
console.log("the beat, measured against the committed track");
{
  const file = fileURLToPath(new URL("../public/social/audio/cinematic-soul-upbeat-success-happy-corporate-music-511436.mp3", import.meta.url));
  const b = await beat.analyzeBeat(file, { clipSeconds: 18 });
  // Independent of beat.mjs: another sample rate and hop, onsets from the full band and the kick band added.
  const ffmpeg = (await import("ffmpeg-static")).default;
  const SR = 11025, HOP = 64, hop = HOP / SR;
  const decode = (filter) => {
    const args = ["-v", "error", "-i", file, "-ac", "1", "-ar", String(SR), ...(filter ? ["-af", filter] : []), "-f", "s16le", "-"];
    const r = spawnSync(ffmpeg, args, { maxBuffer: 1 << 29 });
    return new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length >> 1);
  };
  const onsets = (pcm) => {
    const n = Math.floor(pcm.length / HOP), e = new Float64Array(n), o = new Float64Array(n), sum = new Float64Array(n + 1), out = new Float64Array(n);
    for (let i = 0; i < n; i++) { let s = 0; for (let j = i * HOP; j < (i + 1) * HOP; j++) s += pcm[j] * pcm[j]; e[i] = Math.sqrt(s / HOP); }
    for (let i = 1; i < n; i++) o[i] = Math.max(0, e[i] - e[i - 1]);
    for (let i = 0; i < n; i++) sum[i + 1] = sum[i] + o[i];
    const w = Math.round(2 / hop);
    for (let i = 0; i < n; i++) { const a = Math.max(0, i - w), z = Math.min(n, i + w); out[i] = o[i] / ((sum[z] - sum[a]) / (z - a) + 1e-9); }
    return out;
  };
  const full = onsets(decode(null)), kick = onsets(decode("highpass=f=40,lowpass=f=160"));
  const both = full.map((v, i) => v + kick[i]);
  /**
   * How many ms after the beat the music has around it a cut at `t` falls (- = before): the phase of the onsets
   * in the 12s around t (cut short at a breakdown) against `period`. null when there is no 10s of steady groove
   * to judge by (the 1pm outro cut sits 1.6s before the breakdown, in a drum fill).
   */
  function cutErrorMs(t, period) {
    const lo = Math.max(t - 6, ...b.gaps.filter((g) => g.to <= t).map((g) => g.to));
    const hi = Math.min(t + 6, b.duration, ...b.gaps.filter((g) => g.from >= t).map((g) => g.from));
    if (hi - lo < 10) return null;
    let re = 0, im = 0;
    for (let i = Math.round(lo / hop); i < Math.round(hi / hop); i++) { const a = (2 * Math.PI * i * hop) / period; re += both[i] * Math.cos(a); im += both[i] * Math.sin(a); }
    const phase = (Math.atan2(im, re) / (2 * Math.PI)) * period;
    const d = t - phase;
    return (d - Math.round(d / period) * period) * 1000;
  }
  const cutTimes = (start, intro, beatLen, cards) => Array.from({ length: cards + 1 }, (_, k) => start + intro + k * beatLen);
  const worstOf = (start, intro, beatLen, period) => {
    const errs = cutTimes(start, intro, beatLen, 5).map((t) => cutErrorMs(t, period)).filter((e) => e !== null);
    return { n: errs.length, worst: Math.max(...errs.map(Math.abs)), first: errs[0], last: errs[errs.length - 1] };
  };

  check("tempo: the track is 113 bpm (the coarse pass alone says 112.5: 2.4ms wrong every beat, 76ms late 8 bars in and 100ms+ by the end of a video)", [Math.abs(b.bpm - 113) <= 0.15, Math.abs(b.period - 60 / 113) < 0.0008], [true, true]);
  check("it finds the breakdown (about 34.6-37.7s: no kick, the full band a third of itself)", b.gaps.some((g) => g.from > 33 && g.from < 36 && g.to > 37 && g.to < 39), true);
  const tl = [0, 1, 2].map((section) => audio.timelineFor(b, { section, cards: 5 }));
  check("the 1pm video opens the track; 7am and 7pm start on other bars", [tl[0].rawStart === b.start, tl[1].rawStart > b.start, tl[2].rawStart > b.start], [true, true, true]);
  check("the three videos start on three different bars", [Math.abs(tl[0].start - tl[1].start) >= tl[0].oneBar, Math.abs(tl[0].start - tl[2].start) >= tl[0].oneBar, Math.abs(tl[1].start - tl[2].start) >= tl[0].oneBar], [true, true, true]);
  check("no video's intro or card plays over the breakdown (the 7am video had card No. 4 on it: the price popped with no kick under it)", tl.map((p) => audio.bodyHitsGap(p.start, b.gaps, { intro: p.INTRO, beat: p.BEAT, cards: 5 })), [false, false, false]);
  check("every video fits inside the track with its fade", tl.every((p) => p.start + p.total + 0.7 <= b.duration), true);
  const results = tl.map((p) => worstOf(p.start, p.INTRO, p.BEAT, b.period));
  console.log("    (ms off the beat, per video: " + results.map((r, i) => `${["1pm", "7am", "7pm"][i]} first ${r.first?.toFixed(0)} last ${r.last?.toFixed(0)} worst ${r.worst.toFixed(0)}`).join(" | ") + ")");
  check("every cut with a steady groove around it lands within 40ms of the beat (first and last included), for all three videos", results.map((r) => r.worst <= 40 && Math.abs(r.first) <= 40 && Math.abs(r.last) <= 40 && r.n >= 5), [true, true, true]);
  // The control: the same measure applied to the plan this replaced (a 112.5 grid, the opening, 8 and 16 bars in).
  const oldBar = 4 * (60 / 112.5);
  const old = [0, 1, 2].map((k) => worstOf(10.0778 + k * 8 * oldBar, oldBar, 2 * oldBar, b.period));
  console.log("    (the old plan: " + old.map((r, i) => `${["1pm", "7am", "7pm"][i]} n=${r.n} worst ${r.worst.toFixed(0)}`).join(" | ") + ")");
  check("…and the measure is not blind: it finds a cut of the plan this replaced (a 112.5 grid) more than 60ms off", Math.max(...old.map((r) => r.worst)) > 60, true);
}

console.log("the phone card, the layout, the frozen picture");
{
  const html = (safeBottom) => scene.sceneHtml({ W: 1080, H: 1920, logo: "data:,", intro: { kicker: "k", title: "t", sub: "s" }, cards: [{ rank: "No. 1", art: "", name: "Name", meta: "#1", to: 1, pct: { text: "x", cls: "up" } }], outro: {}, INTRO: 2, BEAT: 4, OUTRO: 2, PERIOD: 0.5, MUSIC: true, TOTAL: 8, safeBottom });
  check("safeBottom puts every screen in TikTok's safe box (a class on the page); the default layout is untouched", [html(true).includes('<body class="safe">'), html(false).includes("<body>"), html(false).includes('class="safe"')], [true, true, false]);
  // Chris 10-01, from his phone: the stack sat under the search bar with an empty bottom third, the cold-open number lay across the card, the progress bar struck through the caption.
  const css = html(true);
  check("the safe box: cards, intro and outro centred between the top bar and the caption; the footer and progress bar are not drawn", [
    css.includes(".safe .beat { justify-content:center; padding:230px 80px 360px; }"),
    css.includes(".safe #intro, .safe #outro { padding:230px 90px 360px; }"),
    css.includes(".safe #intro.hooked { justify-content:center; padding:230px 90px 360px; }"),
    css.includes(".safe #footer, .safe #bar { display:none; }"),
  ], [true, true, true, true]);
  check("the cold-open number sits under the card, never across it (no negative margin)", [/#intro \.hook \.hbig \{[^}]*margin-top:\d+px/.test(css), /#intro \.hook \.hbig \{[^}]*margin-top:-/.test(css)], [true, false]);
  const script = read("scripts/social-video.mjs");
  check("the render uses the safe box for every video, the 1pm file included", [script.includes("safeBottom: true"), script.includes('slot !== "midday"')], [true, false]);
  check("the all-games video is not made short of a game (it throws, so the run retries), and the art is retried with a pause", [script.includes("shown.length !== leads.length"), /for \(let i = 1; strict && !art && i <= 4; i\+\+\) \{\s+await sleep\(/.test(script)], [true, true]);
  check("--skip-if-done compares the row's plan tag (a plan pushed at 9am is not answered by 'it exists'), and --slot takes a list", [script.includes('row.plan === planTag("midday", day)'), script.includes('arg("--slot", "").split(",")'), script.includes("candidateKinds(slot, day, drafts, used)")], [true, true, true]);
  const wf = read(".github/workflows/social-post.yml");
  check("the workflow takes tiktok_slots and passes them as --slot", [wf.includes("tiktok_slots:"), wf.includes('slots="--slot $TIKTOK_SLOTS"')], [true, true]);
  const cron = read("src/app/api/cron/social-video/route.ts");
  check("the 12:40 route asks whether the 1pm video is CURRENT (plan) and checks today's 7pm video too", [cron.includes("middayVideo(day)"), cron.includes("sameDay: true"), !cron.includes("parseVideoSpec(await getSetting")], [true, true, true]);
  const card = read("src/components/admin/TikTokPackage.tsx");
  check("the card: heading in sentence case, a deadline on every try of the MP4 fetch, the loading row keeps a Download Video, and it refreshes when the phone comes back", [
    card.includes("TikTok — post by hand") && !card.includes("Post by Hand"),
    card.includes("DIRECT_MS") && card.includes("PROXY_MS") && card.includes("AbortController"),
    card.includes('mode !== "download"'),
    card.includes("visibilitychange") && card.includes("router.refresh()") && card.includes("etDay()"),
  ], [true, true, true, true]);
  check("an abandoned fetch (Mark Posted then Undo before the MP4 arrives) gives 'loading' back, and a row re-keys when its posted state changes", [card.includes('if (started && !finished) setFetching("idle")'), card.includes('r.posted ? "posted" : "open"')], [true, true]);
}

console.log("the picture follows the video's frozen cards; a video of an old plan is not posted");
{
  const route = read("src/app/api/social/image/route.tsx");
  check("the movers picture is drawn from the registered video's frozen list, else the live one", [route.includes("frozenMovers(game, kind, day)"), route.includes("frozen ?? (await topMovers("), route.includes("frozen ?? (await mixedMovers(")], [true, true, true]);
  const registered = await frozenMovers("pokemon", "movers", FRI);
  check("the 1pm video is registered: the picture's list is its cards, in order, with today's catalog art", [registered?.map((m) => m.name), registered?.map((m) => m.to), registered?.[0].imageUrl.startsWith("https://assets.tcgdex.net/en/sv/sv1/")], [["Miraidon ex", "Pawmi", "Gardevoir ex"], [15, 16, 24], true]);
  // The morning's price ingestion lands between the evening render and the 1:05pm post.
  for (const back of [3, 2, 1, 0]) await recordPoint("sv1-2", "pokemon", "normal", "tcgplayer", "USD", 15.8, day(back));
  const live = await social.topMovers("pokemon", FRI, { direction: "up", exclude: new Set() });
  const after = await frozenMovers("pokemon", "movers", FRI);
  check("prices move after the render: the live list changes, the frozen one (what the caption names) does not", [live.find((m) => m.name === "Miraidon ex")?.to, after?.find((m) => m.name === "Miraidon ex")?.to], [15.8, 15]);
  const pic = fakeSite("c_pic"); const vid = fakeSite("c_vid", { postsVideo: true });
  await publishSocial({ day: FRI, now: clock(17), origin: "http://x", slot: "midday", force: true, sites: [pic, vid], fetchImage, fetchVideo });
  check("1pm: the picture-only site and the video site say the same thing (the registered video's numbers), not the morning's", [pic.posts[0].text.includes("$15.00"), pic.posts[0].text.includes("$15.80"), vid.posts[0].text === pic.posts[0].text, vid.posts[0].video?.url], [true, false, true, "https://blob/tiktok/midday-movers-2026-09-11.mp4"]);
  // A plan pushed after the render: the video is the old plan's.
  DAY_PLANS[FRI] = { alsoScans: true };
  check("a plan pushed after the render: the old video is not current, and the picture is not drawn from it", [await currentVideoFor({ game: "pokemon", kind: "movers", day: FRI }), await frozenMovers("pokemon", "movers", FRI), (await T.middayVideo(FRI)).state], [null, null, "stale"]);
  const pic2 = fakeSite("d_pic"); const vid2 = fakeSite("d_vid", { postsVideo: true });
  await publishSocial({ day: FRI, now: clock(17), origin: "http://x", slot: "midday", force: true, sites: [pic2, vid2], fetchImage, fetchVideo });
  check("1pm under the new plan: no stale video goes out, and the text is the fresh draft's (this morning's prices), not rebuilt from the old cards", [vid2.posts[0].video ?? null, pic2.posts[0].text.includes("$15.80"), pic2.posts[0].text.includes("$15.00")], [null, true, false]);
  delete DAY_PLANS[FRI];
  check("the plan goes back: the video is current again", [(await currentVideoFor({ game: "pokemon", kind: "movers", day: FRI }))?.url, (await T.middayVideo(FRI)).state], ["https://blob/tiktok/midday-movers-2026-09-11.mp4", "ready"]);
}

console.log("a 1pm remake that falls back to another kind");
{
  const gamesDraft = (await social.socialDrafts("pokemon", FRI)).find((d) => d.kind === "games");
  const leads = (await frozenFor("games")).leads;
  const movers = await videoFor({ game: "pokemon", kind: "movers", day: FRI });
  const r = await T.registerTiktokVideo({ slot: "midday", day: FRI, kind: "games", url: "https://blob/tiktok/midday-games-2026-09-11.mp4", bytes: 1, seconds: 26, draft: gamesDraft, leads });
  check("the movers art was missing so 1pm became the all-games video: the file the other sites post is NOT deleted, and its row still points at it", [r.replaced.includes(movers.url), (await videoFor({ game: "pokemon", kind: "movers", day: FRI }))?.url, P.parseTiktokSpec(await getSetting(P.tiktokKey("midday", FRI))).kind], [false, movers.url, "games"]);
  DAY_PLANS[FRI] = { mixedMovers: true };
  const r2 = await T.registerTiktokVideo({ slot: "midday", day: FRI, kind: "games", url: "https://blob/tiktok/midday-games-2026-09-11.mp4", bytes: 1, seconds: 26, draft: gamesDraft, leads });
  check("…but a shared file made under a plan that has since changed is no use to anyone: its row is cleared and the file goes", [r2.replaced.includes(movers.url), await videoFor({ game: "pokemon", kind: "movers", day: FRI })], [true, null]);
  delete DAY_PLANS[FRI];
  await register("midday", FRI);
  check("the next movers render puts the shared row back", [(await T.readSlot("midday", FRI)).state, (await videoFor({ game: "pokemon", kind: "movers", day: FRI }))?.url], ["ready", "https://blob/tiktok/midday-movers-2026-09-11.mp4"]);
}

console.log("schedule, workflow, routes");
{
  const vercel = JSON.parse(read("vercel.json"));
  const cron = (p) => vercel.crons.filter((c) => c.path === p).map((c) => c.schedule).sort();
  check("Vercel checks the package at 9:15pm ET (both DST hours) and at 5:45am ET for a plan pushed overnight", cron("/api/cron/social-tiktok"), ["15 1 * * *", "15 2 * * *", "45 10 * * *", "45 9 * * *"]);
  const wf = read(".github/workflows/social-post.yml");
  check("GitHub pings the night render at 8pm ET (EDT and EST hours), with the ET time in a comment", [wf.includes('cron: "0 0 * * *"') && /"0 0 \* \* \*"\s+# 8pm EDT/.test(wf), wf.includes('cron: "0 1 * * *"') && /"0 1 \* \* \*"\s+# 8pm EST/.test(wf)], [true, true]);
  check("the workflow has a tiktok job, the tiktok dispatch inputs and the early-EST wait", [/^  tiktok:$/m.test(wf), wf.includes("tiktok_day:"), wf.includes("--min-hour"), wf.includes("EARLIEST_HOUR")], [true, true, true, true]);
  check("the night pings never run the post job or the 1pm render job", [/!contains\(fromJSON\('\[[^\]]*"0 0 \* \* \*","0 1 \* \* \*"\]'\), github\.event\.schedule\)/.test(wf), /\|\| contains\(fromJSON\('\[[^\]]*"0 0 \* \* \*"/.test(wf.split("  tiktok:")[0])], [true, false]);
  check("the render-only dispatch of the 1pm video does not start the tiktok job, and the tiktok dispatch does not post", [wf.includes("inputs.tiktok != '1' && (inputs.video == '1'"), /&& inputs\.tiktok != '1'\r?\n {6}&& !contains/.test(wf)], [true, true]); // \r?\n: a Windows checkout has CRLF
  // 10-01: replacing a registered video (a card the rules now leave out) is a hand dispatch of the named slots with tiktok_force=1.
  const sv = read("scripts/social-video.mjs");
  check("tiktok_force is a dispatch input, passed as --force ONLY when slots are named (the schedule and the net can never redraw a ready video)", [wf.includes("tiktok_force:"), wf.includes('TIKTOK_FORCE: ${{ inputs.tiktok_force }}'), wf.includes('[ "$TIKTOK_FORCE" = "1" ] && [ -n "$TIKTOK_SLOTS" ]'), wf.includes("$slots $force")], [true, true, true, true]);
  check("the script refuses --force without --slot, and skips a ready slot only when it is not forced", [sv.includes("if (FORCE && PACKAGE && !ONLY.length)"), sv.includes('if (!FORCE && st.state === "ready")')], [true, true]);
  check("a remake over an existing row is parked under a new blob path (the CDN keeps an overwritten path's old bytes)", [sv.includes("const remake = prior?.url ?"), sv.includes("${day}${remake}.mp4")], [true, true]);
  const cronRoute = read("src/app/api/cron/social-tiktok/route.ts");
  check("the cron route takes the Vercel bearer, the GitHub key or the owner, and nothing else", [cronRoute.includes("cronAuthError(req)"), cronRoute.includes("SOCIAL_POST_KEY"), cronRoute.includes("requireAdminOwner")], [true, true, true]);
  const video = read("src/app/api/admin/social/tiktok/video/route.ts"), post = read("src/app/api/admin/social/tiktok/route.ts");
  check("the video stream and Mark Posted are owner-only", [video.includes("requireAdminOwner()"), post.includes("requireAdminOwner()")], [true, true]);
  const card = read("src/components/admin/TikTokPackage.tsx");
  check("the card: Share Video shares a pre-fetched File with nothing awaited first, Download Video fallback, Mark Posted, the preview is muted and inline", [
    /function share\(\) \{[^}]*navigator\.share\(\{ files: \[file\] \}\)/s.test(card) && !/async function share/.test(card),
    card.includes("Download Video") && card.includes("Mark Posted") && card.includes("Copy Caption") && card.includes("Share Video"),
    card.includes("muted") && card.includes("playsInline") && !card.includes("autoPlay"),
    card.includes("/api/admin/social/tiktok/video"),
  ], [true, true, true, true]);
}

// ---- 10-01: the evening video is each game's biggest jump; the 7am video leads with its riser; TikTok carries five tags -------------
console.log("10-01: jumps video, lead-first set video, five hashtags, the question");
{
  const J = "2026-11-20";
  const PLm = await import(at("lib/socialPlan.ts"));
  const hashtagsOf = (s) => (s.match(/(?:^|\s)#[A-Za-z]\w*/g) ?? []).map((t) => t.trim());
  check("every stored caption of the package carries at most seven hashtags", ["morning", "midday", "evening"].map((s) => hashtagsOf(rows[s].caption).length <= 7), [true, true, true]);
  check("TikTok fills the room to seven: Pokémon's own two, #TCG #TradingCards #CardCollector, then the reach tags #Pokemon #PokemonCommunity (10-03)", hashtagsOf(rows.morning.caption), ["#PokemonTCG", "#PokemonCards", "#TCG", "#TradingCards", "#CardCollector", "#Pokemon", "#PokemonCommunity"]);
  check("every stored caption carries its question after the card lines and before the tags (the sign-off leads on TikTok since 10-02)", ["morning", "midday", "evening"].map((s) => { const lines = rows[s].caption.split("\n"); const i = lines.findIndex((l) => l.endsWith("?")); return i > 0 && lines[i + 2]?.startsWith("#") && /\$/.test(lines[i - 2]); }), [true, true, true]);
  check("tiktokTags: the post's own first, the general ones fill, never more than seven (10-02 seven-tag test won)", [T.tiktokTags(["A", "B", "C", "D", "E", "F", "G", "H"]), T.tiktokTags(["PokemonTCG", "MTG", "MagicTheGathering", "TCG", "TradingCards"]), T.tiktokTags(["TCG"])], [["A", "B", "C", "D", "E", "F", "G"], ["PokemonTCG", "MTG", "MagicTheGathering", "TCG", "TradingCards", "CardCollector", "Pokemon"], ["TCG", "TradingCards", "CardCollector", "Pokemon", "PokemonCommunity"]]);

  const jl = [
    { game: "mtg", name: "Jump Mage", setName: "Jump Masters", number: "7", price: 64, cardId: "m1", from: 40, pct: 60 },
    { game: "pokemon", name: "Riser A", setName: "Jump Set", number: "1", price: 70, cardId: "p1", from: 50, pct: 40, variant: "holofoil" },
    { game: "lorcana", name: "Elsa", setName: "The First Chapter", number: "42", price: 61 },
    { game: "onepiece", name: "Portgas.D.Ace", setName: "Premium Booster", number: "P-055", price: 75 },
    { game: "yugioh", name: "Dark Magician", setName: "Legend of Blue Eyes (Worldwide English)", number: "LOB-005", price: 55.25 },
  ];
  const gd = { id: `pokemon-games-${J}`, kind: "games", game: "pokemon", day: J, title: "x", caption: "x", shortCaption: "x", hashtags: ["x"], imagePath: "", cardIds: [] };
  const post = T.tiktokPost(gd, { leads: jl });
  check("the evening TikTok text: the jumps title, a line per game with its move, the question, the address, five game tags + #TCG #TradingCards", [post.title, post.caption.includes("Magic: Jump Mage (Jump Masters #7): $64.00, +60% this week"), post.caption.includes("Lorcana: Elsa (The First Chapter #42): $61.00 today"), post.caption.includes(PLm.questionFor("games", J)), hashtagsOf(post.caption)], ["Biggest price jumps this week", true, true, true, ["#PokemonTCG", "#MTG", "#DisneyLorcana", "#OPTCG", "#Yugioh", "#TCG", "#TradingCards"]]);
  check("the jumps text says nothing about a picture (the 'In the video' swap is only for the old text)", [post.caption.includes("In the picture"), post.caption.includes("In the video")], [false, false]);
  const rebuilt = applyGameLeads(gd, jl);
  check("the draft rebuilt from the video's frozen leads files the same jump cards for the no-repeat rule", [rebuilt.cardIds, rebuilt.featured], [["m1", "p1"], { mtg: ["m1"], pokemon: ["p1"] }]);
  const old = applyGameLeads({ ...gd, day: FRI }, jl.slice(2).map((l) => ({ ...l })));
  check("a frozen row with no jump (every row made before 10-01) keeps the old title and caption shape", [old.title, old.cardIds, old.caption.startsWith("One scanner, three card games.")], ["One scanner, three card games", [], true]);
  check("the parser keeps a jump lead's fields and still accepts a plain lead (rows from before)", (() => { const spec = parseVideoSpec(JSON.stringify({ url: "https://blob/x.mp4", bytes: 1, leads: jl })); return [spec.leads.length, spec.leads[0].pct, spec.leads[2].pct ?? null]; })(), [5, 60, null]);
  check("…and a malformed jump lead voids the list (never half a post)", parseVideoSpec(JSON.stringify({ url: "https://blob/x.mp4", bytes: 1, leads: [{ ...jl[0], pct: "60" }] })).leads ?? null, null);

  // The plan tag: a video made before the rule is stale from 10-01 on, so the safety net remakes it (no forced render needed).
  const regd = await T.registerTiktokVideo({ slot: "evening", day: J, kind: "games", url: "https://blob/tiktok/evening-games.mp4", bytes: 9_000_000, seconds: 26.2, draft: gd, leads: jl, audio: "track.mp3", now: 1_800_000_000_000 });
  check("a video made now carries the 'jumps' plan and is ready", [regd.spec.plan, (await T.readSlot("evening", J)).state], ["games+jumps", "ready"]);
  const oldRow = { ...regd.spec, plan: "games" };
  await setSetting(P.tiktokKey("evening", J), JSON.stringify(oldRow));
  check("the evening video registered under the old plan ('games') is stale: the render safety net remakes it", [(await T.readSlot("evening", J)).state, await T.slotsToRender(J)], ["stale", ["morning", "midday", "evening"]]);
  await setSetting(P.tiktokKey("morning", J), JSON.stringify({ ...regd.spec, slot: "morning", kind: "set", plan: "set", leads: undefined, cards: [{ cardId: "a", name: "A", number: "1", setName: "S", variant: "holofoil", from: 1, to: 2, pct: 5 }] }));
  check("the 7am set video made before the lead rule ('set') is stale from 10-01 too", [(await T.readSlot("morning", J)).state, T.planTag("morning", J)], ["stale", "set+lead"]);
  const sd = { id: `pokemon-set-${J}`, kind: "set", game: "pokemon", day: J, title: "x", caption: "x", shortCaption: "x", hashtags: ["PokemonTCG", "PokemonCards", "TCG"], imagePath: "", cardIds: [] };
  const setCards = [
    { cardId: "p1", name: "Riser A", number: "1", setName: "Jump Set", variant: "holofoil", from: 50, to: 70, pct: 40, rank: 2 },
    { cardId: "p3", name: "Step Jumper", number: "3", setName: "Jump Set", variant: "holofoil", from: 52, to: 90, pct: 71, rank: 1 },
    { cardId: "p4", name: "Faller", number: "4", setName: "Jump Set", variant: "holofoil", from: 80, to: 60, pct: -25, rank: 3 },
  ];
  const setPost = T.tiktokPost(sd, { cards: setCards });
  check("the set video's text lists the riser first and is the same text the publisher builds", [setPost.caption.split("\n")[4], hashtagsOf(setPost.caption).length], ["Riser A #1 Holo: $70.00, +40% this week", 7]);
  check("a frozen set card keeps its value rank through the parser (the video's No. label)", parseVideoSpec(JSON.stringify({ url: "https://blob/x.mp4", bytes: 1, cards: setCards })).cards.map((c) => c.rank), [2, 1, 3]);
}

console.log("10-01: the render script and the scene");
{
  const html = scene.sceneHtml({
    W: 1080, H: 1920, logo: "", intro: { kicker: "k", title: "t", sub: "s" },
    cards: [
      { rank: "Magic", art: "", name: "Jump Mage", meta: "m", to: 64, pct: { text: "▲ 60.0% this week", cls: "up big", early: true } },
      { rank: "Lorcana", art: "", name: "Elsa", meta: "m", to: 61, pct: { text: "market price today", cls: "muted" } },
    ],
    outro: {}, INTRO: 2, BEAT: 4, OUTRO: 2, PERIOD: 1, MUSIC: true, TOTAL: 12, safeBottom: true,
  });
  check("a riser's move is drawn big and marked to show from the card's first second; a lead card's line is not", [html.includes('<div class="pct up big" data-early="1">▲ 60.0% this week</div>'), html.includes('<div class="pct muted">market price today</div>'), (html.match(/data-early/g) ?? []).length], [true, true, 1]);
  check("the scene fades the early move in at the card's second beat, the others on beat 3 as before", [html.includes("pctEl.dataset.early ? P*1.1 : 3*P"), /\.beat \.pct\.big \{ font-size:80px/.test(html)], [true, true]);
  const src = read("scripts/social-video.mjs");
  check("the render script: the 7pm video draws the jumps from 10-01 (the lead cards before), biggest first, and freezes each jump's id, old price, move and variant", [src.includes("jumpsOn(day) ? await gameJumps(day) : await gameLeads(day)"), src.includes("cls: \"up big\", early: true"), src.includes("...(isJump(c) && c.cardId ? { cardId: c.cardId, from: c.from, pct: c.pct")], [true, true, true]);
  check("the render script: the 7am video opens on the set's riser, counts the rest down, keeps each value rank, and freezes the caption's order", [src.includes("const order = spot.leadId ? [spot.cards[0], ...[...rest].reverse()] : [...spot.cards].reverse();"), src.includes("`No. ${c.rank ?? n - i}`"), src.includes("frozen: { cards: spot.cards.map(")], [true, true, true]);
}

console.log("10-02: every video ends on the all-games card, and the list fits the outro at any tempo");
{
  const src = read("scripts/social-video.mjs");
  check("the render script: the set, movers and all-games videos all use the all-games outro, timed as the long one", [(src.match(/outro: ALL_GAMES_OUTRO,/g) ?? []).length, /outro: \{\},/.test(src), src.includes("mixed: gamesOutro")], [3, false, true]);
  // The three tracks of 10-02: outro = 2 bars + 0.6 (a bar over 2.9s counts as two).
  const fitsAll = [[60 / 123.05, 4.5], [60 / 74, 3.84], [60 / 92.5, 5.79]].map(([p, outro]) => {
    const q = scene.outroStep(p, outro);
    return [q <= p + 1e-9, 6.5 * q + 0.45 <= outro];
  });
  check("the fifth game name and the address are on screen before the video ends, at 123, 74 and 92 bpm", fitsAll, [[true, true], [true, true], [true, true]]);
  check("a fast track keeps one name per beat; the slow 74 bpm track goes to half beats", [scene.outroStep(60 / 123.05, 4.5) === 60 / 123.05, scene.outroStep(60 / 74, 3.84) === 60 / 74 / 2], [true, true]);
  check("a very short outro still fits the list", 6.5 * scene.outroStep(1, 2) + 0.45 <= 2.6, true);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
