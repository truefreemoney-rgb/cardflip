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
 * safety net remakes it; the "ready" mail goes out once, to the owner; the
 * audio rotates by slot; Mark Posted uses the publisher's key shape; the cron,
 * workflow and routes are pinned.
 *
 * Same throwaway-db trick as test-social-video.mjs.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
const { publishSocial, videoFor, applyVideoCards, fitText, slotKind, SLOTS, SLOT_PREFIX, LAST_POST_PREFIX } = await import(at("lib/server/socialPublish.ts"));
const { SOCIAL_SITES } = await import(at("lib/server/socialSites.ts"));
const T = await import(at("lib/server/socialTiktok.ts"));
const P = await import(at("lib/socialTiktok.ts"));
const { DAY_PLANS } = await import(at("lib/socialPlan.ts"));
const { videoKey } = await import(at("lib/socialVideo.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
const { addDays } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));
const audio = await import(new URL("./lib/audio-plan.mjs", import.meta.url).href);

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
  "stage:v7:pokemon": [stage("Charizard ex", "Obsidian Flames", "125", 48.5, { lead: true })],
  "stage:v13:mtg": [stage("Sol Ring", "Commander Masters", "410", 32.1, { lead: true })],
  "stage:v13:lorcana": [stage("Elsa", "The First Chapter", "42", 61, { lead: true })],
  "stage:v13:onepiece": [stage("Portgas.D.Ace", "Premium Booster", "P-055", 75, { lead: true })],
  "stage:v13:yugioh": [stage("Dark Magician", "Legend of Blue Eyes (Worldwide English)", "LOB-005", 55.25, { lead: true })],
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
check("fixture: the Friday has games, movers and set drafts (no drops)", drafts.map((d) => d.kind).sort(), ["games", "movers", "set"]);

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
check("7am and 7pm register ONLY in the TikTok namespace: the site video rows stay empty", [await videoFor({ game: "pokemon", kind: "set", day: FRI }), await videoFor({ game: "pokemon", kind: "games", day: FRI }), morning.shared, evening.shared], [null, null, null, null]);
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
check("the stored caption IS the publisher's own text builder at TikTok's limit (fitText of the draft with the frozen cards)", rows.morning.caption, fitText(applyVideoCards(setDraft, morning.spec.cards), 2200));
check("a row keeps the frozen cards and leads it drew (text can never drift from the video)", [rows.morning.cards.length, rows.evening.leads.map((l) => l.game)], [5, ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]]);
check("the parser refuses a row with no caption or no plan", [P.parseTiktokSpec(JSON.stringify({ ...rows.morning, caption: "" })), P.parseTiktokSpec(JSON.stringify({ ...rows.morning, plan: undefined })), P.parseTiktokSpec("nope")], [null, null, null]);

console.log("the other six sites are untouched by the package");
const bPic = fakeSite("b_pic"); const bVid = fakeSite("b_vid", { postsVideo: true });
for (const [slot, h] of [["morning", 11], ["midday", 17], ["evening", 23]]) await publishSocial({ day: FRI, now: clock(h), origin: "http://x", slot, force: true, sites: [bPic, bVid], fetchImage, fetchVideo });
check("7am and 7pm: the same picture posts as before, same text, and no video even on the video site", [0, 2].map((i) => [bPic.posts[i].text === BASE.pic[i].text, bPic.posts[i].alt === BASE.pic[i].alt, bVid.posts[i].video ?? null, bVid.posts[i].text === BASE.vid[i].text]), [[true, true, null, true], [true, true, null, true]]);
check("1pm: tomorrow's registered movers video is what the 1:05pm post finds (the video site gets that file)", [bVid.posts[1].video?.url, bVid.posts[1].video?.seconds, bPic.posts[1].video ?? null], ["https://blob/tiktok/midday-movers-2026-09-11.mp4", 26.2, null]);
check("1pm text is the same movers post (the frozen cards are the ones the draft had)", bVid.posts[1].text === BASE.vid[1].text, true);
check("no site row ever appeared for set or games", [await videoFor({ game: "pokemon", kind: "set", day: FRI }), await videoFor({ game: "pokemon", kind: "games", day: FRI }), before.movers, before.set, before.games], [null, null, null, null, null]);

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
  const realFetch = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, init) => (sent.push({ url: String(url), body: JSON.parse(init.body), auth: init.headers.Authorization }), new Response(null, { status: 204 }));
  process.env.GITHUB_TOKEN = "gh-test";
  await T.dispatchTiktokRender("2026-09-11");
  check("the dispatch is the social-post workflow with tiktok=1 and the day", [sent[0].url.endsWith("/actions/workflows/social-post.yml/dispatches"), sent[0].body, sent[0].auth], [true, { ref: "main", inputs: { tiktok: "1", tiktok_day: "2026-09-11" } }, "Bearer gh-test"]);
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
const mdeps = { get: async (k) => store.get(k) ?? null, set: async (k, v) => void store.set(k, v), send: async (m) => void mails.push(m) };
const pkg = await T.loadPackage(FRI);
check("ready: one mail with the three post times and captions", [await T.notifyPackageReady(FRI, { ...mdeps, pkg }), mails.length, mails[0].rows.map((r) => r.time), mails[0].rows.every((r) => r.caption.includes("cardflip.io")), mails[0].label], ["sent", 1, ["7:05am ET", "1:05pm ET", "7:05pm ET"], true, "Fri, Sep 11"]);
check("the same day again (the render job's ping, then the 9:15pm net): no second mail", [await T.notifyPackageReady(FRI, { ...mdeps, pkg }), await T.notifyPackageReady(FRI, { ...mdeps, pkg }), mails.length], ["already", "already", 1]);
check("the next package day mails again", [await T.notifyPackageReady("2026-09-12", { ...mdeps, pkg: { ...pkg, day: "2026-09-12" } }), mails.length], ["sent", 2]);
check("an incomplete package sends nothing", [await T.notifyPackageReady("2026-09-13", { ...mdeps, pkg: { ...pkg, rows: [...pkg.rows.slice(0, 2), { ...pkg.rows[2], state: "missing" }] } }), mails.length], ["not-ready", 2]);
check("a send that fails gives the day back, so the next ping tries again", [await T.notifyPackageReady("2026-09-14", { ...mdeps, pkg, send: async () => { throw new Error("smtp down"); } }).catch((e) => e.message), store.get(`${P.TIKTOK_MAILED_PREFIX}2026-09-14`)], ["smtp down", ""]);
check("no mail server here → it says so and does not claim the day", [await T.notifyPackageReady(FRI, { pkg }), await getSetting(`${P.TIKTOK_MAILED_PREFIX}${FRI}`)], ["no-mail", null]);
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
check("today's missing slots say what happens", [(await T.loadPackage("2026-09-20", Date.UTC(2026, 8, 20, 14, 0))).rows.map((r) => r.note), (await T.loadPackage("2026-09-20", Date.UTC(2026, 8, 20, 16, 0))).rows[1].note], [["Not made.", "Renders around 10:30am ET.", "Not made."], "Rendering now. Check back in a few minutes."]);
await T.markTiktokPosted("morning", FRI, true);
check("Mark Posted records social_slot:tiktok:<slot> = the Eastern day, the publisher's key shape", [await getSetting("social_slot:tiktok:morning"), P.tiktokPostedKey("morning") === `${SLOT_PREFIX}tiktok:morning`, (await T.loadPackage(FRI)).rows.map((r) => r.posted)], [FRI, true, [true, false, false]]);
check("…it only shows for its own day", (await T.loadPackage(THU)).rows.map((r) => r.posted), [false, false, false]);
await T.markTiktokPosted("morning", FRI, false);
check("Undo clears it", (await T.loadPackage(FRI)).rows[0].posted, false);
check("marking posted is not a failure and is not a post: no failed/alerted rows, no last-post line", [await getSetting(`${SLOT_PREFIX}failed:tiktok:morning`), await getSetting(`${LAST_POST_PREFIX}tiktok`)], [null, null]);

// ---- 7. Audio, crons, workflow, routes ---------------------------------------------------------------------------------
console.log("audio rotation");
{
  const di = 20_000;
  check("three tracks: the three videos of a day get three different ones; 1pm keeps the plain day rotation", [["midday", "morning", "evening"].map((s) => audio.trackIndex(s, di, 3)), audio.trackIndex("midday", di, 3) === di % 3], [[di % 3, (di + 1) % 3, (di + 2) % 3], true]);
  check("three tracks: nobody starts deeper in", ["midday", "morning", "evening"].map((s) => audio.sectionFor(s, di, 3)), [0, 0, 0]);
  check("one track (all that is committed): the opening, then 8 bars in, then 16", ["midday", "morning", "evening"].map((s) => audio.sectionFor(s, di, 1)), [0, 1, 2]);
  check("two tracks: only the two that share a track differ", [["midday", "morning", "evening"].map((s) => audio.trackIndex(s, di, 2)), ["midday", "morning", "evening"].map((s) => audio.sectionFor(s, di, 2))], [[0, 1, 0], [0, 0, 1]]);
  const track = { start: 10.08, duration: 73.35 }, bar = 2.1333;
  check("a later section starts on the beat grid (8 bars per step) and fits the track", [audio.audioStart(track, bar, 0, 26.2), +audio.audioStart(track, bar, 1, 26.2).toFixed(3), +audio.audioStart(track, bar, 2, 26.2).toFixed(3)], [10.08, +(10.08 + 8 * bar).toFixed(3), +(10.08 + 16 * bar).toFixed(3)]);
  check("a video too long to fit further in falls back a step, then to the opening", [+audio.audioStart(track, bar, 2, 40).toFixed(3), audio.audioStart(track, bar, 2, 70)], [+(10.08 + 8 * bar).toFixed(3), 10.08]);
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
  check("the render-only dispatch of the 1pm video does not start the tiktok job, and the tiktok dispatch does not post", [wf.includes("inputs.tiktok != '1' && (inputs.video == '1'"), wf.includes("&& inputs.tiktok != '1'\n      && !contains")], [true, true]);
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

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
