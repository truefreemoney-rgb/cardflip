// The CardFlip ad (Chris 10-04: "the video has to be more of an advertisement
// ... really sell the product and get the user curious and excited to visit
// our website and scan cards"). A 1080x1920 HTML scene stepped frame by
// frame by headless Chromium and stitched by ffmpeg, like the social videos
// (scripts/lib/social-scene.mjs renderMp4), but its own scene: a hook card
// with its price, the scanner at work, the verified card page, the one-tap
// eBay listing, the five games, and the call to action.
//
// Two ways to show the scanner:
//   --footage <mp4>   REAL footage: Chris's iPhone screen recording of a scan
//                     (10-04, via /admin/drop). Three slices are cut out of it
//                     (the scan, the verified card page, the listing page), the
//                     Safari chrome cropped off, and shown inside a phone frame.
//                     The home screen, the category typing and the ending are
//                     dropped. Edit SLICES below to re-cut.
//   (no footage)      a mock scanner drawn from live cards (the first version).
// The hook card and the "live" prices are fetched from cardflip.io's own
// search at render time, so the ad can never show a number the site would not.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-next-stubs.mjs scripts/ad-video.mjs \
//     [--footage chris.mp4] [--out x.mp4] [--fps 24] [--silent]
//
// Audio: public/social/audio/moodmode-hip-hop-promo-226369.mp3 (Pixabay Content
// License, Chris picked it 10-03), 122.5 bpm, the groove from 10.4 s; the
// cut is a whole number of beats and every pop lands on one.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { artDataUri, esc, renderMp4 } from "./lib/social-scene.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const has = (k) => process.argv.includes(k);
const OUT = arg("--out", path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", "Downloads", `cardflip-ad-${new Date().toISOString().slice(0, 10)}.mp4`));
const FPS = Number(arg("--fps", 24));
const FOOTAGE = arg("--footage", "");
const W = 1080, H = 1920;
const ORIGIN = arg("--origin", "https://cardflip.io");

/** The cards the ad reads, by the site's own ids: the hook, the first scan, then one per game (mock mode). */
const PICKS = {
  hook: { id: "swsh7-215", game: "pokemon" }, // Umbreon VMAX alt art, Evolving Skies: the card everyone has heard of
  scan: { id: "base1-4", game: "pokemon" }, // Charizard, Base Set 4/102
  fast: [
    { id: "ygo-21792-1st", game: "yugioh" }, // Blue-Eyes White Dragon, LOB-001 1st Edition
    { id: "crd_be9f1031cbc84de7a5a4a388a036857a", game: "lorcana" }, // Elsa - Ice Maker, Challenge promo
    { id: "OP01-120_p1", game: "onepiece" }, // Shanks, Romance Dawn parallel
  ],
};
const GAME_NAME = { pokemon: "Pokémon", mtg: "Magic", yugioh: "Yu-Gi-Oh", onepiece: "One Piece", lorcana: "Lorcana" };

/**
 * The slices of the screen recording (seconds into the file) and what the
 * headline says over each. `switchAt` = the footage second the headline
 * changes (the scan: "Point your camera." until the card is found).
 */
const SLICES = [
  { key: "scan", from: 4.8, beats: 10, head: "Point your camera.", head2: "Get the price.", switchAt: 9.0 },
  { key: "card", from: 30.5, beats: 4, head: "Every price is live." },
  { key: "ebay", from: 38.0, beats: 6, head: "Sell it in one tap." },
];
/** The phone's content box in the recording: the iOS status bar (124 px) and Safari's bars (from 1660) cropped off. */
const CROP = { w: 886, h: 1536, x: 0, y: 124 };
const FRAME_W = 720;

async function card(p) {
  const r = await fetch(`${ORIGIN}/api/search-card?id=${encodeURIComponent(p.id)}&game=${p.game}`, { headers: { "User-Agent": "CardFlip ad render" } });
  if (!r.ok) throw new Error(`${p.id}: search ${r.status}`);
  const c = (await r.json()).cards?.[0];
  if (!c) throw new Error(`${p.id}: not found`);
  const usd = (c.prices ?? []).find((x) => x.currency === "USD" && typeof x.market === "number");
  if (!usd) throw new Error(`${p.id}: no USD market price`);
  const art = await artDataUri(c.imageLarge || c.imageSmall);
  if (!art) throw new Error(`${p.id}: art did not load`);
  const name = String(c.name).replace(/ - .*$/, "");
  return { id: c.id, game: p.game, name, set: c.setName, number: c.number, price: usd.market, art, label: usd.label ?? "Market price" };
}

const money = (n) => (n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2));

console.log("fetching the cards from", ORIGIN);
const hook = await card(PICKS.hook);
const scan = FOOTAGE ? null : await card(PICKS.scan);
const fast = [];
if (!FOOTAGE) for (const p of PICKS.fast) fast.push(await card(p));
for (const c of [hook, scan, ...fast].filter(Boolean)) console.log(`  ${GAME_NAME[c.game]}: ${c.name} · ${c.set} · ${c.number} = ${money(c.price)}`);
const logo = "data:image/png;base64," + fs.readFileSync(new URL("../public/brand/cardflip-logo.png", import.meta.url)).toString("base64");

// Timing in BEATS of the track (122.5 bpm). Mock: hook 5, scan 8, fast 10, ebay 7, cta 10. Footage: hook 5, the slices, games 4, cta 11.
const BPM = 122.5, P = 60 / BPM;
const SEC = FOOTAGE
  ? { hook: 5, ...Object.fromEntries(SLICES.map((s) => [s.key, s.beats])), games: 4, cta: 11 }
  : { hook: 5, scan: 8, fast: 10, ebay: 7, cta: 10 };
const ORDER = Object.keys(SEC);
const T0 = {};
let acc = 0;
for (const k of ORDER) { T0[k] = acc; acc += SEC[k]; }
const TOTAL_BEATS = acc;
const TOTAL = TOTAL_BEATS * P;

// Footage frames: each slice cut to its beat count, cropped, 24 fps JPEGs the scene shows one per frame.
let framesDir = null;
const frames = {};
if (FOOTAGE) {
  if (!fs.existsSync(FOOTAGE)) throw new Error(`footage missing: ${FOOTAGE}`);
  const ffmpeg = (await import("ffmpeg-static")).default;
  framesDir = fs.mkdtempSync(path.join(os.tmpdir(), "cardflip-ad-frames-"));
  for (const s of SLICES) {
    const dur = s.beats * P;
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", s.from.toFixed(3), "-t", dur.toFixed(3), "-i", FOOTAGE, "-vf", `crop=${CROP.w}:${CROP.h}:${CROP.x}:${CROP.y},scale=${FRAME_W}:-2,fps=${FPS}`, "-q:v", "3", path.join(framesDir, `${s.key}-%04d.jpg`)]);
    if (r.status !== 0) throw new Error(`ffmpeg cut ${s.key}: ${r.stderr.toString().slice(-400)}`);
    frames[s.key] = fs.readdirSync(framesDir).filter((f) => f.startsWith(`${s.key}-`)).sort();
    console.log(`  footage ${s.key}: ${frames[s.key].length} frames from ${s.from}s (${dur.toFixed(1)}s)`);
  }
}
const frameUrl = (f) => `file://${path.join(framesDir, f).replace(/\\/g, "/")}`;
const FRAME_H = Math.round((FRAME_W * CROP.h) / CROP.w);

const phoneFootage = (s) => `<div class="abs scr real-scr" id="${s.key}">
  <div class="headline display${s.key === "scan" ? "" : " sm"}"><span class="h1">${esc(s.head)}</span>${s.head2 ? `<span class="h2" style="display:none">${esc(s.head2)}</span>` : ""}</div>
  <div class="phone real"><div class="glow"></div><div class="screen">
    ${frames[s.key].map((f, i) => `<img class="ff" data-i="${i}" src="${frameUrl(f)}" style="display:${i === 0 ? "block" : "none"}">`).join("")}
  </div></div>
</div>`;

const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&family=Geist:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  * { margin:0; box-sizing:border-box; }
  html, body { width:${W}px; height:${H}px; overflow:hidden; background:#07080d; }
  body { font-family:"Geist", system-ui, sans-serif; color:#fff; position:relative;
    background: radial-gradient(70% 50% at 50% 0%, rgba(99,102,241,.42), transparent 70%),
                radial-gradient(50% 40% at 100% 100%, rgba(240,171,252,.2), transparent 70%), #07080d; }
  .display { font-family:"Bricolage Grotesque", "Geist", sans-serif; font-weight:800; letter-spacing:-0.025em; }
  .abs { position:absolute; left:0; top:0; width:100%; height:100%; }
  .scr { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:240px 110px 340px; text-align:center; }
  .muted { color:rgba(255,255,255,.66); }
  .holo-text { background:linear-gradient(90deg,#7dd3fc,#a78bfa,#f0abfc,#fcd34d); -webkit-background-clip:text; background-clip:text; color:transparent; }
  .green { background:linear-gradient(100deg,#22c55e 0%,#4ade80 30%,#d9f99d 48%,#4ade80 66%,#16a34a 100%); background-size:260% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 0 18px rgba(74,222,128,.45)); }
  .kicker { font-size:36px; font-weight:600; color:#a5b4fc; text-transform:uppercase; letter-spacing:.18em; }
  .title { font-size:96px; line-height:1.02; margin-top:18px; }
  .sub { font-size:40px; margin-top:22px; line-height:1.3; }
  .cardwrap { position:relative; width:620px; height:866px; border-radius:30px; overflow:hidden; background:#1c1d27;
    box-shadow:0 50px 140px rgba(0,0,0,.65), 0 0 0 2px rgba(255,255,255,.14); }
  .cardwrap img { width:100%; height:100%; object-fit:cover; display:block; }
  .shine { position:absolute; inset:0; mix-blend-mode:screen; opacity:.55; pointer-events:none;
    background:linear-gradient(115deg, transparent 30%, rgba(125,211,252,.35) 42%, rgba(240,171,252,.55) 50%, rgba(252,211,77,.35) 58%, transparent 70%); background-size:250% 250%; }
  #hook .price { font-size:184px; line-height:1; margin-top:30px; font-variant-numeric:tabular-nums; }
  #hook .who { font-size:40px; margin-top:14px; }
  .phone { position:relative; width:640px; border-radius:62px; border:2px solid rgba(255,255,255,.16); background:#0b0d13; padding:14px;
    box-shadow:0 60px 160px rgba(0,0,0,.7); }
  .phone .glow { position:absolute; inset:-120px -90px; z-index:-1;
    background:radial-gradient(ellipse at 50% 45%, rgba(167,139,250,.5), rgba(125,211,252,.25) 38%, rgba(240,171,252,.12) 56%, transparent 72%); }
  .screen { border-radius:50px; background:rgba(0,0,0,.72); overflow:hidden; padding:26px 26px 30px; }
  .scr.real-scr { padding:190px 60px 290px; }
  .real-scr .headline { font-size:80px; margin-bottom:34px; }
  .real-scr .headline.sm { font-size:68px; }
  .phone.real { width:${FRAME_W + 28}px; border-radius:54px; }
  .phone.real .screen { border-radius:42px; }
  .phone.real .screen { padding:0; width:${FRAME_W}px; height:${FRAME_H}px; background:#000; }
  .phone.real .screen img { width:${FRAME_W}px; height:${FRAME_H}px; display:block; }
  .bar { display:flex; justify-content:space-between; align-items:center; font-size:24px; color:#a1a1aa; padding:4px 6px; }
  .bar .st { display:flex; align-items:center; gap:10px; font-weight:600; color:#6ee7b7; }
  .bar .dot { width:14px; height:14px; border-radius:99px; background:#34d399; }
  .view { position:relative; margin-top:18px; aspect-ratio:5/7; border-radius:26px; overflow:hidden; background:rgba(0,0,0,.4); }
  .view img { width:100%; height:100%; object-fit:cover; display:block; }
  .br { position:absolute; width:58px; height:58px; border-color:rgba(125,211,252,.9); border-style:solid; border-width:0; }
  .br.tl { left:14px; top:14px; border-left-width:5px; border-top-width:5px; border-top-left-radius:14px; }
  .br.tr { right:14px; top:14px; border-right-width:5px; border-top-width:5px; border-top-right-radius:14px; }
  .br.bl { left:14px; bottom:14px; border-left-width:5px; border-bottom-width:5px; border-bottom-left-radius:14px; }
  .br.brr { right:14px; bottom:14px; border-right-width:5px; border-bottom-width:5px; border-bottom-right-radius:14px; }
  .line { position:absolute; left:0; right:0; height:6px; background:linear-gradient(90deg, transparent, #7dd3fc 20%, #f0abfc 50%, #7dd3fc 80%, transparent);
    box-shadow:0 0 30px rgba(125,211,252,.9); opacity:0; }
  .flash { position:absolute; inset:0; background:rgba(74,222,128,.35); opacity:0; }
  .found { margin-top:18px; border-radius:22px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); padding:20px 22px; text-align:left; }
  .found .row { display:flex; justify-content:space-between; font-size:20px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; color:#6ee7b7; }
  .found .row span:last-child { color:#71717a; font-weight:500; letter-spacing:0; text-transform:none; }
  .found .nm { font-size:40px; font-weight:700; margin-top:6px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .found .meta { font-size:22px; color:#a1a1aa; margin-top:2px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .found .pr { display:flex; align-items:baseline; gap:14px; margin-top:12px; }
  .found .pr b { font-size:56px; font-weight:800; font-variant-numeric:tabular-nums; }
  .found .pr span { font-size:20px; color:#71717a; }
  .headline { font-size:84px; line-height:1.02; margin-bottom:46px; }
  .headline.sm { font-size:70px; }
  .games { display:flex; flex-wrap:wrap; justify-content:center; gap:14px; margin-bottom:38px; }
  .games .g { font-size:30px; font-weight:600; padding:12px 26px; border-radius:999px; border:1px solid rgba(255,255,255,.14); background:rgba(255,255,255,.05); color:rgba(255,255,255,.7); }
  .games .g.on { color:#fff; border-color:rgba(167,139,250,.9); background:rgba(99,102,241,.35); box-shadow:0 0 30px rgba(99,102,241,.5); }
  #games .games { margin:0; gap:18px; }
  #games .games .g { font-size:44px; padding:20px 40px; }
  #games .headline { margin-bottom:60px; }
  #games .sub { margin-top:60px; }
  .listing { margin-top:18px; border-radius:22px; border:1px solid rgba(255,255,255,.12); background:rgba(255,255,255,.06); padding:22px; text-align:left; display:flex; gap:20px; align-items:center; }
  .listing img { width:120px; height:168px; border-radius:12px; object-fit:cover; }
  .listing .t { font-size:28px; font-weight:700; line-height:1.15; }
  .listing .p { font-size:40px; font-weight:800; margin-top:8px; font-variant-numeric:tabular-nums; }
  .listing .s { font-size:20px; color:#a1a1aa; margin-top:4px; }
  .btn { margin-top:22px; border-radius:18px; background:#6d5dfc; color:#fff; font-size:34px; font-weight:700; padding:26px; text-align:center; position:relative; overflow:hidden; }
  .btn.done { background:#16a34a; }
  .ebay { display:inline-flex; align-items:center; gap:8px; font-size:28px; font-weight:800; letter-spacing:-.02em; }
  .ebay i { font-style:normal; } .ebay .e1{color:#e53238} .ebay .e2{color:#0064d2} .ebay .e3{color:#f5af02} .ebay .e4{color:#86b817}
  #cta img { width:600px; }
  #cta .big { font-size:118px; line-height:1; margin-top:54px; }
  #cta .url { font-size:76px; font-weight:800; margin-top:38px; }
  #cta .chips { display:flex; flex-wrap:wrap; justify-content:center; gap:16px; margin-top:54px; }
  #cta .chips span { font-size:30px; font-weight:600; padding:16px 30px; border-radius:999px; border:1px solid rgba(255,255,255,.16); background:rgba(255,255,255,.06); }
</style></head><body>

<div class="abs scr" id="hook">
  <div class="kicker">What is this card worth?</div>
  <div class="cardwrap" style="margin-top:34px"><img src="${hook.art}"><div class="shine"></div></div>
  <div class="price display green" data-to="${hook.price}">${money(hook.price)}</div>
  <div class="who muted">${esc(hook.name)} · ${esc(hook.set)} · ${esc(hook.number)}</div>
</div>

${FOOTAGE ? SLICES.map(phoneFootage).join("\n") : `
<div class="abs scr" id="scan">
  <div class="headline display"><span class="h1">Point your camera.</span><span class="h2" style="display:none">Get the price.</span></div>
  <div class="phone"><div class="glow"></div><div class="screen">
    <div class="bar"><span>1 card · <b class="tot">—</b></span><span class="st"><span class="dot"></span><span class="stt">Reading</span></span></div>
    <div class="view"><img src="${scan.art}"><div class="br tl"></div><div class="br tr"></div><div class="br bl"></div><div class="br brr"></div><div class="line"></div><div class="flash"></div></div>
    <div class="found">
      <div class="row"><span>Found</span><span>Near Mint</span></div>
      <div class="nm">${esc(scan.name)}</div>
      <div class="meta">${esc(scan.set)} · ${esc(scan.number)}</div>
      <div class="pr"><b class="holo-text pv" data-to="${scan.price}">$0.00</b><span>${esc(scan.label)}, right now</span></div>
    </div>
  </div></div>
</div>

<div class="abs scr" id="fast">
  <div class="headline display sm">Five games. One scanner.</div>
  <div class="games">${["pokemon", "mtg", "yugioh", "onepiece", "lorcana"].map((g) => `<span class="g" data-g="${g}">${GAME_NAME[g]}</span>`).join("")}</div>
  <div class="phone"><div class="glow"></div><div class="screen">
    <div class="bar"><span>Scan</span><span class="st"><span class="dot"></span><span class="stt">Match</span></span></div>
    ${fast.map((c, i) => `<div class="fc" data-i="${i}">
      <div class="view"><img src="${c.art}"><div class="br tl"></div><div class="br tr"></div><div class="br bl"></div><div class="br brr"></div><div class="flash"></div></div>
      <div class="found">
        <div class="row"><span>Found</span><span>${GAME_NAME[c.game]}</span></div>
        <div class="nm">${esc(c.name)}</div>
        <div class="meta">${esc(c.set)} · ${esc(c.number)}</div>
        <div class="pr"><b class="holo-text pv" data-to="${c.price}">${money(c.price)}</b><span>${esc(c.label)}</span></div>
      </div>
    </div>`).join("")}
  </div></div>
</div>

<div class="abs scr" id="ebay">
  <div class="headline display">Sell it in one tap.</div>
  <div class="phone"><div class="glow"></div><div class="screen">
    <div class="bar"><span>Listing</span><span class="ebay"><i class="e1">e</i><i class="e2">b</i><i class="e3">a</i><i class="e4">y</i></span></div>
    <div class="listing"><img src="${scan.art}"><div><div class="t">${esc(scan.name)} ${esc(scan.number)} · ${esc(scan.set)} · Holo</div><div class="p">${money(scan.price)}</div><div class="s">Your photo · title · price · done</div></div></div>
    <div class="btn"><span class="bt">List it</span></div>
  </div></div>
  <div class="sub muted" style="margin-top:40px">Photo, title and price filled in for you.</div>
</div>`}

${FOOTAGE ? `<div class="abs scr" id="games">
  <div class="headline display">Five games.<br>One scanner.</div>
  <div class="games">${["pokemon", "mtg", "yugioh", "onepiece", "lorcana"].map((g) => `<span class="g" data-g="${g}">${GAME_NAME[g]}</span>`).join("")}</div>
  <div class="sub muted">Every card, read from your camera.</div>
</div>` : ""}

<div class="abs scr" id="cta">
  <img src="${logo}" alt="CardFlip">
  <div class="big display">Scan your first card free.</div>
  <div class="url holo-text display">cardflip.io</div>
  <div class="chips"><span>No app to install</span><span>Works in Safari and Chrome</span><span>Every price is live</span></div>
</div>

<script>
  const P=${P}, FPS=${FPS}, TOTAL=${TOTAL}, FOOTAGE=${FOOTAGE ? "true" : "false"};
  const T0=${JSON.stringify(T0)}, SEC=${JSON.stringify(SEC)};
  const SLICES=${JSON.stringify(SLICES.map((s) => ({ key: s.key, from: s.from, switchAt: s.switchAt ?? null })))};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const easeOut=(x)=>1-Math.pow(1-x,3);
  const easeInOut=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const money=(n)=>n>=100?"$"+Math.round(n).toLocaleString("en-US"):"$"+n.toFixed(2);
  const $=(s,r=document)=>r.querySelector(s);
  function fadeIn(el, b, d=.9, dy=40){ if(!el) return; const p=easeOut(clamp(b/d)); el.style.opacity=p; el.style.transform="translateY("+((1-p)*dy)+"px)"; }
  function show(el,on){ el.style.display = on ? "" : "none"; }
  function pop(b){ return b>=0 ? Math.exp(-b*7) : 0; }
  const scr = {}; for (const k of Object.keys(SEC)) scr[k] = document.getElementById(k);
  // Every footage frame decoded before the first screenshot (renderMp4 awaits this).
  window.__ready = Promise.all([...document.querySelectorAll("img.ff")].map((i) => i.decode().catch(() => {})));
  window.render = function(t){
    const beat = t/P;
    const pulse = Math.exp(-((beat % 1))*7);
    for (const k of Object.keys(scr)) {
      const lb = beat - T0[k]; const on = lb>=0 && lb<SEC[k];
      show(scr[k], on);
      if (!on) continue;
      scr[k].style.opacity = 1 - clamp((lb-(SEC[k]-.3))/.3);
      const slice = SLICES.find((s) => s.key === k);
      if (slice) {
        // Real footage: the frame for this moment, the phone easing in, the headline switching when the card is found.
        const ph=$(".phone",scr[k]); const ap=easeOut(clamp(lb/.7));
        ph.style.opacity=ap; ph.style.transform="translateY("+((1-ap)*120)+"px) scale("+(0.95+.05*ap)+")";
        const imgs=scr[k].querySelectorAll("img.ff"); const idx=Math.min(imgs.length-1, Math.max(0, Math.floor(lb*P*FPS)));
        imgs.forEach((im,i)=>{ im.style.display = i===idx ? "block" : "none"; });
        const h1=$(".h1",scr[k]), h2=$(".h2",scr[k]);
        const second = slice.switchAt != null && (slice.from + lb*P) >= slice.switchAt;
        if (h2) { h1.style.display = second ? "none" : "inline"; h2.style.display = second ? "inline" : "none"; }
        const sb = second ? (slice.from + lb*P - slice.switchAt)/P : lb;
        fadeIn(second ? h2 : h1, sb, .6, 30);
        if (second) { const p=pop(sb); (h2).style.transform += " scale("+(1+.06*p)+")"; }
        continue;
      }
      if (k==="hook") {
        fadeIn($(".kicker",scr.hook), 1);
        const cw=$(".cardwrap",scr.hook); const ap=easeOut(clamp(lb/.6));
        cw.style.opacity=ap; cw.style.transform="scale("+(0.9+.1*ap+.012*pulse)+") rotate("+((1-ap)*-4)+"deg)";
        $(".shine",scr.hook).style.backgroundPosition=((1-clamp(lb/4))*100)+"% "+((1-clamp(lb/4))*100)+"%";
        const pr=$(".price",scr.hook); const pb=lb-2;
        pr.style.opacity=clamp(pb/.15);
        pr.style.transform="scale("+(1+.14*pop(pb))+")";
        pr.style.backgroundPosition=((1-clamp(pb/1.2))*100)+"% 0";
        pr.style.filter="drop-shadow(0 0 "+(18+44*pop(pb))+"px rgba(74,222,128,"+(.45+.5*pop(pb))+")) brightness("+(1+.35*pop(pb))+")";
        fadeIn($(".who",scr.hook), pb-.3, .6, 20);
      }
      if (k==="games") {
        fadeIn($(".headline",scr.games), lb, .6, 30);
        scr.games.querySelectorAll(".games .g").forEach((g,i)=>{ const gb=lb-.4-i*.4; fadeIn(g, gb, .35, 24); const on=gb>=0; g.classList.toggle("on", on); if(on) g.style.transform += " scale("+(1+.12*pop(gb))+")"; });
        fadeIn($(".sub",scr.games), lb-2.6, .6, 20);
      }
      if (k==="scan") {
        const ph=$(".phone",scr.scan); const ap=easeOut(clamp(lb/.8));
        ph.style.opacity=ap; ph.style.transform="translateY("+((1-ap)*140)+"px) scale("+(0.94+.06*ap)+")";
        const h1=$(".h1",scr.scan), h2=$(".h2",scr.scan);
        const reading = lb<4;
        h1.style.display = reading ? "inline" : "none"; h2.style.display = reading ? "none" : "inline";
        fadeIn(reading?h1:h2, reading?lb:lb-4, .6, 30);
        const line=$(".line",scr.scan); const sw=(lb%2)/2;
        line.style.opacity = reading ? 1 : 0; line.style.top=(sw*100)+"%";
        $(".flash",scr.scan).style.opacity = lb>=4 ? .9*pop(lb-4) : 0;
        $(".stt",scr.scan).textContent = reading ? "Reading" : "Match";
        $(".dot",scr.scan).style.background = reading ? "#f0abfc" : "#34d399";
        $(".dot",scr.scan).style.transform="scale("+(1+.5*pulse)+")";
        const f=$(".found",scr.scan); fadeIn(f, lb-4, .5, 30);
        const pv=$(".pv",scr.scan); const to=Number(pv.dataset.to); const pp=easeInOut(clamp((lb-4.2)/2));
        pv.textContent=money(to*pp); $(".tot",scr.scan).textContent = lb>=4.2 ? money(to*pp) : "—";
        const pb=lb-6.2; pv.style.display="inline-block"; pv.style.transform="scale("+(1+.16*pop(pb))+")";
        pv.style.filter="drop-shadow(0 0 "+(30*pop(pb))+"px rgba(167,139,250,"+(.9*pop(pb))+"))";
      }
      if (k==="fast") {
        fadeIn($(".headline",scr.fast), lb, .6, 30);
        const ph=$(".phone",scr.fast); const ap=easeOut(clamp(lb/.6)); ph.style.opacity=ap; ph.style.transform="scale("+(0.96+.04*ap)+")";
        const starts=[0,3,6], lens=[3,3,4];
        const cards=scr.fast.querySelectorAll(".fc");
        const lit=new Set(["Pokémon"]);
        cards.forEach((el,i)=>{
          const cb=lb-starts[i]; const on=cb>=0 && cb<lens[i];
          show(el,on); if(!on) return;
          lit.add(el.querySelector(".row span:last-child").textContent);
          const v=el.querySelector(".view"); const vp=easeOut(clamp(cb/.35));
          v.style.transform="scale("+(0.9+.1*vp)+")"; v.style.opacity=vp;
          el.querySelector(".flash").style.opacity=.9*pop(cb-.5);
          const f=el.querySelector(".found"); fadeIn(f, cb-.5, .4, 24);
          const pv=el.querySelector(".pv"); const pb=cb-1;
          pv.style.display="inline-block"; pv.style.transform="scale("+(1+.16*pop(pb))+")";
          pv.style.filter="drop-shadow(0 0 "+(30*pop(pb))+"px rgba(167,139,250,"+(.9*pop(pb))+"))";
        });
        scr.fast.querySelectorAll(".games .g").forEach((g)=>{
          const name=g.textContent; const on = lit.has(name) || (name==="Magic" && lb>=8);
          g.classList.toggle("on", on);
          g.style.transform = on ? "scale("+(1+.06*pulse)+")" : "";
        });
      }
      if (k==="ebay" && !FOOTAGE) {
        fadeIn($(".headline",scr.ebay), lb, .6, 30);
        const ph=$(".phone",scr.ebay); const ap=easeOut(clamp(lb/.7)); ph.style.opacity=ap; ph.style.transform="translateY("+((1-ap)*80)+"px)";
        fadeIn($(".listing",scr.ebay), lb-.6, .6, 24);
        const btn=$(".btn",scr.ebay); fadeIn(btn, lb-1.2, .5, 16);
        const tap = lb>=3;
        btn.classList.toggle("done", tap);
        $(".bt",scr.ebay).textContent = tap ? "Listed ✓" : "List it";
        fadeIn($(".sub",scr.ebay), lb-3.6, .6, 20);
      }
      if (k==="cta") {
        fadeIn($("img",scr.cta), lb, .8, 30);
        fadeIn($(".big",scr.cta), lb-.8, .8, 40);
        const u=$(".url",scr.cta); fadeIn(u, lb-2, .8, 30); u.style.transform += " scale("+(1+.1*pop(lb-2.6)+.02*pulse)+")";
        scr.cta.querySelectorAll(".chips span").forEach((c,i)=>fadeIn(c, lb-3.6-i*.6, .6, 20));
      }
    }
  };
</script></body></html>`;

const audio = has("--silent") ? null : { file: path.resolve("public/social/audio/moodmode-hip-hop-promo-226369.mp3"), start: 10.4 };
if (audio && !fs.existsSync(audio.file)) throw new Error(`audio missing: ${audio.file}`);
console.log(`rendering ${TOTAL.toFixed(1)}s (${TOTAL_BEATS} beats at ${BPM} bpm) → ${OUT}`);
const bytes = await renderMp4({ html, W, H, fps: FPS, total: TOTAL, out: OUT, audio });
if (framesDir) fs.rmSync(framesDir, { recursive: true, force: true });
console.log(`wrote ${OUT} (${(bytes / 1e6).toFixed(1)} MB)`);
