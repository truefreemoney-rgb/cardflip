// Set-spotlight video prototype (09-25, Chris: "i would really like to see
// a prototype"). No footage: the same setSpotlight() data the 7am picture
// uses, drawn as a 1080x1920 HTML scene, stepped one frame at a time by
// headless Chromium (render(t) is pure: every frame is a function of time,
// so the output is deterministic), then stitched to an H.264 MP4 by ffmpeg.
//
//   node --experimental-strip-types --no-warnings --conditions=react-server \
//     --import ./scripts/lib/register-next-stubs.mjs scripts/social-video.mjs [--day YYYY-MM-DD] [--out path.mp4] [--fps 24]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const FPS = Number(arg("--fps", 24));
const OUT = path.resolve(arg("--out", "social-video.mp4"));
const day = arg("--day", new Date().toISOString().slice(0, 10));
const W = 1080, H = 1920;

const root = process.cwd();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { setSpotlight, money } = await import(at("lib/server/social.ts"));
const { fallbackArtUrl } = await import(at("lib/cardArt.ts"));

const spot = await setSpotlight("pokemon", day);
if (!spot) { console.error("no set for", day); process.exit(1); }
console.log(`set: ${spot.setName} (${spot.setId}) · ${spot.cards.length} cards`);

async function artDataUri(url) {
  const grab = async (u) => {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return { bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "image/png" };
    } catch { return null; }
  };
  const a = (await grab(url)) ?? (fallbackArtUrl(url) ? await grab(fallbackArtUrl(url)) : null);
  return a ? `data:${a.type};base64,${a.bytes.toString("base64")}` : "";
}
// Countdown: least valuable first, the set's top card last (No. 1).
const cards = [];
for (const c of [...spot.cards].reverse()) cards.push({ ...c, art: await artDataUri(c.imageUrl) });
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "public/brand/cardflip-logo.png")).toString("base64")}`;

// Timeline (seconds): intro → one beat per card → outro.
const INTRO = 2.2, BEAT = 2.1, OUTRO = 2.6;
const TOTAL = INTRO + BEAT * cards.length + OUTRO;

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
  .beat .meta { font-size:36px; margin-top:12px; }
  .beat .price { font-size:150px; line-height:1; margin-top:26px; font-variant-numeric:tabular-nums; }
  .beat .pct { font-size:40px; font-weight:600; margin-top:18px; }
  .up { color:#4ade80; } .down { color:#f87171; }
  #outro { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 90px; text-align:center; }
  #outro img { width:560px; }
  #outro .line { font-size:56px; margin-top:60px; line-height:1.2; }
  #outro .url { font-size:64px; font-weight:700; margin-top:40px; }
  #footer { position:absolute; left:0; right:0; bottom:110px; display:flex; align-items:center; justify-content:center; gap:18px; font-size:34px; }
  #footer .dot { width:22px; height:22px; border-radius:999px; background:#6366f1; }
  #bar { position:absolute; left:80px; right:80px; bottom:70px; height:8px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden; }
  #bar i { display:block; height:100%; width:0; }
</style></head><body>
<div id="intro" class="abs">
  <div class="kicker">Pokémon · set spotlight</div>
  <div class="title display holo-text">${esc(spot.setName)}</div>
  <div class="sub muted">The five most valuable cards, market price today</div>
</div>
${cards.map((c, i) => `
<div class="abs beat" id="beat${i}">
  <div class="rank">No. ${cards.length - i}</div>
  ${c.art ? `<img class="art" src="${c.art}">` : `<div class="art"></div>`}
  <div class="name display">${esc(c.name)}</div>
  <div class="meta muted">#${esc(c.number)}${c.variant && c.variant !== "normal" ? ` · ${esc(c.variant)}` : ""}</div>
  <div class="price display" data-to="${c.to}">$0</div>
  <div class="pct ${c.unsettled ? "muted" : Math.abs(c.pct) < 1 ? "muted" : c.pct > 0 ? "up" : "down"}">${c.unsettled ? "" : Math.abs(c.pct) < 1 ? "steady this week" : `${c.pct > 0 ? "▲" : "▼"} ${Math.abs(c.pct).toFixed(1)}% this week`}</div>
</div>`).join("")}
<div id="outro" class="abs">
  <img src="${logo}">
  <div class="line muted">Scan a card.<br>See what it's worth.<br>List it on eBay.</div>
  <div class="url display holo-text">cardflip.io</div>
</div>
<div id="footer"><span class="dot"></span><span style="font-weight:600">CardFlip</span><span class="muted">cardflip.io</span></div>
<div id="bar"><i class="holo"></i></div>
<script>
  const INTRO=${INTRO}, BEAT=${BEAT}, OUTRO=${OUTRO}, N=${cards.length}, TOTAL=${TOTAL};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const easeOut=(x)=>1-Math.pow(1-x,3);
  const easeInOut=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const money=(n)=>n>=100?"$"+Math.round(n).toLocaleString("en-US"):"$"+n.toFixed(2);
  function fadeIn(el, t, d=.45, dy=40){ const p=easeOut(clamp(t/d)); el.style.opacity=p; el.style.transform="translateY("+((1-p)*dy)+"px)"; }
  function show(el, on){ el.style.display = on ? "" : "none"; }
  window.render = function(t){
    document.querySelector("#bar i").style.width=(clamp(t/TOTAL)*100)+"%";
    const intro=document.getElementById("intro"), outro=document.getElementById("outro");
    // intro
    show(intro, t<INTRO);
    if(t<INTRO){
      const out = clamp((t-(INTRO-.35))/.35);
      intro.style.opacity = 1-out;
      fadeIn(intro.querySelector(".kicker"), t, .4);
      fadeIn(intro.querySelector(".title"), t-.15, .6, 60);
      fadeIn(intro.querySelector(".sub"), t-.45, .5);
      intro.querySelector(".title").style.transform += " scale("+(1+.04*easeOut(clamp(t/INTRO)))+")";
    }
    for(let i=0;i<N;i++){
      const el=document.getElementById("beat"+i);
      const s=INTRO+i*BEAT, lt=t-s;
      const on = lt>=0 && lt<BEAT;
      show(el,on);
      if(!on) continue;
      const out = clamp((lt-(BEAT-.25))/.25);
      el.style.opacity = 1-out;
      fadeIn(el.querySelector(".rank"), lt, .3);
      const art=el.querySelector(".art"); const ap=easeOut(clamp(lt/.55));
      art.style.opacity=ap; art.style.transform="translateY("+((1-ap)*120)+"px) rotate("+((1-ap)*-6)+"deg) scale("+(0.92+.08*ap)+")";
      fadeIn(el.querySelector(".name"), lt-.35, .4);
      fadeIn(el.querySelector(".meta"), lt-.45, .4);
      const price=el.querySelector(".price"); const to=Number(price.dataset.to);
      const pp=easeInOut(clamp((lt-.55)/.8));
      price.style.opacity=clamp((lt-.5)/.2);
      price.textContent=money(to*pp);
      price.style.transform="scale("+(1+.06*Math.sin(Math.PI*clamp((lt-1.3)/.3)))+")";
      fadeIn(el.querySelector(".pct"), lt-1.35, .35, 20);
    }
    const ot=t-(INTRO+N*BEAT);
    show(outro, ot>=0);
    if(ot>=0){
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
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "medium", "-movflags", "+faststart", OUT,
], { stdio: ["ignore", "ignore", "pipe"] });
if (r.status !== 0) { console.error(r.stderr.toString().slice(-2000)); process.exit(1); }
fs.rmSync(work, { recursive: true, force: true });
console.log(`wrote ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${TOTAL.toFixed(1)}s)`);
