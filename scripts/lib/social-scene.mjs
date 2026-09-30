// The social video scene and its renderer (scripts/social-video.mjs). No
// footage: a 1080x1920 HTML scene where render(t) is a pure function of time,
// stepped one frame at a time by headless Chromium (so the output is
// deterministic) and stitched to an H.264 MP4 by ffmpeg.
//
// One scene serves every kind (09-30, TikTok by hand: the night render makes
// the 7am set video, the 1pm movers video and the 7pm all-games video): an
// intro, one beat per card, an outro. A card is a rank label, the art, a
// name, a meta line, a price that counts up and POPS on beat 3 (green, glow
// flare, a shine sweep across the number: Chris's standing note), and a
// last line. Everything is drawn from the values handed in, so the same
// scene cannot show one thing and say another.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

/**
 * Art as a data URI. Scryfall refuses Node's default User-Agent (400
 * generic_user_agent): every Magic card drew blank without a name.
 */
export async function artDataUri(url, fallbackArtUrl) {
  const grab = async (u) => {
    try {
      const r = await fetch(u, { headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)", Accept: "image/*" }, signal: AbortSignal.timeout(6000) });
      if (!r.ok) return null;
      return { bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") ?? "image/png" };
    } catch { return null; }
  };
  if (!url) return "";
  const a = (await grab(url)) ?? (fallbackArtUrl(url) ? await grab(fallbackArtUrl(url)) : null);
  return a ? `data:${a.type};base64,${a.bytes.toString("base64")}` : "";
}

/** Intro title size by length: "Biggest movers" (14) keeps its 132px; a long set name shrinks so it never runs off the frame. */
function titleClass(t) {
  return t.length <= 14 ? "" : t.length <= 24 ? " md" : " sm";
}

/**
 * o = {
 *   W, H, logo,                     frame and the logo as a data URI
 *   intro: { kicker, title, sub },
 *   cards: [{ rank, art, name, meta, to, pct: { text, cls } }],   in the order shown
 *   outro: { games?: [names] },     games = the "Now scanning" list (the mixed movers day plan); none = the standard outro
 *   INTRO, BEAT, OUTRO, PERIOD, MUSIC, TOTAL,
 *   safeBottom?                     lift the card stack above TikTok's caption, account and nav overlay (the bottom ~20% of the
 *                                   frame): the 7am and 7pm videos, which only TikTok gets. The 1pm file every site posts keeps
 *                                   the layout it was approved with.
 * }
 */
export function sceneHtml(o) {
  const { W, H, logo, intro, cards, outro } = o;
  return `<!doctype html><html><head><meta charset="utf-8">
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
  /* TikTok's For You feed covers the bottom ~20% (caption, account, sound, nav): nothing that carries meaning sits under y=1550. */
  .safe .beat { padding-top:130px; }
  .safe .beat .art { width:616px; height:860px; margin-top:26px; }
  .safe .beat .name { margin-top:44px; }
  .safe .beat .name.long { font-size:52px; }
  #intro { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:0 90px; text-align:center; }
  #intro .kicker { font-size:38px; font-weight:600; color:#a5b4fc; text-transform:uppercase; letter-spacing:.18em; }
  #intro .title { font-size:132px; line-height:1; margin-top:28px; }
  #intro .title.md { font-size:104px; line-height:1.02; }
  #intro .title.sm { font-size:84px; line-height:1.04; }
  #intro .sub { font-size:42px; margin-top:36px; }
  .beat { display:flex; flex-direction:column; align-items:center; justify-content:flex-start; padding:150px 80px 0; }
  .beat .rank { font-size:40px; font-weight:600; color:#a5b4fc; letter-spacing:.14em; text-transform:uppercase; }
  .beat .art { width:720px; height:1000px; border-radius:36px; object-fit:cover; margin-top:34px;
    box-shadow:0 40px 120px rgba(0,0,0,.6), 0 0 0 2px rgba(255,255,255,.12); background:#1c1d27; }
  .beat .name { font-size:72px; line-height:1.05; margin-top:52px; text-align:center; }
  .beat .name.long { font-size:58px; }
  .beat .meta { font-size:36px; margin-top:12px; text-align:center; }
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
</style></head><body${o.safeBottom ? ' class="safe"' : ""}>
<div id="intro" class="abs">
  <div class="kicker">${esc(intro.kicker)}</div>
  <div class="title display holo-text${titleClass(intro.title)}">${esc(intro.title)}</div>
  <div class="sub muted">${esc(intro.sub)}</div>
</div>
${cards.map((c, i) => `
<div class="abs beat" id="beat${i}">
  <div class="rank">${esc(c.rank)}</div>
  ${c.art ? `<img class="art" src="${c.art}">` : `<div class="art"></div>`}
  <div class="name display${c.name.length > 22 ? " long" : ""}">${esc(c.name)}</div>
  <div class="meta muted">${esc(c.meta)}</div>
  <div class="price display" data-to="${c.to}">$0</div>
  <div class="pct ${c.pct.cls}">${esc(c.pct.text)}</div>
</div>`).join("")}
${outro.games ? `<div id="outro" class="abs">
  <img src="${logo}">
  <div class="now">Now scanning</div>
  <div class="games">${outro.games.map((g) => `<div class="g display">${esc(g)}</div>`).join("")}</div>
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
  const INTRO=${o.INTRO}, BEAT=${o.BEAT}, OUTRO=${o.OUTRO}, N=${cards.length}, TOTAL=${o.TOTAL};
  // P = one musical beat (a quarter of a card's hold); with no track it is the same fraction, so the cut feels alike.
  const P=${o.PERIOD > 0 ? o.PERIOD : o.BEAT / 4}, MUSIC=${o.MUSIC ? "true" : "false"};
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
}

/**
 * Step the scene frame by frame and stitch the MP4. audio = { file, start }
 * mixes the track from `start` seconds with a 0.15s fade-in and a 0.6s
 * fade-out; none = a silent video. Returns the file size in bytes.
 */
export async function renderMp4({ html, W, H, fps, total, out, audio }) {
  const { chromium } = await import("playwright");
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "cardflip-video-"));
  fs.writeFileSync(path.join(work, "scene.html"), html);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`file://${path.join(work, "scene.html").replace(/\\/g, "/")}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  const frames = Math.round(total * fps);
  console.log(`rendering ${frames} frames at ${fps}fps (${total.toFixed(1)}s)`);
  for (let i = 0; i < frames; i++) {
    await page.evaluate((t) => window.render(t), i / fps);
    await page.screenshot({ path: path.join(work, `f${String(i).padStart(4, "0")}.png`), type: "png" });
    if (i % 48 === 0) process.stdout.write(`  ${i}/${frames}\n`);
  }
  await browser.close();

  const ffmpeg = (await import("ffmpeg-static")).default;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(ffmpeg, [
    "-y", "-framerate", String(fps), "-i", path.join(work, "f%04d.png"),
    ...(audio ? ["-ss", audio.start.toFixed(3), "-i", audio.file, "-af", `afade=t=in:d=0.15,afade=t=out:st=${(total - 0.6).toFixed(2)}:d=0.6`, "-c:a", "aac", "-b:a", "128k", "-shortest"] : []),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "19", "-preset", "medium", "-movflags", "+faststart", out,
  ], { stdio: ["ignore", "ignore", "pipe"] });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${r.stderr.toString().slice(-1500)}`);
  fs.rmSync(work, { recursive: true, force: true });
  return fs.statSync(out).size;
}
