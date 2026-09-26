/**
 * Social video (lib/socialVideo.ts, the video path through socialPublish.ts
 * and the site adapters). Run: npm run test:socialvideo
 *
 * Pins: timeline math (15.3s for five cards, beats land on the card
 * changes); the settings key and its parser; the publisher hands a
 * registered MP4 to sites that post video and only those, fetches it once
 * per run, falls back to the picture when the video upload throws (slot
 * still counts, report says so); dry runs flag video without fetching it;
 * adapter payload shapes with fetch stubbed: Bluesky (service auth →
 * uploadVideo → job poll → embed.video record), X (initialize → append →
 * finalize → STATUS → tweet with the media id), Threads (VIDEO container
 * from the Blob URL, no parking), Instagram (REELS), Facebook (file_url).
 *
 * Same throwaway-db trick as test-social-publish.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-social-video-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});
process.env.CRON_SECRET = "cron-test";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { TIMELINE, videoSeconds, beatStart, videoKey, parseVideoSpec, VIDEO_W, VIDEO_H } = await import(at("lib/socialVideo.ts"));
const { recordPoint } = await import(at("lib/server/priceHistory.ts"));
const { publishSocial, videoFor, SLOT_PREFIX } = await import(at("lib/server/socialPublish.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
const { addDays } = await import(at("lib/priceSeries.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("timeline");
check("five cards = 15.3s", videoSeconds(5), 15.3);
check("intro, beat, outro", [TIMELINE.intro, TIMELINE.beat, TIMELINE.outro], [2.2, 2.1, 2.6]);
check("beats start after the intro, 2.1s apart", [beatStart(0), beatStart(4)], [2.2, 10.6]);
check("last beat ends where the outro starts", Math.round((beatStart(4) + TIMELINE.beat) * 10) / 10, Math.round((videoSeconds(5) - TIMELINE.outro) * 10) / 10);
check("9:16 frame", [VIDEO_W, VIDEO_H], [1080, 1920]);

console.log("registry");
check("key", videoKey("pokemon", "set", "2026-09-26"), "social_video:pokemon:set:2026-09-26");
check("parser fills defaults", parseVideoSpec(JSON.stringify({ url: "https://blob/x.mp4", bytes: 12 })), { url: "https://blob/x.mp4", bytes: 12, mime: "video/mp4", width: 1080, height: 1920, seconds: 0, renderedAt: 0 });
check("parser refuses junk", [parseVideoSpec(null), parseVideoSpec("nope"), parseVideoSpec(JSON.stringify({ url: "http://insecure", bytes: 1 }))], [null, null, null]);

console.log("publisher");
const THU = "2026-09-10";
const day = (back) => addDays(THU, -back);
async function catalog(id, name, num) {
  await db.prepare(
    "INSERT INTO en_cards (id, name, set_id, set_name, local_id, image_url, synced_at) VALUES (?, ?, 'sv1', 'Scarlet & Violet', ?, ?, 0)",
  ).run(id, name, num, `https://assets.tcgdex.net/en/sv/sv1/${num}/low.webp`);
}
async function series(id, from, to) {
  await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", from, day(7));
  for (const back of [2, 1, 0]) await recordPoint(id, "pokemon", "normal", "tcgplayer", "USD", to, day(back));
}
await catalog("sv1-2", "Miraidon ex", "81"); await series("sv1-2", 10, 15);
await catalog("sv1-3", "Koraidon ex", "125"); await series("sv1-3", 40, 20);
await catalog("sv1-4", "Gardevoir ex", "86"); await series("sv1-4", 20, 24);
await catalog("sv1-5", "Arcanine ex", "32"); await series("sv1-5", 30, 30);
await catalog("sv1-6", "Pawmot", "76"); await series("sv1-6", 12, 12);
await catalog("sv1-7", "Pawmi", "74"); await series("sv1-7", 12, 16);

const clock = (h, m = 30) => Date.UTC(2026, 8, 10, h, m);
const fetchImage = async () => Buffer.from("png");
const videoFetches = [];
const fetchVideo = async (url) => { videoFetches.push(url); return Buffer.from("mp4-bytes"); };
function fakeSite(id, { postsVideo = false, failVideo = false } = {}) {
  const posts = [];
  return {
    id, label: id, maxChars: 5000, maxImageBytes: 1_000_000, postsVideo, posts,
    connected: () => true,
    async post(p) { if (failVideo && p.video) throw new Error("video upload boom"); posts.push(p); return { uri: `https://${id}/${posts.length}` }; },
  };
}

const pic = fakeSite("pic");
const vid = fakeSite("vid", { postsVideo: true });
let r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", sites: [pic, vid], fetchImage, fetchVideo });
check("no video registered → both sites post the picture, nothing fetched", [pic.posts[0].video ?? null, vid.posts[0].video ?? null, videoFetches.length, r.sites.map((s) => s.posts[0].video ?? null)], [null, null, 0, [null, null]]);

await setSetting(videoKey("pokemon", "set", THU), JSON.stringify({ url: "https://blob/pokemon-set.mp4", bytes: 9, mime: "video/mp4", width: 1080, height: 1920, seconds: 15.3, renderedAt: 1 }));
check("videoFor reads the row", (await videoFor({ game: "pokemon", kind: "set", day: THU }))?.url, "https://blob/pokemon-set.mp4");
check("nothing for movers", await videoFor({ game: "pokemon", kind: "movers", day: THU }), null);

r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", slot: "morning", force: true, sites: [pic, vid], fetchImage, fetchVideo, dry: true });
check("dry run flags video for the video site only, fetches nothing", [r.sites[0].posts[0].video ?? null, r.sites[1].posts[0].video ?? null, videoFetches.length], [null, "yes", 0]);

const vid2 = fakeSite("vid2", { postsVideo: true });
const broken = fakeSite("broken", { postsVideo: true, failVideo: true });
r = await publishSocial({ day: THU, now: clock(11), origin: "http://x", slot: "morning", force: true, sites: [pic, vid, vid2, broken], fetchImage, fetchVideo });
check("picture site still gets the picture", [pic.posts.at(-1).video ?? null, r.sites[0].posts[0].video ?? null], [null, null]);
check("video sites get the MP4 with its url and bytes", [vid.posts.at(-1).video.url, vid.posts.at(-1).video.bytes.toString(), vid.posts.at(-1).video.seconds, r.sites[1].posts[0].video], ["https://blob/pokemon-set.mp4", "mp4-bytes", 15.3, "yes"]);
check("the picture rides along for the adapter's own fallback", vid.posts.at(-1).image.toString(), "png");
check("one video fetch for three video sites", videoFetches, ["https://blob/pokemon-set.mp4"]);
check("video upload failure → picture posted, slot marked, report says fallback", [broken.posts.length, broken.posts[0].video ?? null, r.sites[3].status, r.sites[3].posts[0].video, r.sites[3].posts[0].error, await getSetting(`${SLOT_PREFIX}broken:morning`)], [1, null, "posted", "fallback", "video failed, picture posted: video upload boom", THU]);
check("sites reported in order", r.sites.map((s) => s.site), ["pic", "vid", "vid2", "broken"]);

console.log("adapters (fetch stubbed)");
const realFetch = globalThis.fetch;
const calls = [];
const VIDEO = { url: "https://blob/pokemon-set.mp4", bytes: Buffer.from("mp4-bytes"), mime: "video/mp4", width: 1080, height: 1920, seconds: 15.3 };
const POST = { text: "Set spotlight cardflip.io", image: Buffer.from("png"), mime: "image/png", width: 1080, height: 1080, alt: "Set spotlight: five cards", video: VIDEO };
async function bodyOf(init) {
  if (!init?.body) return null;
  if (typeof init.body === "string") return init.body;
  if (init.body instanceof FormData) { const o = {}; for (const [k, v] of init.body.entries()) o[k] = typeof v === "string" ? v : `<file ${v.size}b>`; return o; }
  return `<bytes ${init.body.byteLength ?? init.body.length}>`;
}
function stub(handler) {
  calls.length = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const body = await bodyOf(init);
    calls.push({ url: u, method: init.method ?? "GET", body, ct: init.headers?.["content-type"] ?? null });
    const out = handler(u, body, calls.length);
    // { status: <number>, body } = an HTTP status; anything else (even { status: "FINISHED" }) is a 200 JSON body.
    const http = typeof out.status === "number" ? out.status : 200;
    const payload = typeof out.status === "number" ? (out.body ?? {}) : out;
    return new Response(JSON.stringify(payload), { status: http });
  };
}

// Bluesky
process.env.BLUESKY_HANDLE = "cardflip.bsky.social";
process.env.BLUESKY_APP_PASSWORD = "app-pass";
const { bluesky, pdsHost } = await import(at("lib/server/sites/bluesky.ts"));
check("pdsHost reads the DID document, falls back to bsky.social", [
  pdsHost({ didDoc: { service: [{ id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://oyster.us-east.host.bsky.network" }] } }),
  pdsHost({}),
], ["oyster.us-east.host.bsky.network", "bsky.social"]);
let polls = 0;
stub((u) => {
  if (u.includes("createSession")) return { accessJwt: "jwt", did: "did:plc:me", didDoc: { service: [{ id: "#atproto_pds", serviceEndpoint: "https://oyster.us-east.host.bsky.network" }] } };
  if (u.includes("getServiceAuth")) return { token: "svc-token" };
  if (u.includes("uploadVideo")) return { jobStatus: { jobId: "job1", state: "JOB_STATE_CREATED" } };
  if (u.includes("getJobStatus")) return { jobStatus: ++polls < 2 ? { jobId: "job1", state: "JOB_STATE_ENCODING" } : { jobId: "job1", state: "JOB_STATE_COMPLETED", blob: { $type: "blob", ref: { $link: "bafy" }, mimeType: "video/mp4", size: 9 } } };
  if (u.includes("createRecord")) return { uri: "at://did:plc:me/app.bsky.feed.post/3k" };
  return { status: 500, body: { error: `unexpected ${u}` } };
});
let out = await bluesky.post(POST);
check("bluesky: session → service auth (aud = own PDS, lxm uploadBlob) → uploadVideo → poll → record", calls.map((c) => c.url.split("/xrpc/")[1]?.split("?")[0]), ["com.atproto.server.createSession", "com.atproto.server.getServiceAuth", "app.bsky.video.uploadVideo", "app.bsky.video.getJobStatus", "app.bsky.video.getJobStatus", "com.atproto.repo.createRecord"]);
check("bluesky: service auth audience is the account's PDS", calls[1].url.includes(`aud=${encodeURIComponent("did:web:oyster.us-east.host.bsky.network")}&lxm=com.atproto.repo.uploadBlob`));
check("bluesky: upload is the raw MP4 for the did", [calls[2].url.includes("did=did%3Aplc%3Ame"), calls[2].ct, calls[2].body], [true, "video/mp4", "<bytes 9>"]);
const rec = JSON.parse(calls[5].body).record;
check("bluesky: embed.video with the job's blob, alt and 9:16", [rec.embed.$type, rec.embed.video.ref.$link, rec.embed.alt, rec.embed.aspectRatio], ["app.bsky.embed.video", "bafy", POST.alt, { width: 1080, height: 1920 }]);
check("bluesky: post url", out.uri, "https://bsky.app/profile/cardflip.bsky.social/post/3k");
stub((u) => {
  if (u.includes("createSession")) return { accessJwt: "jwt", did: "did:plc:me" };
  if (u.includes("getServiceAuth")) return { token: "svc-token" };
  if (u.includes("uploadVideo")) return { jobStatus: { jobId: "job2", state: "JOB_STATE_FAILED", error: "too long" } };
  return { status: 500, body: {} };
});
check("bluesky: failed job throws (publisher then posts the picture)", await bluesky.post(POST).then(() => "posted", (e) => e.message), "bluesky video job failed: too long");
stub((u) => {
  if (u.includes("createSession")) return { accessJwt: "jwt", did: "did:plc:me" };
  if (u.includes("uploadBlob")) return { blob: { $type: "blob", ref: { $link: "img" } } };
  if (u.includes("createRecord")) return { uri: "at://did:plc:me/app.bsky.feed.post/3p" };
  return { status: 500, body: {} };
});
await bluesky.post({ ...POST, video: undefined });
check("bluesky: no video → the picture path is unchanged", [calls.length, JSON.parse(calls[2].body).record.embed.$type], [3, "app.bsky.embed.images"]);
delete process.env.BLUESKY_HANDLE;
delete process.env.BLUESKY_APP_PASSWORD;

// X
Object.assign(process.env, { X_API_KEY: "k", X_API_SECRET: "s", X_ACCESS_TOKEN: "t", X_ACCESS_SECRET: "ts", X_HANDLE: "cardflipio" });
const { x } = await import(at("lib/server/sites/x.ts"));
let statusPolls = 0;
stub((u, body) => {
  if (u.endsWith("/2/media/upload/initialize")) return { data: { id: "m1" } };
  if (u.endsWith("/append")) return { status: 200, body: {} };
  if (u.endsWith("/finalize")) return { data: { id: "m1", processing_info: { state: "pending", check_after_secs: 0 } } };
  if (u.includes("/2/media/upload?command=STATUS")) return { data: { processing_info: { state: ++statusPolls < 2 ? "in_progress" : "succeeded", check_after_secs: 0 } } };
  if (u.endsWith("/2/tweets")) return { data: { id: "777" } };
  return { status: 500, body: { title: `unexpected ${u} ${body}` } };
});
out = await x.post(POST);
check("x: initialize → append → finalize → STATUS ×2 → tweet", calls.map((c) => `${c.method} ${c.url.replace("https://api.x.com", "")}`), [
  "POST /2/media/upload/initialize", "POST /2/media/upload/m1/append", "POST /2/media/upload/m1/finalize",
  "GET /2/media/upload?command=STATUS&media_id=m1", "GET /2/media/upload?command=STATUS&media_id=m1", "POST /2/tweets",
]);
check("x: initialize says tweet_video with the byte count", JSON.parse(calls[0].body), { media_type: "video/mp4", total_bytes: 9, media_category: "tweet_video" });
check("x: append carries segment 0 and the file", calls[1].body, { segment_index: "0", media: "<file 9b>" });
check("x: tweet with the media id, no alt-text call for video", [JSON.parse(calls[5].body), out.uri], [{ text: POST.text, media: { media_ids: ["m1"] } }, "https://x.com/cardflipio/status/777"]);
stub((u) => {
  if (u.endsWith("/2/media/upload/initialize")) return { data: { id: "m2" } };
  if (u.endsWith("/append")) return { status: 200, body: {} };
  if (u.endsWith("/finalize")) return { data: { id: "m2", processing_info: { state: "failed", error: { message: "InvalidMedia" } } } };
  return { status: 500, body: {} };
});
check("x: failed processing throws", await x.post(POST).then(() => "posted", (e) => e.message), "x video processing failed: InvalidMedia");
for (const k of ["X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET", "X_HANDLE"]) delete process.env[k];

// Threads / Instagram / Facebook
process.env.THREADS_TOKEN = "th";
process.env.INSTAGRAM_TOKEN = "ig";
process.env.META_PAGE_TOKEN = "pg";
process.env.META_PAGE_ID = "123";
const { threads, instagram, facebook } = await import(at("lib/server/sites/meta.ts"));
stub((u) => {
  if (u.endsWith("/me/threads")) return { id: "c1" };
  if (u.includes("/c1?fields=status")) return { status: "FINISHED" };
  if (u.endsWith("/me/threads_publish")) return { id: "t1" };
  if (u.includes("/t1?fields=permalink")) return { permalink: "https://www.threads.net/@cardflipio/post/abc" };
  return { status: 500, body: { error: `unexpected ${u}` } };
});
out = await threads.post(POST);
check("threads: VIDEO container straight from the Blob url (no parking), then publish", [calls.length, new URLSearchParams(calls[0].body).get("media_type"), new URLSearchParams(calls[0].body).get("video_url"), out.uri], [4, "VIDEO", VIDEO.url, "https://www.threads.net/@cardflipio/post/abc"]);
stub((u) => {
  if (u.endsWith("/me/media")) return { id: "c2" };
  if (u.includes("/c2?fields=status_code")) return { status_code: "FINISHED" };
  if (u.endsWith("/me/media_publish")) return { id: "p2" };
  if (u.includes("/p2?fields=permalink")) return { permalink: "https://www.instagram.com/reel/xyz/" };
  return { status: 500, body: { error: `unexpected ${u}` } };
});
out = await instagram.post(POST);
const igBody = new URLSearchParams(calls[0].body);
check("instagram: REELS container from the Blob url, shared to feed", [igBody.get("media_type"), igBody.get("video_url"), igBody.get("share_to_feed"), igBody.get("caption"), out.uri], ["REELS", VIDEO.url, "true", POST.text, "https://www.instagram.com/reel/xyz/"]);
stub((u) => {
  if (u.includes("/me/accounts")) return { data: [{ id: "123", access_token: "page-token" }] };
  if (u.endsWith("/123/videos")) return { id: "v9" };
  return { status: 500, body: { error: `unexpected ${u}` } };
});
out = await facebook.post(POST);
const fbBody = new URLSearchParams(calls.at(-1).body);
check("facebook: Page /videos with file_url + description", [fbBody.get("file_url"), fbBody.get("description"), fbBody.get("access_token"), out.uri], [VIDEO.url, POST.text, "page-token", "https://www.facebook.com/123/videos/v9"]);
for (const k of ["THREADS_TOKEN", "INSTAGRAM_TOKEN", "META_PAGE_TOKEN", "META_PAGE_ID"]) delete process.env[k];
globalThis.fetch = realFetch;

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall green");
