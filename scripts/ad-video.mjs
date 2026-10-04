// The CardFlip ads (10-04, after Chris rejected v1/v2: "make it make sense and
// flow together properly ... put in real features"). Three cuts of ONE story
// from his real iPhone screen recording of a Samurott scan, storyboarded first
// (memory feedback-ad-video-quality) and run side by side in one TikTok ad
// group so TikTok rotates them:
//
//   --cut A  The walkthrough (~21 s): question → capture → Found → the price
//            lifts off the footage → "Yes, this is my card" → condition and
//            price history → the listing, ending on Publish → five real
//            features with crops of the real UI.
//   --cut B  The reveal (~15 s): full-bleed footage, giant type, opens at the
//            climax ($52.64 slams in over the Found flash), rewinds to the
//            four-second scan, lands on the listing, closes on the dimmed
//            listing with the logo.
//   --cut C  Got cards to sell? (~18 s): text block on top, phone running off
//            the bottom, opens on the FINISHED listing, the scan as the
//            explanation, condition, the written listing, Publish, the binder.
//
// A 1080x1920 HTML scene stepped frame by frame by headless Chromium and
// stitched by ffmpeg (scripts/lib/social-scene.mjs renderMp4). Every phone
// screen is a frame of the recording: slices are cut with ffmpeg, the iOS
// status bar cropped off (y 124), app slices 1600 tall so the Publish button
// (y 1615-1705 in the recording) stays in frame, scanner slices padded 64 px
// black to the same height. Nothing is mocked.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-next-stubs.mjs scripts/ad-video.mjs \
//     --footage chris.mp4 --cut A [--out x.mp4] [--fps 24] [--silent]
//
// Music (Pixabay Content License, public/social/audio): A cinematic-soul
// 511436, B hip-hop promo 226369 (122.5 bpm, groove from 10.4 s), C pop
// upbeat 425328. One track per cut so the three never feel like one ad.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { esc, renderMp4 } from "./lib/social-scene.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const CUT = String(arg("--cut", "A")).toUpperCase();
if (!"ABC".includes(CUT) || CUT.length !== 1) throw new Error(`--cut must be A, B or C (got ${CUT})`);
const OUT = arg("--out", path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads", `cardflip-ad-${new Date().toISOString().slice(0, 10)}-${CUT}.mp4`));
const FPS = Number(arg("--fps", 24));
const FOOTAGE = arg("--footage", "");
if (!FOOTAGE || !fs.existsSync(FOOTAGE)) throw new Error(`--footage <mp4> is required (got ${FOOTAGE || "nothing"})`);
const W = 1080, H = 1920;

/** The recording's content box: the iOS status bar (124 px) cropped off; scanner frames end at 1660, app frames run to 1724 (Publish button). */
const SRC_W = 886;
const CROPS = {
  scan: "crop=886:1536:0:124,pad=886:1600:0:0:black", // scanner (Safari bar from 1680 stays out)
  app: "crop=886:1600:0:124", // the CardFlip app pages (Safari collapsed)
};
const FRAME_H = 1600;
const PHONE_W = 720, PHONE_H = Math.round((PHONE_W * FRAME_H) / SRC_W); // 720 x 1300
const BLEED_W = 1080;

/**
 * One scene = one slice of the recording + what is drawn over it.
 *   from/len  seconds of the recording; speed plays it faster/slower;
 *   dur       = len / speed, the scene's screen time (closing scenes have no slice)
 *   look      phone | bleed | top (C: text block on top, phone lower)
 *   head/sub  the headline; headAt = scene second the head switches to head2
 */
const CUTS = {
  A: {
    audio: { file: "cinematic-soul-upbeat-success-happy-corporate-music-511436.mp3", start: 0.0 },
    scenes: [
      { key: "open", crop: "scan", from: 4.3, len: 3.0, speed: 1, look: "phone", head: "What's this card worth?", intro: true },
      { key: "cap", crop: "scan", from: 7.3, len: 2.1, speed: 1, look: "phone", head: "What's this card worth?", sub: "Tap Capture.", cont: true },
      { key: "found", crop: "scan", from: 9.4, len: 1.8, speed: 1, look: "phone", head: "Found.", sub: "Samurott · White Flare 107/086 · Holofoil", cont: true },
      { key: "price", crop: "scan", from: 10.0, len: 1.8, speed: 0.7, look: "phone", head: "Live market price.", sub: "Not a guess. Today's price.", cont: true, pricePop: true },
      { key: "mine", crop: "app", from: 27.2, len: 4.2, speed: 1.5, look: "phone", head: "Your card. Your photo.", sub: "“Yes, this is my card.”", priceLand: true },
      { key: "chart", crop: "app", from: 31.4, len: 4.6, speed: 1.4, look: "phone", head: "Condition from the photo.", sub: "Price history, 90 days.", cont: true },
      { key: "list", crop: "app", from: 36.0, len: 4.2, speed: 1.3, look: "phone", head: "Sell it in one tap.", sub: "Listing written. Photo included.", cont: true, publish: true },
      { key: "close", dur: 6.0, look: "closeA" },
    ],
  },
  B: {
    audio: { file: "moodmode-hip-hop-promo-226369.mp3", start: 10.4 },
    scenes: [
      { key: "slam", crop: "scan", from: 9.4, len: 2.2, speed: 1, look: "bleed", head: "This card is worth", slam: "$52.64" },
      { key: "rewind", crop: "scan", from: 4.3, len: 2.0, speed: 1, look: "bleed", head: "Took <em>four seconds</em> to find out.", whip: true },
      { key: "tap", crop: "scan", from: 6.3, len: 3.0, speed: 1, look: "bleed", head: "Point. <em>Tap.</em>", foot: "Reading the card…", footSub: "the app does the rest", cont: true },
      { key: "exact", crop: "scan", from: 9.3, len: 2.4, speed: 1, look: "bleed", head: "Exact card. <em>Exact printing.</em>", foot: "Live market price", footSub: "Samurott · White Flare 107/086 · Holofoil", cont: true },
      { key: "ebay", crop: "app", from: 36.4, len: 3.8, speed: 1.5, look: "bleed", bleedY: -700, head: "One tap later<br>it's <em>on eBay.</em>", foot: "Photo included.", footSub: "title, description and price written for you", publish: true },
      { key: "close", crop: "app", from: 40.0, len: 0.6, speed: 0.2, look: "closeB", bleedY: -700 },
    ],
  },
  C: {
    audio: { file: "tatamusic-pop-upbeat-pop-425328.mp3", start: 0.0 },
    scenes: [
      { key: "hook", crop: "app", from: 39.2, len: 1.0, speed: 0.34, look: "top", head: "Got cards to sell?", sub: "This eBay listing took <em>one tap.</em>", tag: "LIVE ON EBAY", intro: true },
      { key: "scan", crop: "scan", from: 4.3, len: 6.8, speed: 2, look: "top", head: "Here's the tap.", sub: "Point your camera at the card." },
      { key: "graded", crop: "app", from: 29.8, len: 4.0, speed: 1.3, look: "top", head: "Graded by the photo.", sub: "Near Mint. Corners, edges, surface checked. <em>$52.64</em> market, live." },
      { key: "written", crop: "app", from: 35.4, len: 3.6, speed: 1.2, look: "top", head: "Listing written for you.", sub: "Title, description, price, photo. <em>You just press Publish.</em>", cont: true },
      { key: "publish", crop: "app", from: 39.0, len: 1.2, speed: 0.5, look: "top", head: "Publish.", sub: "Live on your eBay account in seconds.", cont: true, publish: true, phoneTop: 520 },
      { key: "binder", crop: "app", from: 25.0, len: 1.5, speed: 0.5, look: "top", head: "Your whole binder, priced.", sub: "Every card. Live market prices. Sell any of them in one tap.", url: true, phoneTop: 840 },
    ],
  },
};
const cut = CUTS[CUT];
for (const s of cut.scenes) s.dur = s.dur ?? s.len / s.speed;
const FADE = 0.35; // crossfade between scenes
let acc = 0;
for (const s of cut.scenes) { s.start = acc; acc += s.dur; }
const TOTAL = Math.round(acc * FPS) / FPS;

// Cut every slice to JPEG frames: the phone cuts at 720 wide, the full-bleed cuts at 1080.
const ffmpeg = (await import("ffmpeg-static")).default;
const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "cardflip-ad-frames-"));
const frames = {};
for (const s of cut.scenes) {
  if (!s.crop) continue;
  const w = s.look === "bleed" || s.look === "closeB" ? BLEED_W : PHONE_W;
  const vf = `${CROPS[s.crop]},setpts=PTS/${s.speed},scale=${w}:-2,fps=${FPS}`;
  const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", s.from.toFixed(3), "-t", s.len.toFixed(3), "-i", FOOTAGE, "-vf", vf, "-q:v", "3", path.join(framesDir, `${s.key}-%04d.jpg`)]);
  if (r.status !== 0) throw new Error(`ffmpeg cut ${s.key}: ${r.stderr.toString().slice(-400)}`);
  frames[s.key] = fs.readdirSync(framesDir).filter((f) => f.startsWith(`${s.key}-`)).sort();
  if (!frames[s.key].length) throw new Error(`no frames for ${s.key}`);
  console.log(`  ${s.key}: ${frames[s.key].length} frames, ${s.from}s +${s.len}s at ${s.speed}x → ${s.dur.toFixed(1)}s`);
}
// Stills for the A closing rows (real UI crops): the moment, in seconds of the recording.
const stills = {};
if (CUT === "A") {
  for (const [k, at] of Object.entries({ verified: 32.0, chart: 34.2, publish: 39.6, pills: 10.2, ledger: 25.3 })) {
    const crop = k === "pills" ? CROPS.scan : CROPS.app;
    const out = path.join(framesDir, `still-${k}.jpg`);
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", at.toFixed(3), "-i", FOOTAGE, "-frames:v", "1", "-vf", crop, "-q:v", "2", out]);
    if (r.status !== 0) throw new Error(`ffmpeg still ${k}: ${r.stderr.toString().slice(-400)}`);
    stills[k] = out;
  }
}
const fileUrl = (f) => `file://${f.replace(/\\/g, "/")}`;
const frameUrl = (f) => fileUrl(path.join(framesDir, f));
const logo = "data:image/png;base64," + fs.readFileSync(new URL("../public/brand/cardflip-logo.png", import.meta.url)).toString("base64");

const framesHtml = (s) => frames[s.key].map((f, i) => `<img class="ff" data-i="${i}" src="${frameUrl(f)}" style="display:${i === 0 ? "block" : "none"}">`).join("");

function sceneHtml(s) {
  const head = s.head ? `<div class="head display"><span class="h1">${s.head}</span>${s.sub ? `<small>${s.sub}</small>` : ""}</div>` : "";
  switch (s.look) {
    case "phone":
      return `<div class="scene phone-look" id="${s.key}">${head}
        <div class="phone"><div class="screen">${framesHtml(s)}</div></div>
        ${s.publish ? `<div class="pulse"></div>` : ""}</div>`;
    case "bleed":
      return `<div class="scene b" id="${s.key}">
        <div class="bleedwrap" style="top:${s.bleedY ?? -120}px">${framesHtml(s)}</div><div class="shade"></div>
        <div class="big display">${s.head}</div>
        ${s.slam ? `<div class="slam display">${s.slam}</div>` : ""}
        ${s.foot ? `<div class="bottom display">${s.foot}<small>${s.footSub ?? ""}</small></div>` : ""}
        ${s.publish ? `<div class="pulse" style="left:100px; width:880px; top:${Math.round(1491 * (BLEED_W / SRC_W) + (s.bleedY ?? -120)) - 8}px; height:120px; border-radius:70px"></div>` : ""}</div>`;
    case "closeB":
      return `<div class="scene b" id="${s.key}">
        <div class="bleedwrap dim" style="top:${s.bleedY ?? -120}px">${framesHtml(s)}</div><div class="shade deep"></div>
        <img class="logo" src="${logo}" alt="CardFlip">
        <div class="big display center">Live on eBay.<br>From one scan.</div>
        <div class="bottom display center">cardflip.io<small>Pokémon · Magic · Lorcana · One Piece · Yu-Gi-Oh!<br>Free to try. Works in your browser.</small></div></div>`;
    case "top":
      return `<div class="scene c" id="${s.key}">
        <div class="top display"><span class="h1">${s.head}</span><small>${s.sub ?? ""}</small></div>
        ${s.tag ? `<div class="tag">${s.tag}</div>` : ""}
        ${s.url ? `<div class="top display url"><span class="h1">cardflip.io</span><small>Free trial · works in your browser</small></div>` : ""}
        <div class="phone" style="top:${s.phoneTop ?? 640}px"><div class="screen">${framesHtml(s)}</div></div>
        ${s.publish ? `<div class="pulse" style="top:${(s.phoneTop ?? 640) + 1215}px"></div>` : ""}</div>`;
    case "closeA": {
      const row = (k, txt, sub, style) => `<div class="row"><div class="crop"><img src="${fileUrl(stills[k])}" style="${style}"></div><div class="txt">${txt}<span>${sub}</span></div></div>`;
      return `<div class="scene" id="${s.key}">
        <img class="logo" src="${logo}" alt="CardFlip">
        <div class="close-h display">Scan it. Price it. Sell it.</div>
        <div class="rows">
          ${row("verified", "Exact printing and condition", "read from your camera", "width:400px; left:-10px; top:-316px")}
          ${row("chart", "Live market price", "with 90 days of history", "width:301px; left:40px; top:-270px")}
          ${row("publish", "One tap to a live eBay listing", "photo and description filled in", "width:460px; left:-40px; top:-722px")}
          ${row("pills", "Five games, one scanner", "Pokémon · Magic · Lorcana · One Piece · Yu-Gi-Oh!", "width:381px; left:0; top:-533px")}
          ${row("ledger", "Your binder's value, always current", "every card, every price, live", "width:381px; left:0; top:-101px")}
        </div>
        <div class="url display">cardflip.io<small>Free trial · works in your browser</small></div></div>`;
    }
    default:
      throw new Error(`look ${s.look}`);
  }
}

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { box-sizing:border-box; margin:0; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#07080d; }
  body { font-family:"Geist", system-ui, sans-serif; color:#fff; position:relative; }
  .display { font-family:"Bricolage Grotesque", "Geist", sans-serif; font-weight:800; letter-spacing:-0.025em; }
  .scene { position:absolute; left:0; top:0; width:100%; height:100%; display:none; overflow:hidden; background:
     radial-gradient(900px 600px at 50% -10%, rgba(124,58,237,.35), transparent 60%),
     radial-gradient(700px 500px at 50% 110%, rgba(56,189,248,.18), transparent 60%), #07080d; }
  em { font-style:normal; }
  .head { position:absolute; left:70px; right:70px; top:120px; font-size:92px; line-height:1.02; }
  .head small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:40px; color:#b4b9cc; margin-top:22px; letter-spacing:0; line-height:1.3; }
  .phone { position:absolute; left:166px; top:420px; width:748px; height:1328px; border-radius:62px; background:#0b0d13; border:2px solid rgba(255,255,255,.16); padding:14px; box-shadow:0 60px 120px rgba(0,0,0,.6); transform-origin:left top; }
  .phone .screen { width:${PHONE_W}px; height:${PHONE_H}px; border-radius:48px; overflow:hidden; background:#000; }
  .phone .screen img { width:${PHONE_W}px; height:${PHONE_H}px; display:block; }
  .pulse { position:absolute; left:166px; top:1635px; width:748px; height:94px; border-radius:60px; opacity:0; box-shadow:0 0 0 10px rgba(14,165,233,.35), 0 0 60px rgba(14,165,233,.6); pointer-events:none; }
  .flyprice { position:absolute; left:0; top:0; display:none; font-family:"Bricolage Grotesque", sans-serif; font-weight:800; line-height:1; letter-spacing:-0.03em; color:#4ade80; filter:drop-shadow(0 0 28px rgba(74,222,128,.45)); font-variant-numeric:tabular-nums; transform-origin:left top; white-space:nowrap; z-index:50; }
  .logo { position:absolute; left:50%; top:110px; transform:translateX(-50%); width:520px; }
  .close-h { position:absolute; left:70px; right:70px; top:330px; text-align:center; font-size:84px; line-height:1.02; }
  .rows { position:absolute; left:70px; right:70px; top:500px; display:flex; flex-direction:column; gap:22px; }
  .row { display:flex; align-items:center; gap:30px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:30px; padding:16px; height:184px; }
  .row .crop { width:380px; height:150px; border-radius:20px; overflow:hidden; position:relative; flex:none; background:#13141c; }
  .row .crop img { position:absolute; display:block; }
  .row .txt { font-size:40px; line-height:1.18; font-weight:600; }
  .row .txt span { display:block; font-weight:400; font-size:30px; color:#b4b9cc; margin-top:8px; }
  .url { position:absolute; left:0; right:0; bottom:96px; text-align:center; font-size:110px; letter-spacing:-0.03em; }
  .url small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:38px; color:#b4b9cc; letter-spacing:0; margin-top:12px; }

  /* B */
  .b .bleedwrap { position:absolute; left:0; width:${BLEED_W}px; transform-origin:center center; }
  .b .bleedwrap img { width:${BLEED_W}px; display:block; }
  .b .bleedwrap.dim { filter:brightness(.55); }
  .b .shade { position:absolute; inset:0; background:linear-gradient(180deg, rgba(7,8,13,.85) 0%, rgba(7,8,13,.1) 35%, rgba(7,8,13,.1) 65%, rgba(7,8,13,.9) 100%); }
  .b .shade.deep { background:linear-gradient(180deg, rgba(7,8,13,.92) 0%, rgba(7,8,13,.35) 45%, rgba(7,8,13,.35) 70%, rgba(7,8,13,.95) 100%); }
  .b .big { position:absolute; left:60px; right:60px; top:150px; font-size:128px; line-height:.98; letter-spacing:-0.035em; text-shadow:0 10px 40px rgba(0,0,0,.6); }
  .b .big em { color:#c4b5fd; }
  .b .big.center { top:330px; text-align:center; font-size:112px; }
  .b .slam { position:absolute; left:0; right:0; top:800px; text-align:center; font-size:300px; line-height:1; letter-spacing:-0.05em; color:#fff; -webkit-text-stroke:3px #a78bfa; text-shadow:0 0 80px rgba(167,139,250,.8); font-variant-numeric:tabular-nums; transform-origin:center center; }
  .b .bottom { position:absolute; left:60px; right:60px; bottom:150px; font-size:96px; line-height:1; letter-spacing:-0.03em; text-shadow:0 10px 40px rgba(0,0,0,.6); }
  .b .bottom.center { text-align:center; bottom:130px; }
  .b .bottom small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:40px; color:#d6d9e4; margin-top:18px; letter-spacing:0; line-height:1.3; }
  .b .logo { top:150px; width:560px; }
  .b .whip { position:absolute; inset:0; background:#fff; opacity:0; }

  /* C */
  .c { background: radial-gradient(900px 700px at 50% 0%, rgba(14,165,233,.28), transparent 60%), #07080d; }
  .c .top { position:absolute; left:70px; right:70px; top:140px; font-size:104px; line-height:1; letter-spacing:-0.03em; }
  .c .top small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:42px; color:#b4b9cc; margin-top:26px; letter-spacing:0; line-height:1.3; }
  .c .top em { color:#7dd3fc; }
  .c .top.url { top:500px; bottom:auto; text-align:left; font-size:120px; color:#7dd3fc; }
  .c .top.url small { color:#fff; }
  .c .tag { position:absolute; left:70px; top:520px; background:#0ea5e9; color:#fff; font-weight:700; font-size:36px; padding:16px 30px; border-radius:99px; transform-origin:left center; }
</style></head><body>
${cut.scenes.map(sceneHtml).join("\n")}
<div class="flyprice" id="flyprice">$52.64</div>
<div class="whip" id="whip" style="position:absolute; inset:0; background:#fff; opacity:0; display:none; z-index:60"></div>
<script>
  const CUT=${JSON.stringify(CUT)}, FPS=${FPS}, FADE=${FADE}, TOTAL=${TOTAL};
  const SCENES=${JSON.stringify(cut.scenes.map((s) => ({ key: s.key, start: s.start, dur: s.dur, look: s.look, intro: !!s.intro, cont: !!s.cont, pricePop: !!s.pricePop, priceLand: !!s.priceLand, publish: !!s.publish, slam: !!s.slam, whip: !!s.whip, tag: !!s.tag, url: !!s.url, speed: s.speed ?? 1, nframes: s.crop ? 1 : 0 })))};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const easeOut=(x)=>1-Math.pow(1-x,3);
  const easeInOut=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const back=(x)=>{ const c=1.70158, d=c+1; return 1+d*Math.pow(x-1,3)+c*Math.pow(x-1,2); };
  const pop=(b)=> b>=0 ? Math.exp(-b*7) : 0;
  const $=(s,r=document)=>r.querySelector(s);
  function fadeIn(el, t, d=.6, dy=30){ if(!el) return; const p=easeOut(clamp(t/d)); el.style.opacity=p; el.style.transform="translateY("+((1-p)*dy)+"px)"; }
  const el={}; for (const s of SCENES) el[s.key]=document.getElementById(s.key);
  window.__ready = Promise.all([...document.querySelectorAll("img")].map((i) => i.decode().catch(() => {})));
  const fly=$("#flyprice"), whip=$("#whip");

  // Where the $52.64 sits on the scanner's green bar inside the phone screen (frame coords 886x1600 → screen 720x1300 → page).
  const BAR = { x: 166+14+762*(${PHONE_W}/${SRC_W}), y: 420+14+1232*(${PHONE_W}/${SRC_W}), size: 30 };

  window.render = function(t){
    fly.style.display="none"; whip.style.display="none";
    for (let i=0;i<SCENES.length;i++) {
      const s=SCENES[i], lt=t-s.start, root=el[s.key];
      const last = i===SCENES.length-1;
      const on = lt>=0 && (last || lt < s.dur + FADE);
      root.style.display = on ? "block" : "none";
      if (!on) continue;
      // Crossfade: each scene fades in over FADE; the one before stays under it until then.
      root.style.opacity = s.cont ? 1 : easeOut(clamp(lt/FADE));
      if (last) root.style.opacity = easeOut(clamp(lt/FADE));
      // Footage frame for this moment.
      const imgs=root.querySelectorAll("img.ff");
      if (imgs.length) { const idx=Math.min(imgs.length-1, Math.max(0, Math.floor(lt*FPS))); imgs.forEach((im,j)=>{ im.style.display = j===idx ? "block" : "none"; }); }
      // Headline: fades in fresh unless the scene continues the previous one with the same words.
      const head = $(".head, .big, .top:not(.url)", root);
      if (head && s.look!=="closeB") { if (s.cont && head.dataset.same==="1") { head.style.opacity=1; head.style.transform=""; } else fadeIn(head, lt, .6, 30); }
      const sub = head && head.querySelector("small"); if (sub && !s.cont) fadeIn(sub, lt-.35, .6, 20);
      const foot = $(".bottom", root); if (foot && s.look!=="closeB") fadeIn(foot, lt-.5, .6, 24);
      // The phone eases in on the first scene only; after that it never moves.
      const ph = $(".phone", root);
      if (ph) {
        if (s.intro) { const ap=easeOut(clamp(lt/.8)); ph.style.opacity=ap; ph.style.transform="translateY("+((1-ap)*120)+"px) scale("+(0.95+.05*ap)+")"; }
        else if (s.pricePop) { const p=easeInOut(clamp((lt-.2)/.9)); ph.style.transform="translate("+(-120*p)+"px, "+(50*p)+"px) scale("+(1-.18*p)+")"; }
        else { ph.style.opacity=1; ph.style.transform=""; }
      }
      // A: the price lifts off the green bar, grows beside the phone, then shrinks and dissolves into the card page.
      if (s.pricePop) {
        const p=easeInOut(clamp((lt-.2)/.9));
        const x = BAR.x + (548-BAR.x)*p, y = BAR.y + (1020-BAR.y)*p, size = BAR.size + (118-BAR.size)*p;
        fly.style.display="block"; fly.style.left=x+"px"; fly.style.top=y+"px"; fly.style.fontSize=size+"px"; fly.style.opacity=1;
        fly.style.transform="scale("+(1+.08*pop(lt-1.1))+")";
      }
      if (s.priceLand) {
        const p=easeInOut(clamp(lt/.8));
        if (p<1) { fly.style.display="block"; fly.style.left=(548+(640-548)*p)+"px"; fly.style.top=(1020+(1500-1020)*p)+"px"; fly.style.fontSize=(118-(118-34)*p)+"px"; fly.style.opacity=1-p; }
      }
      // Publish: the button glows in the last second of the scene.
      const pulse=$(".pulse", root); if (pulse) pulse.style.opacity = clamp((lt-(s.dur-1.1))/.4) * (0.75+.25*Math.sin(t*9));
      // B: the number slams in; the rewind whips.
      if (s.slam) { const sl=$(".slam", root); const p=clamp((lt-.25)/.45); sl.style.opacity=p>0?1:0; sl.style.transform="rotate(-6deg) scale("+(p<1 ? 3-2*back(p) : 1+.03*Math.sin(t*6))+")"; }
      if (s.whip && lt<.25) { whip.style.display="block"; whip.style.opacity=.9*(1-lt/.25); }
      if (s.look==="bleed" || s.look==="closeB") { const bw=$(".bleedwrap", root); bw.style.transform="scale("+(1+.04*clamp(lt/s.dur))+")"; }
      if (s.look==="closeB") { fadeIn($(".logo",root), lt, .7, 30); fadeIn($(".big",root), lt-.4, .7, 30); fadeIn($(".bottom",root), lt-.9, .7, 24); }
      // C: the tag pops; the url block on the last scene.
      if (s.tag) { const tg=$(".tag", root); const p=clamp((lt-.7)/.4); tg.style.opacity=p; tg.style.transform="scale("+(p<1?back(p):1)+")"; }
      if (s.url) { fadeIn($(".top.url", root), lt-.8, .7, 30); }
      // A closing: rows slide in one by one.
      if (s.look==="closeA") {
        fadeIn($(".logo",root), lt, .7, 30); fadeIn($(".close-h",root), lt-.4, .7, 30);
        root.querySelectorAll(".row").forEach((r,j)=>fadeIn(r, lt-1.0-j*.35, .5, 40));
        const u=$(".url",root); fadeIn(u, lt-3.0, .7, 30);
      }
    }
  };
  // Scenes that keep the previous headline word for word do not re-animate it.
  (function(){ let prev=null; for (const s of SCENES) { const h=$(".head, .big, .top:not(.url)", el[s.key]); const txt=h? h.querySelector(".h1")?.textContent ?? h.textContent : ""; if (h && s.cont && prev===txt) h.dataset.same="1"; prev=txt; } })();
</script></body></html>`;

const audio = has("--silent") ? null : { file: path.resolve("public/social/audio", cut.audio.file), start: cut.audio.start };
if (audio && !fs.existsSync(audio.file)) throw new Error(`audio missing: ${audio.file}`);
console.log(`cut ${CUT}: rendering ${TOTAL.toFixed(1)}s → ${OUT}`);
const bytes = await renderMp4({ html, W, H, fps: FPS, total: TOTAL, out: OUT, audio });
fs.rmSync(framesDir, { recursive: true, force: true });
console.log(`wrote ${OUT} (${(bytes / 1e6).toFixed(1)} MB)`);
