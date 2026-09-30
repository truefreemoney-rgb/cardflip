// Morning-slot video (09-25, Chris: "i would really like to see a
// prototype"; 09-26: "pick cards that are the biggest movers and shakers" —
// switched from the set spotlight to the week's movers, ranked No.5 → No.1
// by % gain, same quality rules the movers post uses). No footage: drawn as
// a 1080x1920 HTML scene, stepped one frame at a time by headless Chromium
// (render(t) is pure: every frame is a function of time, so the output is
// deterministic), then stitched to an H.264 MP4 by ffmpeg.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-next-stubs.mjs scripts/social-video.mjs [--day YYYY-MM-DD] [--out path.mp4] [--fps 24]
//     [--audio path|none] [--register] [--skip-if-done]
//
// --register: the GitHub Actions 7am job (social-post.yml, video job). Parks
// the MP4 on Vercel Blob (social/video/<game>-<kind>-<day>.mp4) and writes
// the settings row the publisher reads (lib/socialVideo.ts videoKey), so
// the morning post goes out as video on every site that takes one. The
// EXACT cards drawn are frozen into that row too (`cards`), so the
// publisher builds the post text from them instead of a fresh computation
// — text and video can no longer disagree (09-26: a caption once said
// "Mysterious Treasures" over Base Set 2 art because each was computed at
// a different moment).
// --skip-if-done: exit 0 without rendering when that row already exists
// (the schedule pings twice, EDT and EST).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const FPS = Number(arg("--fps", 24));
const OUT = path.resolve(arg("--out", "social-video.mp4"));
const REGISTER = has("--register");

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { topMovers, mixedMovers, recentlyFeatured, variantLabel } = await import(at("lib/server/social.ts"));
const { dayPlan, POST_GAME_NAMES, POST_GAME_ORDER } = await import(at("lib/socialPlan.ts"));
const { fallbackArtUrl } = await import(at("lib/cardArt.ts"));
const { TIMELINE, VIDEO_W: W, VIDEO_H: H, videoKey, videoSeconds } = await import(at("lib/socialVideo.ts"));
const { eastern, SLOTS, VIDEO_SLOT } = await import(at("lib/server/socialPublish.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));

// Same day the publisher keys on (Eastern), so a 6:30am ET render lands on the right row.
const day = arg("--day", eastern().day);
const game = "pokemon";
// The kind rendered here follows the video slot's mapping (VIDEO_SLOT +
// SLOTS in socialPublish.ts; 1pm since 09-27), so a re-mapping does not
// silently orphan this script or the row the publisher looks for.
const KIND = SLOTS[VIDEO_SLOT].kind;
const KEY = videoKey(game, KIND, day);
if (has("--skip-if-done") && (await getSetting(KEY))) { console.log(`video already registered for ${day}, nothing to do`); process.exit(0); }

// Backing track: royalty-free MP3s Chris drops into public/social/audio
// (Pixabay Content License, no attribution needed; see the README there).
// One is picked per day, rotating through the folder by name; none = silent.
// --audio <mp3> forces one, --audio none forces silent. Trimmed to the video,
// fade-out at the end. (A synthesized loop was tried 09-25: "i hate the audio".)
const AUDIO_DIR = path.join(root, "public/social/audio");
const tracks = fs.existsSync(AUDIO_DIR) ? fs.readdirSync(AUDIO_DIR).filter((f) => /\.mp3$/i.test(f)).sort() : [];
const dayIndex = Math.round(Date.parse(day) / 86_400_000);
const AUDIO = arg("--audio", tracks.length ? path.join(AUDIO_DIR, tracks[dayIndex % tracks.length]) : "none");
const withAudio = AUDIO !== "none" && fs.existsSync(AUDIO);
if (AUDIO !== "none" && !withAudio) console.warn(`no backing track at ${AUDIO}, rendering silent`);
console.log(withAudio ? `audio: ${path.basename(AUDIO)} (${tracks.length} in rotation)` : "audio: silent (drop MP3s into public/social/audio)");

// Same pipeline the 1pm movers post used to use for the morning slot
// (topMovers gainers only, same MOVER_MIN_PRICE/HELD_DAYS quality floors,
// same no-repeat exclusion) so the video never shows a junk mover and never
// repeats a card the movers post already featured this week.
// A day plan (lib/socialPlan.ts, Chris 09-30: "a video that mixes both magic
// and pokemon … the last content on the video should mention the other game
// types") swaps in mixedMovers: each game's top three, alternating, every
// card labelled with its game and its rank inside that game, and an outro
// that names every game the scanner reads. The registry key stays the
// Pokémon one (KEY above), so the publisher and the 12:40 safety net find it.
const MIXED = Boolean(dayPlan(day).mixedMovers);
const movers = MIXED ? await mixedMovers(day) : await topMovers(game, day, { direction: "up", exclude: await recentlyFeatured(game, "movers", day) });
if (movers.length < 3) { console.error("not enough movers for", day); process.exit(1); }
console.log(`movers: ${movers.length} cards${MIXED ? " (mixed)" : ""}, first ${movers[0].name} +${movers[0].pct.toFixed(1)}%`);

async function artDataUri(url) {
  const grab = async (u) => {
    try {
      // Scryfall refuses Node's default User-Agent (400 generic_user_agent): every Magic card drew blank without a name.
      const r = await fetch(u, { headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "image/*" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return { bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "image/png" };
    } catch { return null; }
  };
  const a = (await grab(url)) ?? (fallbackArtUrl(url) ? await grab(fallbackArtUrl(url)) : null);
  return a ? `data:${a.type};base64,${a.bytes.toString("base64")}` : "";
}
// Countdown: smallest gain first, the week's biggest mover last (No. 1). A
// mixed list is ranked inside each game (P1, M1, P2, M2, … reversed ends on
// a No. 1), so the label says the game: "Magic · No. 2".
const inGame = new Map();
const ranked = movers.map((c) => {
  const g = c.game ?? game;
  inGame.set(g, (inGame.get(g) ?? 0) + 1);
  return { ...c, rankLabel: MIXED ? `${POST_GAME_NAMES[g]} · No. ${inGame.get(g)}` : "" };
});
const cards = [];
for (const c of [...ranked].reverse()) cards.push({ ...c, art: await artDataUri(c.imageUrl) });
if (MIXED && cards.some((c) => !c.art)) { console.error("card art missing:", cards.filter((c) => !c.art).map((c) => c.name).join(", ")); process.exit(1); }
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "public/brand/cardflip-logo.png")).toString("base64")}`;

// Timeline (seconds): intro → one beat per card → outro (lib/socialVideo.ts
// defaults). With a track, the cut follows the music (Chris 09-25: "make the
// video somewhat match the feel of the beat"): scripts/lib/beat.mjs finds the
// tempo, the downbeat and where the track gets going; every card then holds
// for one bar (4 beats), the intro is one bar, card changes land on
// downbeats, the price pops on beat 3, and the art pulses on every beat.
let { intro: INTRO, beat: BEAT, outro: OUTRO } = TIMELINE;
let PERIOD = 0, AUDIO_START = 0;
if (withAudio) {
  const { analyzeBeat } = await import("./lib/beat.mjs");
  const b = await analyzeBeat(AUDIO, { clipSeconds: 18 });
  PERIOD = b.period;
  const bar = 4 * PERIOD;
  const oneBar = bar < 1.5 ? 2 * bar : bar > 2.9 ? bar / 2 : bar;
  // Two bars per card (Chris 09-26: "flipping through the cards so fast, the
  // user barely has time to read anything, make it slower"): ~5.2s a card
  // with the 92.5 bpm track, ~31s for five. Intro and outro stay one bar.
  BEAT = 2 * oneBar;
  INTRO = oneBar;
  // The mixed outro names five games one per beat, then the address: two bars.
  OUTRO = (MIXED ? 2 : 1) * oneBar + 0.6;
  AUDIO_START = b.start;
  console.log(`beat: ${b.bpm} bpm, ${BEAT.toFixed(2)}s per card, audio from ${AUDIO_START.toFixed(2)}s`);
} else if (MIXED) {
  OUTRO = 5;
}
const TOTAL = withAudio || MIXED ? Math.round((INTRO + BEAT * cards.length + OUTRO) * 1000) / 1000 : videoSeconds(cards.length);
const mixedGames = POST_GAME_ORDER.filter((g) => movers.some((m) => (m.game ?? game) === g)).map((g) => POST_GAME_NAMES[g]);
// Satori-style glyph gaps: the Ubuntu runner may have no ★ (Scryfall's foil-only numbers).
const numberText = (n) => String(n).replace(/\s*[☆★]\s*/g, " Star ").trim();

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  * { margin:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#0a0b11; }
  body { font-family:"Geist", system-ui, sans-serif; color:#fff; position:relative;
    background: radial-gradient(60% 45% at 50% 0%, rgba(99,102,241,.38), transparent 70%),
                radial-gradient(45% 40% at 100% 100%, rgba(240,171,252,.18), transparent 70%), #0a0b11; }
  .display { font-family:"Bricolage Grotesque", "Geist", sans-serif; font-weight:800; letter-spacing:-0.025em; }
  .muted { color:rgba(255,255,255,.62); }
  .abs { position:absolute; left:0; top:0; width:100%; height:100%; }
  .holo { background:linear-gradient(90deg,#7dd3fc,#a78bfa,#f0abfc,#fcd34d); }
  .holo-text { background:linear-gradient(90deg,#7dd3fc,#a78bfa,#f0abfc,#fcd34d); -webkit-background-clip:text; color:transparent; }
  #intro { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 90px; text-align:center; }
  #intro .kicker { font-size:38px; font-weight:600; color:#a5b4fc; text-transform:uppercase; letter-spacing:.18em; }
  #intro .title { font-size:132px; line-height:1; margin-top:28px; }
  #intro .sub { font-size:42px; margin-top:36px; }
  .beat { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:150px 80px 0; }
  .beat .rank { font-size:40px; font-weight:600; color:#a5b4fc; letter-spacing:.14em; text-transform:uppercase; }
  .beat .art { width:720px; height:1000px; border-radius:36px; object-fit:cover; margin-top:34px;
    box-shadow:0 40px 120px rgba(0,0,0,.6), 0 0 0 2px rgba(255,255,255,.12); background:#1c1d27; }
  .beat .name { font-size:72px; line-height:1.05; margin-top:52px; text-align:center; }
  .beat .name.long { font-size:58px; }
  .beat .meta { font-size:36px; margin-top:12px; }
  .beat .price { font-size:164px; line-height:1; margin-top:22px; font-variant-numeric:tabular-nums; padding:0 20px;
    background:linear-gradient(100deg,#22c55e 0%,#4ade80 30%,#d9f99d 48%,#4ade80 66%,#16a34a 100%); background-size:260% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent;
    filter:drop-shadow(0 0 18px rgba(74,222,128,.45)); }
  .beat .pct { font-size:40px; font-weight:600; margin-top:18px; }
  .up { color:#4ade80; } .down { color:#f87171; }
  #outro { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 90px; text-align:center; }
  #outro img { width:560px; }
  #outro .line { font-size:56px; margin-top:60px; line-height:1.2; }
  #outro .url { font-size:64px; font-weight:700; margin-top:40px; }
  #outro .now { font-size:40px; font-weight:600; color:#a5b4fc; letter-spacing:.18em; text-transform:uppercase; margin-top:64px; }
  #outro .games { display:flex; flex-direction:column; align-items:center; gap:18px; margin-top:30px; }
  #outro .games .g { font-size:88px; line-height:1.05; }
  #outro .tag { font-size:44px; margin-top:52px; }
  #footer { position:absolute; left:0; right:0; bottom:110px; display:flex; align-items:center; justify-content:center; gap:18px; font-size:34px; }
  #footer .dot { width:22px; height:22px; border-radius:999px; background:#6366f1; }
  #bar { position:absolute; left:80px; right:80px; bottom:70px; height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden; }
  #bar i { display:block; height:100%; width:0; }
</style></head><body>
<div id="intro" class="abs">
  <div class="kicker">${MIXED ? esc(mixedGames.join(" + ")) : "Pokémon · movers of the week"}</div>
  <div class="title display holo-text">Biggest movers</div>
  <div class="sub muted">${MIXED ? `This week's top ${Math.ceil(cards.length / Math.max(1, mixedGames.length)) === 3 ? "three" : Math.ceil(cards.length / Math.max(1, mixedGames.length))} gainers in each game` : `This week's top gainers, No. ${cards.length} to No. 1`}</div>
</div>
${cards.map((c, i) => `
<div class="abs beat" id="beat${i}">
  <div class="rank">${MIXED ? esc(c.rankLabel) : `No. ${cards.length - i}`}</div>
  ${c.art ? `<img class="art" src="${c.art}">` : `<div class="art"></div>`}
  <div class="name display${c.name.length > 22 ? " long" : ""}">${esc(c.name)}</div>
  <div class="meta muted">${MIXED ? `${esc(c.setName)} · ` : ""}#${esc(numberText(c.number))}${variantLabel(c.variant) ? ` · ${esc(variantLabel(c.variant))}` : ""}</div>
  <div class="price display" data-to="${c.to}">$0</div>
  <div class="pct ${c.unsettled ? "muted" : Math.abs(c.pct) < 1 ? "muted" : c.pct > 0 ? "up" : "down"}">${c.unsettled ? "" : Math.abs(c.pct) < 1 ? "steady this week" : `${c.pct > 0 ? "▲" : "▼"} ${Math.abs(c.pct).toFixed(1)}% this week`}</div>
</div>`).join("")}
${MIXED ? `<div id="outro" class="abs">
  <img src="${logo}">
  <div class="now">Now scanning</div>
  <div class="games">${POST_GAME_ORDER.map((g) => `<div class="g display">${esc(POST_GAME_NAMES[g])}</div>`).join("")}</div>
  <div class="tag muted">Scan a card. See what it's worth.</div>
  <div class="url display holo-text">cardflip.io</div>
</div>` : `<div id="outro" class="abs">
  <img src="${logo}">
  <div class="line muted">Scan a card.<br>See what it's worth.<br>List it on eBay.</div>
  <div class="url display holo-text">cardflip.io</div>
</div>`}
<div id="footer"><span class="dot"></span><span style="font-weight:600">CardFlip</span><span class="muted">cardflip.io</span></div>
<div id="bar"><i class="holo"></i></div>
<script>
  const INTRO=${INTRO}, BEAT=${BEAT}, OUTRO=${OUTRO}, N=${cards.length}, TOTAL=${TOTAL};
  // P = one musical beat (a quarter of a card's hold); with no track it is the same fraction, so the cut feels alike.
  const P=${PERIOD > 0 ? PERIOD : BEAT / 4}, MUSIC=${withAudio ? "true" : "false"};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const easeOut=(x)=>1-Math.pow(1-x,3);
  const easeInOut=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const money=(n)=>n>=100?"$"+Math.round(n).toLocaleString("en-US"):"$"+n.toFixed(2);
  function fadeIn(el, t, d=.45, dy=40){ const p=easeOut(clamp(t/d)); el.style.opacity=p; el.style.transform="translateY("+((1-p)*dy)+"px)"; }
  function show(el, on){ el.style.display = on ? "" : "none"; }
  window.render = function(t){
    // Beat pulse: a quick swell on every beat (t=0 is a downbeat; the audio is cut to start on one).
    const pulse = MUSIC ? Math.exp(-((t % P)/P)*7) : 0;
    const bar=document.querySelector("#bar i");
    bar.style.width=(clamp(t/TOTAL)*100)+"%";
    bar.style.filter="brightness("+(1+.6*pulse)+")";
    const dot=document.querySelector("#footer .dot");
    dot.style.transform="scale("+(1+.5*pulse)+")";
    dot.style.boxShadow="0 0 "+(24*pulse)+"px rgba(99,102,241,"+(.9*pulse)+")";
    const intro=document.getElementById("intro"), outro=document.getElementById("outro");
    // intro
    show(intro, t<INTRO);
    if(t<INTRO){
      const out = clamp((t-(INTRO-.3))/.3);
      intro.style.opacity = 1-out;
      fadeIn(intro.querySelector(".kicker"), t, .4);
      fadeIn(intro.querySelector(".title"), t-P*.5, .6, 60);
      fadeIn(intro.querySelector(".sub"), t-P*1.5, .5);
      intro.querySelector(".title").style.transform += " scale("+(1+.04*easeOut(clamp(t/INTRO))+.02*pulse)+")";
    }
    for(let i=0;i<N;i++){
      const el=document.getElementById("beat"+i);
      const s=INTRO+i*BEAT, lt=t-s;
      const on = lt>=0 && lt<BEAT;
      show(el,on);
      if(!on) continue;
      // Beat 0: art slams in. Beat 1: name. Beats 1→3: price counts up, pops on beat 3. Then the week's move.
      const out = clamp((lt-(BEAT-.2))/.2);
      el.style.opacity = 1-out;
      fadeIn(el.querySelector(".rank"), lt, .3);
      const art=el.querySelector(".art"); const ap=easeOut(clamp(lt/Math.min(.55,P)));
      art.style.opacity=ap; art.style.transform="translateY("+((1-ap)*120)+"px) rotate("+((1-ap)*-6)+"deg) scale("+(0.92+.08*ap+.015*pulse*ap)+")";
      fadeIn(el.querySelector(".name"), lt-P*.8, .35);
      fadeIn(el.querySelector(".meta"), lt-P*.95, .35);
      const price=el.querySelector(".price"); const to=Number(price.dataset.to);
      const pp=easeInOut(clamp((lt-P)/(2*P)));
      price.style.opacity=clamp((lt-P*.9)/.15);
      price.textContent=money(to*pp);
      // Pop on beat 3: scale, glow flare, and a shine sweeping left→right across the green number.
      const pop = lt>=3*P ? Math.exp(-(lt-3*P)*9) : 0;
      const sweep = lt>=3*P ? clamp((lt-3*P)/(P*1.2)) : 0;
      price.style.transform="scale("+(1+.12*pop)+")";
      price.style.backgroundPosition=((1-sweep)*100)+"% 0";
      price.style.filter="drop-shadow(0 0 "+(18+40*pop)+"px rgba(74,222,128,"+(.45+.5*pop)+")) brightness("+(1+.35*pop)+")";
      fadeIn(el.querySelector(".pct"), lt-3*P, .3, 20);
    }
    const ot=t-(INTRO+N*BEAT);
    show(outro, ot>=0);
    if(ot>=0 && outro.querySelector(".games")){
      // Mixed outro: logo, then one game name per beat, then the address.
      fadeIn(outro.querySelector("img"), ot, .4, 30);
      fadeIn(outro.querySelector(".now"), ot-P*.5, .35, 20);
      outro.querySelectorAll(".games .g").forEach((g, i) => {
        const gt = ot-P*(1+i);
        fadeIn(g, gt, .3, 30);
        const pop = gt>=0 ? Math.exp(-gt*9) : 0;
        g.style.transform += " scale("+(1+.14*pop)+")";
      });
      fadeIn(outro.querySelector(".tag"), ot-P*6, .4);
      fadeIn(outro.querySelector(".url"), ot-P*6.5, .45);
    } else if(ot>=0){
      fadeIn(outro.querySelector("img"), ot, .5, 30);
      fadeIn(outro.querySelector(".line"), ot-.3, .5);
      fadeIn(outro.querySelector(".url"), ot-.7, .5);
    }
  };
</script></body></html>`;

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), "cardflip-video-"));
fs.writeFileSync(path.join(work, "scene.html"), html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`file://${path.join(work, "scene.html").replace(/\\/g, "/")}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const frames = Math.round(TOTAL * FPS);
console.log(`rendering ${frames} frames at ${FPS}fps (${TOTAL.toFixed(1)}s)`);
for (let i = 0; i < frames; i++) {
  await page.evaluate((t) => window.render(t), i / FPS);
  await page.screenshot({ path: path.join(work, `f${String(i).padStart(4, "0")}.png`), type: "png" });
  if (i % 48 === 0) process.stdout.write(`  ${i}/${frames}\n`);
}
await browser.close();

const ffmpeg = (await import("ffmpeg-static")).default;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const r = spawnSync(ffmpeg, [
  "-y", "-framerate", String(FPS), "-i", path.join(work, "f%04d.png"),
  ...(withAudio ? ["-ss", AUDIO_START.toFixed(3), "-i", AUDIO, "-af", `afade=t=in:d=0.15,afade=t=out:st=${(TOTAL - 0.6).toFixed(2)}:d=0.6`, "-c:a", "aac", "-b:a", "128k", "-shortest"] : []),
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "medium", "-movflags", "+faststart", OUT,
], { stdio: ["ignore", "ignore", "pipe"] });
if (r.status !== 0) { console.error(r.stderr.toString().slice(-2000)); process.exit(1); }
fs.rmSync(work, { recursive: true, force: true });
const bytes = fs.statSync(OUT).size;
console.log(`wrote ${OUT} (${(bytes / 1e6).toFixed(1)} MB, ${TOTAL.toFixed(1)}s)`);

if (REGISTER) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) { console.error("--register needs BLOB_READ_WRITE_TOKEN"); process.exit(1); }
  const { put, del } = await import("@vercel/blob");
  const blob = await put(`social/video/${game}-${KIND}-${day}.mp4`, fs.readFileSync(OUT), { access: "public", addRandomSuffix: false, contentType: "video/mp4", allowOverwrite: true });
  // A re-render on the same day replaces the row; the old file only differs by path when the naming changes.
  const prev = await getSetting(KEY);
  if (prev) { try { const p = JSON.parse(prev); if (p.url && p.url !== blob.url) await del(p.url); } catch { /* old row, ignore */ } }
  // Freeze the exact cards drawn (name/number/set/variant/from/to/pct) so
  // the publisher builds the post text from THIS list, never a fresh one
  // computed at post time — that gap is what let the text and video
  // disagree on 09-26.
  const specCards = movers.map((c) => ({ cardId: c.cardId, name: c.name, number: c.number, setName: c.setName, variant: c.variant, from: c.from, to: c.to, pct: c.pct, ...(c.game ? { game: c.game } : {}) }));
  await setSetting(KEY, JSON.stringify({ url: blob.url, bytes, mime: "video/mp4", width: W, height: H, seconds: TOTAL, renderedAt: Date.now(), kind: KIND, cards: specCards }));
  console.log(`registered ${KEY} → ${blob.url}`);
}
