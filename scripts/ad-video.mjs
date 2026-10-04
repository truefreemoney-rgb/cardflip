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
//   --cut B  The reveal (~15 s): giant type, opens at the climax ($52.64 slams
//            in over the Found flash), rewinds to the four-second scan, lands
//            on the listing, closes on the dimmed listing with the logo.
//   --cut C  Got cards to sell? (~18 s): opens on the FINISHED listing, the
//            scan as the explanation, condition, the written listing,
//            Publish, the binder.
//
// v3 (10-04, the v2 renders rejected in the TikTok preview, "nothing fits, it
// is a mess"): the phone mock sat in the bottom third, exactly where TikTok
// lays its identity line, caption, CTA and nav, and the right rail covered
// x>910. ONE LAYOUT FOR ALL CUTS now: the footage full-bleed at 1080 wide
// (886 → 1950 tall, scale 1.219) slid to a per-scene bleedY (optionally
// tilting to toY), the headline band y 120-400 on a top shade, everything
// else inside TikTok's safe box y 230..1436, x 60..910 (social-scene.mjs).
// --sheet writes one PNG per scene with the TikTok overlay zones in red and a
// contact sheet; Chris okays the sheet BEFORE anything is rendered.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-next-stubs.mjs scripts/ad-video.mjs \
//     --footage chris.mp4 --cut A [--out x.mp4] [--fps 24] [--silent] [--sheet]
//
// Music (Pixabay Content License, public/social/audio): A cinematic-soul
// 511436, B hip-hop promo 226369 (122.5 bpm, groove from 10.4 s), C pop
// upbeat 425328. One track per cut so the three never feel like one ad.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { renderMp4 } from "./lib/social-scene.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const CUT = String(arg("--cut", "A")).toUpperCase();
if (!"ABC".includes(CUT) || CUT.length !== 1) throw new Error(`--cut must be A, B or C (got ${CUT})`);
const SHEET = has("--sheet");
const DL = path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads");
const OUT = arg("--out", path.join(DL, `cardflip-ad-${new Date().toISOString().slice(0, 10)}-${CUT}${SHEET ? "-sheet.png" : ".mp4"}`));
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
/** TikTok's in-feed overlays (social-scene.mjs line 86, confirmed in the ads preview): EVERYTHING stays inside. */
const SAFE = { x0: 60, x1: 910, y0: 230, y1: 1436 };
/** The footage window: headline 230..470 above it, the window 490..1436, x 60..910. Frames are cut 850 wide (1535 tall). */
const WIN = { x: SAFE.x0, y: 490, w: SAFE.x1 - SAFE.x0, h: SAFE.y1 - 490 };
const K = WIN.w / SRC_W; // 0.959

/**
 * One scene = one slice of the recording + what is drawn over it.
 *   from/len  seconds of the recording; speed plays it faster/slower;
 *   dur       = len / speed, the scene's screen time (closing scenes have no slice)
 *   y/toY     where the 1535-tall frame sits inside the window (window y = frame y + y);
 *             toY tilts there from scene second tiltAt over tiltDur
 *   head/sub  the headline (A, C); B: head = the big type, foot/footSub under it
 * Frame landmarks (850 wide): scan guide 181-881, match panel 984-1236, green bar
 * 1149-1216, capture 1340+; app Publish button 1430-1511 (y -585 ends the window on it).
 */
const CUTS = {
  A: {
    audio: { file: "cinematic-soul-upbeat-success-happy-corporate-music-511436.mp3", start: 0.0 },
    scenes: [
      { key: "open", crop: "scan", from: 4.3, len: 3.0, speed: 1, y: -150, head: "What's this card worth?", intro: true },
      { key: "cap", crop: "scan", from: 7.3, len: 2.1, speed: 1, y: -150, head: "What's this card worth?", sub: "Point. Tap Capture.", cont: true },
      { key: "found", crop: "scan", from: 9.4, len: 1.8, speed: 1, y: -150, toY: -300, head: "Found.", sub: "Samurott · White Flare 107/086 · Holofoil", cont: true },
      { key: "price", crop: "scan", from: 10.0, len: 1.8, speed: 0.7, y: -300, head: "Live market price.", sub: "Not a guess. Today's price.", cont: true, pricePop: true },
      { key: "mine", crop: "app", from: 27.2, len: 4.2, speed: 1.5, y: -300, head: "Your card. Your photo.", sub: "“Yes, this is my card.”", priceLand: true },
      { key: "chart", crop: "app", from: 31.4, len: 4.6, speed: 1.4, y: -300, head: "Condition from the photo.", sub: "Price history, 90 days.", cont: true },
      { key: "list", crop: "app", from: 36.0, len: 4.2, speed: 1.3, y: -300, toY: -585, tiltDur: 1.2, head: "Sell it in one tap.", sub: "Listing written. Photo included.", cont: true, publish: true },
      { key: "close", dur: 6.0, look: "closeA" },
    ],
  },
  B: {
    audio: { file: "moodmode-hip-hop-promo-226369.mp3", start: 10.4 },
    scenes: [
      { key: "slam", crop: "scan", from: 9.4, len: 2.2, speed: 1, y: -300, head: "This card is worth", slam: "$52.64" },
      { key: "rewind", crop: "scan", from: 4.3, len: 2.0, speed: 1, y: -150, head: "Took <em>four seconds</em> to find out.", whip: true },
      { key: "tap", crop: "scan", from: 6.3, len: 3.0, speed: 1, y: -150, head: "Point. <em>Tap.</em>", foot: "Reading the card…", footSub: "the app does the rest", cont: true },
      { key: "exact", crop: "scan", from: 9.3, len: 2.4, speed: 1, y: -300, head: "Exact card. <em>Exact printing.</em>", foot: "Live market price", footSub: "Samurott · White Flare 107/086 · Holofoil", cont: true },
      { key: "ebay", crop: "app", from: 36.4, len: 3.8, speed: 1.5, y: -585, head: "One tap later it's <em>on eBay.</em>", foot: "Photo included.", footSub: "title, description and price written for you", publish: true },
      { key: "close", crop: "app", from: 40.0, len: 0.6, speed: 0.2, y: -585, look: "closeB" },
    ],
  },
  C: {
    audio: { file: "tatamusic-pop-upbeat-pop-425328.mp3", start: 0.0 },
    scenes: [
      { key: "hook", crop: "app", from: 39.2, len: 1.0, speed: 0.34, y: -585, head: "Got cards to sell?", sub: "This eBay listing took <em>one tap.</em>", tag: "LIVE ON EBAY", intro: true },
      { key: "scan", crop: "scan", from: 4.3, len: 6.8, speed: 2, y: -150, toY: -300, tiltAt: 2.5, head: "Here's the tap.", sub: "Point your camera at the card." },
      { key: "graded", crop: "app", from: 29.8, len: 4.0, speed: 1.3, y: -300, head: "Graded by the photo.", sub: "Near Mint. Corners, edges, surface checked. <em>$52.64</em> market, live." },
      { key: "written", crop: "app", from: 35.4, len: 3.6, speed: 1.2, y: -300, toY: -585, tiltAt: 2.0, tiltDur: 1.0, head: "Listing written for you.", sub: "Title, description, price, photo. <em>You just press Publish.</em>", cont: true },
      { key: "publish", crop: "app", from: 39.0, len: 1.2, speed: 0.5, y: -585, head: "Publish.", sub: "Live on your eBay account in seconds.", cont: true, publish: true },
      { key: "binder", crop: "app", from: 25.0, len: 1.5, speed: 0.5, y: -240, head: "Your whole binder, priced.", sub: "Every card. Live market prices. Sell any of them in one tap.", url: true },
    ],
  },
};
const cut = CUTS[CUT];
for (const s of cut.scenes) { s.dur = s.dur ?? s.len / s.speed; s.look = s.look ?? "bleed"; }
const FADE = 0.35; // crossfade between scenes
let acc = 0;
for (const s of cut.scenes) { s.start = acc; acc += s.dur; }
const TOTAL = Math.round(acc * FPS) / FPS;

// Cut every slice to JPEG frames at the window width (850).
const ffmpeg = (await import("ffmpeg-static")).default;
const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "cardflip-ad-frames-"));
const frames = {};
for (const s of cut.scenes) {
  if (!s.crop) continue;
  const vf = `${CROPS[s.crop]},setpts=PTS/${s.speed},scale=${WIN.w}:-2,fps=${FPS}`;
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
/** The Publish button on the app frame (1430-1511) at the scene's final y, in page px. */
const publishTop = (s) => Math.round(WIN.y + 1430 + (s.toY ?? s.y)) - 10;

function sceneHtml(s) {
  // The blurred copy fills the frame around the window (TikTok's overlays sit on it); the window holds the sharp footage.
  const wrap = (dim) => `<div class="bgblur">${framesHtml(s)}</div><div class="win${dim ? " dim" : ""}"><div class="bleedwrap" style="top:${s.y}px">${framesHtml(s)}</div></div>`;
  switch (s.look) {
    case "bleed": {
      const words = CUT === "B"
        ? `<div class="big display">${s.head}</div>${s.foot ? `<div class="bottom display">${s.foot}<small>${s.footSub ?? ""}</small></div>` : ""}`
        : `<div class="head display"><span class="h1">${s.head}</span>${s.sub ? `<small>${s.sub}</small>` : ""}</div>`;
      return `<div class="scene v${CUT}" id="${s.key}">${wrap(false)}
        <div class="stack">${words}</div>
        ${s.url ? `<div class="urlc display">cardflip.io<small>Free trial · works in your browser</small></div>` : ""}
        ${s.slam ? `<div class="slam display">${s.slam}</div>` : ""}
        ${s.tag ? `<div class="tag">${s.tag}</div>` : ""}
        ${s.publish ? `<div class="pulse" style="top:${publishTop(s)}px"></div>` : ""}</div>`;
    }
    case "closeB":
      return `<div class="scene vB" id="${s.key}">${wrap(true)}
        <img class="logo" src="${logo}" alt="CardFlip">
        <div class="big display center">Live on eBay.<br>From one scan.</div>
        <div class="bottom display center">cardflip.io<small>Pokémon · Magic · Lorcana · One Piece · Yu-Gi-Oh!<br>Free to try. Works in your browser.</small></div></div>`;
    case "closeA": {
      const row = (k, txt, sub, style) => `<div class="row"><div class="crop"><img src="${fileUrl(stills[k])}" style="${style}"></div><div class="txt">${txt}<span>${sub}</span></div></div>`;
      return `<div class="scene" id="${s.key}">
        <img class="logo" src="${logo}" alt="CardFlip">
        <div class="close-h display">Scan it. Price it. Sell it.</div>
        <div class="rows">
          ${row("verified", "Exact printing and condition", "read from your camera", "width:340px; left:-30px; top:-276px")}
          ${row("chart", "Live market price", "with 90 days of history", "width:256px; left:16px; top:-238px")}
          ${row("publish", "One tap to a live eBay listing", "photo and description filled in", "width:390px; left:-45px; top:-622px")}
          ${row("pills", "Five games, one scanner", "Pokémon · Magic · Lorcana · One Piece · Yu-Gi-Oh!", "width:324px; left:-12px; top:-458px")}
          ${row("ledger", "Your binder's value, always current", "every card, every price, live", "width:324px; left:-12px; top:-82px")}
        </div>
        <div class="url display">cardflip.io<small>Free trial · works in your browser</small></div></div>`;
    }
    default:
      throw new Error(`look ${s.look}`);
  }
}

const RIGHT = W - SAFE.x1; // 170: the action rail
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

  /* The blurred, darkened copy of the footage fills the whole frame: TikTok's overlays sit on it, so nothing that matters does. */
  .bgblur { position:absolute; left:-90px; top:-60px; width:${W + 180}px; height:${H + 120}px; overflow:hidden; filter:blur(38px) brightness(.38) saturate(1.2); }
  .bgblur img { width:100%; height:100%; object-fit:cover; display:block; }
  /* The sharp footage lives in the window: y 490..1436, x 60..910, all inside the safe box. */
  .win { position:absolute; left:${WIN.x}px; top:${WIN.y}px; width:${WIN.w}px; height:${WIN.h}px; border-radius:30px; overflow:hidden; background:#000; border:2px solid rgba(255,255,255,.14); box-shadow:0 40px 90px rgba(0,0,0,.65); }
  .win.dim { filter:brightness(.22); }
  .bleedwrap { position:absolute; left:0; width:${WIN.w}px; height:${Math.round(1600 * K)}px; transform-origin:center center; }
  .bleedwrap img { width:${WIN.w}px; display:block; }

  /* The headline: y 230..470, x 70..910. */
  .stack { position:absolute; left:${SAFE.x0 + 10}px; right:${RIGHT}px; top:${SAFE.y0}px; height:${WIN.y - SAFE.y0 - 14}px; display:flex; flex-direction:column; justify-content:flex-end; gap:12px; }
  .head { font-size:70px; line-height:1.02; text-shadow:0 8px 30px rgba(0,0,0,.6); }
  .head small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:33px; color:#d6d9e4; margin-top:12px; letter-spacing:0; line-height:1.25; }
  .vC .head { font-size:68px; }
  .vC .head em { color:#7dd3fc; }
  .big { font-size:76px; line-height:.98; letter-spacing:-0.035em; text-shadow:0 10px 40px rgba(0,0,0,.6); }
  .big em { color:#c4b5fd; }
  .bottom { font-size:44px; line-height:1; letter-spacing:-0.03em; text-shadow:0 10px 40px rgba(0,0,0,.6); }
  .bottom small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:30px; color:#d6d9e4; margin-top:8px; letter-spacing:0; line-height:1.25; }

  .pulse { position:absolute; left:${WIN.x + 40}px; width:${WIN.w - 80}px; height:100px; border-radius:60px; opacity:0; box-shadow:0 0 0 8px rgba(14,165,233,.4), 0 0 50px rgba(14,165,233,.65); pointer-events:none; }
  .flyprice { position:absolute; left:0; top:0; display:none; font-family:"Bricolage Grotesque", sans-serif; font-weight:800; line-height:1; letter-spacing:-0.03em; color:#4ade80; filter:drop-shadow(0 0 28px rgba(74,222,128,.45)) drop-shadow(0 6px 18px rgba(0,0,0,.8)); font-variant-numeric:tabular-nums; transform-origin:left top; white-space:nowrap; z-index:50; }

  /* B */
  .slam { position:absolute; left:${SAFE.x0}px; right:${RIGHT}px; top:640px; text-align:center; font-size:230px; line-height:1; letter-spacing:-0.05em; color:#fff; -webkit-text-stroke:3px #a78bfa; text-shadow:0 0 80px rgba(167,139,250,.8); font-variant-numeric:tabular-nums; transform-origin:center center; }
  .big.center, .bottom.center { position:absolute; left:${SAFE.x0}px; right:${RIGHT}px; text-align:center; }
  .big.center { top:520px; font-size:96px; }
  .bottom.center { top:1080px; font-size:96px; }
  .bottom.center small { font-size:34px; }
  .vB .logo { top:300px; }
  .whip { position:absolute; inset:0; background:#fff; opacity:0; }

  /* C */
  .tag { position:absolute; left:${WIN.x + 24}px; top:${WIN.y + 24}px; background:#0ea5e9; color:#fff; font-weight:700; font-size:34px; padding:14px 28px; border-radius:99px; transform-origin:left center; box-shadow:0 10px 30px rgba(0,0,0,.5); }
  .urlc { position:absolute; left:${WIN.x + 2}px; width:${WIN.w - 4}px; top:${SAFE.y1 - 230}px; height:228px; padding:34px 36px 0; border-radius:0 0 28px 28px; background:linear-gradient(180deg, rgba(7,8,13,0), rgba(7,8,13,.92) 38%); font-size:104px; letter-spacing:-0.03em; color:#7dd3fc; }
  .urlc small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:36px; color:#fff; margin-top:8px; letter-spacing:0; }

  /* A close: logo 240, headline 360, five rows 440..1246, url 1262, all inside the safe box. */
  .logo { position:absolute; left:${(SAFE.x0 + SAFE.x1) / 2}px; top:240px; transform:translateX(-50%); width:440px; }
  .close-h { position:absolute; left:${SAFE.x0}px; right:${RIGHT}px; top:352px; text-align:center; font-size:58px; line-height:1.02; }
  .rows { position:absolute; left:${SAFE.x0}px; right:${RIGHT}px; top:440px; display:flex; flex-direction:column; gap:14px; }
  .row { display:flex; align-items:center; gap:24px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.1); border-radius:26px; padding:14px; height:150px; }
  .row .crop { width:300px; height:120px; border-radius:16px; overflow:hidden; position:relative; flex:none; background:#13141c; }
  .row .crop img { position:absolute; display:block; }
  .row .txt { font-size:33px; line-height:1.15; font-weight:600; }
  .row .txt span { display:block; font-weight:400; font-size:25px; color:#b4b9cc; margin-top:6px; }
  .url { position:absolute; left:${SAFE.x0}px; right:${RIGHT}px; top:1262px; text-align:center; font-size:100px; letter-spacing:-0.03em; }
  .url small { display:block; font-family:"Geist", sans-serif; font-weight:500; font-size:34px; color:#b4b9cc; letter-spacing:0; margin-top:8px; }
</style></head><body>
${cut.scenes.map(sceneHtml).join("\n")}
<div class="flyprice" id="flyprice">$52.64</div>
<div class="whip" id="whip" style="position:absolute; inset:0; background:#fff; opacity:0; display:none; z-index:60"></div>
<script>
  const CUT=${JSON.stringify(CUT)}, FPS=${FPS}, FADE=${FADE}, TOTAL=${TOTAL}, K=${K};
  const SCENES=${JSON.stringify(cut.scenes.map((s) => ({ key: s.key, start: s.start, dur: s.dur, look: s.look, y: s.y ?? 0, toY: s.toY ?? null, tiltAt: s.tiltAt ?? 0, tiltDur: s.tiltDur ?? 0.8, intro: !!s.intro, cont: !!s.cont, pricePop: !!s.pricePop, priceLand: !!s.priceLand, publish: !!s.publish, slam: !!s.slam, whip: !!s.whip, tag: !!s.tag, url: !!s.url })))};
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

  // The $52.64 on the scanner's green bar (frame x 762, y 1232 before scaling) and where it lands: under the headline.
  const barAt = (y) => ({ x: ${WIN.x} + 762*K, y: ${WIN.y} + 1232*K + y, size: 37*K });
  const LAND = { x: ${WIN.x + 30}, y: ${WIN.y + 30}, size: 130 };

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
      if (imgs.length) { const idx=Math.min(imgs.length-1, Math.max(0, Math.floor(lt*FPS))); imgs.forEach((im)=>{ im.style.display = +im.dataset.i===idx ? "block" : "none"; }); }
      // Footage position: y, tilting to toY. Scenes with nothing pinned to the footage creep in 3%.
      const bw=$(".bleedwrap", root);
      let y=s.y;
      if (bw) {
        if (s.toY!==null) y = s.y + (s.toY-s.y)*easeInOut(clamp((lt-s.tiltAt)/s.tiltDur));
        bw.style.top=y+"px";
        const pinned = s.pricePop || s.publish || s.slam;
        bw.style.transform = pinned ? "" : "scale("+(1+.03*clamp(lt/s.dur))+")";
        if (s.intro) bw.style.opacity = easeOut(clamp(lt/.6));
      }
      // Headline: fades in fresh unless the scene continues the previous one with the same words.
      const head = $(".head, .big:not(.center)", root);
      if (head) { if (s.cont && head.dataset.same==="1") { head.style.opacity=1; head.style.transform=""; } else fadeIn(head, lt, .6, 30); }
      const sub = head && head.querySelector("small"); if (sub && !(s.cont && head.dataset.same==="1")) fadeIn(sub, lt-.35, .6, 20);
      const foot = $(".bottom:not(.center)", root); if (foot) fadeIn(foot, lt-.5, .6, 24);
      // A: the price lifts off the green bar and lands under the headline, then dissolves into the card page.
      if (s.pricePop) {
        const p=easeInOut(clamp((lt-.2)/.9)), b=barAt(y);
        fly.style.display="block"; fly.style.left=(b.x+(LAND.x-b.x)*p)+"px"; fly.style.top=(b.y+(LAND.y-b.y)*p)+"px"; fly.style.fontSize=(b.size+(LAND.size-b.size)*p)+"px"; fly.style.opacity=1;
        fly.style.transform="scale("+(1+.08*pop(lt-1.1))+")";
      }
      if (s.priceLand) {
        const p=easeInOut(clamp(lt/.6));
        if (p<1) { fly.style.display="block"; fly.style.left=LAND.x+"px"; fly.style.top=(LAND.y+40*p)+"px"; fly.style.fontSize=(LAND.size*(1-.3*p))+"px"; fly.style.opacity=1-p; }
      }
      // Publish: the button glows in the last second of the scene.
      const pulse=$(".pulse", root); if (pulse) pulse.style.opacity = clamp((lt-(s.dur-1.1))/.4) * (0.75+.25*Math.sin(t*9));
      // B: the number slams in; the rewind whips.
      if (s.slam) { const sl=$(".slam", root); const p=clamp((lt-.25)/.45); sl.style.opacity=p>0?1:0; sl.style.transform="rotate(-6deg) scale("+(p<1 ? 3-2*back(p) : 1+.03*Math.sin(t*6))+")"; }
      if (s.whip && lt<.25) { whip.style.display="block"; whip.style.opacity=.9*(1-lt/.25); }
      if (s.look==="closeB") { fadeIn($(".logo",root), lt, .7, 30); fadeIn($(".big",root), lt-.4, .7, 30); fadeIn($(".bottom",root), lt-.9, .7, 24); }
      // C: the tag pops; the url block on the last scene.
      if (s.tag) { const tg=$(".tag", root); const p=clamp((lt-.7)/.4); tg.style.opacity=p; tg.style.transform="scale("+(p<1?back(p):1)+")"; }
      if (s.url) { fadeIn($(".urlc", root), lt-.8, .7, 30); }
      // A closing: rows slide in one by one.
      if (s.look==="closeA") {
        fadeIn($(".logo",root), lt, .7, 30); fadeIn($(".close-h",root), lt-.4, .7, 30);
        root.querySelectorAll(".row").forEach((r,j)=>fadeIn(r, lt-1.0-j*.35, .5, 40));
        fadeIn($(".url",root), lt-3.0, .7, 30);
      }
    }
  };
  // Scenes that keep the previous headline word for word do not re-animate it.
  (function(){ let prev=null; for (const s of SCENES) { const h=$(".head, .big:not(.center)", el[s.key]); const txt=h? h.querySelector(".h1")?.textContent ?? h.textContent : ""; if (h && s.cont && prev===txt) h.dataset.same="1"; prev=txt; } })();
</script></body></html>`;

if (SHEET) {
  // One PNG per scene, late in the scene (after its animations), with TikTok's overlays in red, then a contact sheet.
  const { chromium } = await import("playwright");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cardflip-ad-sheet-"));
  fs.writeFileSync(path.join(work, "scene.html"), html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(fileUrl(path.join(work, "scene.html")));
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => window.__ready ?? null);
  await page.waitForTimeout(300);
  await page.evaluate((S) => {
    const z = (css, label) => { const d = document.createElement("div"); d.style.cssText = "position:absolute; z-index:99; pointer-events:none; font:600 26px Geist,sans-serif; color:#fff; padding:6px 10px; " + css; d.textContent = label ?? ""; document.body.appendChild(d); };
    z(`left:0; top:${S.y1}px; width:100%; bottom:0; background:rgba(239,68,68,.38)`, "TikTok: identity · caption · CTA · nav");
    z(`left:${S.x1}px; top:760px; right:0; bottom:0; background:rgba(239,68,68,.38)`, "rail");
    z(`left:0; top:0; width:100%; height:110px; background:rgba(239,68,68,.38)`, "TikTok tabs");
    z(`left:${S.x0}px; top:${S.y0}px; width:${S.x1 - S.x0}px; height:${S.y1 - S.y0}px; outline:3px dashed rgba(74,222,128,.9)`);
  }, SAFE);
  const shots = [];
  for (const s of cut.scenes) {
    const at = s.start + (s.publish ? s.dur - 0.1 : 0) + (s.publish ? 0 : 1) * Math.min(s.dur - 0.05, Math.max(s.dur * 0.75, 1.6));
    await page.evaluate((t) => window.render(t), at);
    const f = path.join(work, `${s.key}.png`);
    await page.screenshot({ path: f, type: "png" });
    shots.push({ key: s.key, at, f });
  }
  const cols = 4, tw = 405, th = 720;
  const sheet = `<!doctype html><html><body style="margin:0; background:#111; font:600 22px system-ui; color:#ddd; padding:16px; width:${cols * (tw + 16) + 16}px">
    <div style="font-size:30px; margin:0 0 14px">Cut ${CUT} · ${TOTAL.toFixed(1)} s · red = TikTok covers it, green dashes = safe box</div>
    <div style="display:grid; grid-template-columns:repeat(${cols}, ${tw}px); gap:16px">
    ${shots.map((x, i) => `<div><img src="${fileUrl(x.f)}" style="width:${tw}px; height:${th}px; display:block"><div style="margin-top:6px">${i + 1}. ${x.key} · ${x.at.toFixed(1)} s</div></div>`).join("")}
    </div></body></html>`;
  fs.writeFileSync(path.join(work, "sheet.html"), sheet);
  await page.setViewportSize({ width: cols * (tw + 16) + 16, height: 400 });
  await page.goto(fileUrl(path.join(work, "sheet.html")));
  await page.waitForTimeout(300);
  await page.screenshot({ path: OUT, fullPage: true, type: "png" });
  await browser.close();
  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log(`wrote ${OUT} (scene PNGs in ${work})`);
} else {
  const audio = has("--silent") ? null : { file: path.resolve("public/social/audio", cut.audio.file), start: cut.audio.start };
  if (audio && !fs.existsSync(audio.file)) throw new Error(`audio missing: ${audio.file}`);
  console.log(`cut ${CUT}: rendering ${TOTAL.toFixed(1)}s → ${OUT}`);
  const bytes = await renderMp4({ html, W, H, fps: FPS, total: TOTAL, out: OUT, audio });
  fs.rmSync(framesDir, { recursive: true, force: true });
  console.log(`wrote ${OUT} (${(bytes / 1e6).toFixed(1)} MB)`);
}
