// New content angles for the social videos (Chris 10-03: "the videos are getting extremely repetitive … a whole new
// angle"). Same 1080x1920 HTML-scene pipeline as social-scene.mjs (renderMp4 steps window.render(t)), same palette
// and TikTok safe box, but the screens are not "five cards counted down":
//   reveal   one card, "What's it worth?" held for two bars, then the price pops          (guess the price)
//   thennow  one card, its price months ago, then today's, and the move since             (then vs now)
//   versus   two cards side by side, "Which would you hold?", then both moves, the better one glows
//   beat     the classic one-card screen (rank, art, name, price, move), for list angles
// A screen holds `hold` BEATs (a BEAT = two bars); reveal / thennow / versus hold two, beat holds one.
// All five approved 10-03; scripts/social-video.mjs buildAngle() draws them from angleData (the draft's own pick).
import { outroStep } from "./social-scene.mjs";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => (n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2));
export const HOLD = { reveal: 2, thennow: 2, versus: 2, beat: 1 };
export const beatsOf = (screens) => screens.reduce((a, s) => a + HOLD[s.type], 0);

function artImg(art, cls) {
  return art ? `<img class="${cls}" src="${art}">` : `<div class="${cls}"></div>`;
}
const pctLine = (p) => (p ? `<div class="pct ${p.cls}">${esc(p.text)}</div>` : `<div class="pct muted"></div>`);

function screenHtml(s, i) {
  const id = `s${i}`;
  if (s.type === "reveal") return `<div class="abs scr reveal" id="${id}" data-type="reveal">
  <div class="kicker">What's it worth?</div>
  ${artImg(s.art, "art")}
  <div class="name display${s.name.length > 22 ? " long" : ""}">${esc(s.name)}</div>
  <div class="meta muted">${esc(s.meta)}</div>
  <div class="guess display">$ ? ? ?</div>
  <div class="price display" data-to="${s.to}">$0</div>
  ${pctLine(s.pct)}
</div>`;
  if (s.type === "thennow") return `<div class="abs scr thennow" id="${id}" data-type="thennow">
  <div class="kicker">Then vs now</div>
  ${artImg(s.art, "art")}
  <div class="name display${s.name.length > 22 ? " long" : ""}">${esc(s.name)}</div>
  <div class="meta muted">${esc(s.meta)}</div>
  <div class="row then"><span class="lbl display">${esc(s.thenLabel)}</span><span class="val display">${money(s.then)}</span></div>
  <div class="row now"><span class="lbl display">Today</span><span class="val price display" data-to="${s.to}">$0</span></div>
  ${pctLine(s.pct)}
</div>`;
  if (s.type === "versus") return `<div class="abs scr versus" id="${id}" data-type="versus" data-win="${s.win}">
  <div class="kicker" data-ask="${esc(s.ask ?? "Which would you hold?")}" data-answer="${esc(s.verdict)}">${esc(s.ask ?? "Which would you hold?")}</div>
  <div class="pair">${[s.a, s.b].map((c, k) => `<div class="side side${k}">
    <div class="wintag display">Winner</div>
    ${artImg(c.art, "art")}
    <div class="name display">${esc(c.name)}</div>
    <div class="meta muted">${esc(c.meta)}</div>
    <div class="price display" data-to="${c.to}">$0</div>
    ${pctLine(c.pct)}
  </div>`).join("")}<div class="vs display">VS</div></div>
</div>`;
  return `<div class="abs scr beat" id="${id}" data-type="beat">
  <div class="rank">${esc(s.rank)}</div>
  ${artImg(s.art, "art")}
  <div class="name display${s.name.length > 22 ? " long" : ""}">${esc(s.name)}</div>
  <div class="meta muted">${esc(s.meta)}</div>
  <div class="price display" data-to="${s.to}">$0</div>
  ${pctLine(s.pct)}
</div>`;
}

export function angleScene(o) {
  const { W, H, logo, intro, screens, outroGames } = o;
  const P = o.PERIOD > 0 ? o.PERIOD : o.BEAT / 4;
  const starts = [];
  let t = o.INTRO;
  for (const s of screens) { starts.push(t); t += HOLD[s.type] * o.BEAT; }
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
  .holo-text { background:linear-gradient(90deg,#7dd3fc,#a78bfa,#f0abfc,#fcd34d); -webkit-background-clip:text; color:transparent; }
  .green { background:linear-gradient(100deg,#22c55e 0%,#4ade80 30%,#d9f99d 48%,#4ade80 66%,#16a34a 100%); background-size:260% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 0 18px rgba(74,222,128,.45)); }
  /* TikTok safe box: everything centred in y 230..1560, text inside x 170..910. */
  #intro, #outro, .scr { display:flex; flex-direction:column; align-items:center; justify-content:center; padding:230px 80px 360px; text-align:center; }
  .kicker { font-size:38px; font-weight:600; color:#a5b4fc; text-transform:uppercase; letter-spacing:.18em; }
  #intro .title { font-size:120px; line-height:1; margin-top:28px; }
  #intro .title.md { font-size:96px; line-height:1.02; }
  #intro .title.sm { font-size:76px; line-height:1.04; }
  #intro .sub { font-size:42px; margin-top:36px; }
  .rank { font-size:40px; font-weight:600; color:#a5b4fc; letter-spacing:.14em; text-transform:uppercase; }
  .art { width:560px; height:780px; border-radius:36px; object-fit:cover; margin-top:26px;
    box-shadow:0 40px 120px rgba(0,0,0,.6), 0 0 0 2px rgba(255,255,255,.12); background:#1c1d27; }
  .name { font-size:72px; line-height:1.05; margin-top:44px; text-align:center; max-width:740px; }
  .name.long { font-size:52px; }
  .meta { font-size:36px; margin-top:12px; text-align:center; max-width:740px; }
  .price { font-size:164px; line-height:1; margin-top:22px; font-variant-numeric:tabular-nums; padding:0 20px;
    background:linear-gradient(100deg,#22c55e 0%,#4ade80 30%,#d9f99d 48%,#4ade80 66%,#16a34a 100%); background-size:260% 100%;
    -webkit-background-clip:text; background-clip:text; color:transparent; filter:drop-shadow(0 0 18px rgba(74,222,128,.45)); }
  .pct { font-size:40px; font-weight:600; margin-top:18px; min-height:48px; }
  .pct.big { font-size:72px; font-weight:800; margin-top:8px; line-height:1.05; }
  .up { color:#4ade80; } .down { color:#f87171; }
  /* reveal: the question holds where the price will land, so nothing jumps when it answers. */
  .reveal .guess { font-size:164px; line-height:1; margin-top:22px; color:rgba(255,255,255,.35); letter-spacing:.06em; font-variant-numeric:tabular-nums; }
  /* thennow: two rows under a shorter card. */
  .thennow .art { width:480px; height:668px; }
  .thennow .name { margin-top:34px; }
  /* Chris 10-03: the labels were tiny next to the amounts ("looks goofy"); each label is now the size of its amount. */
  .thennow .art { width:440px; height:612px; }
  .thennow .row { display:flex; align-items:baseline; justify-content:center; gap:30px; margin-top:22px; line-height:1; }
  .thennow .row .lbl { text-transform:uppercase; color:#a5b4fc; letter-spacing:-0.01em; }
  .thennow .row.then .lbl { font-size:76px; }
  .thennow .row.then .val { font-size:76px; color:rgba(255,255,255,.55); text-decoration:line-through; text-decoration-thickness:6px; text-decoration-color:rgba(248,113,113,.7); }
  .thennow .row.now { margin-top:18px; }
  .thennow .row.now .lbl { font-size:112px; }
  .thennow .row.now .val { font-size:112px; margin-top:0; padding:0 10px; }
  /* versus: two cards in the 910px of width that the rail leaves. */
  .versus .pair { display:flex; gap:40px; margin-top:30px; position:relative; }
  .versus .side { display:flex; flex-direction:column; align-items:center; width:350px; }
  .versus .art { width:330px; height:460px; border-radius:24px; margin-top:0; }
  .versus .name { font-size:40px; margin-top:22px; max-width:350px; }
  .versus .meta { font-size:24px; margin-top:6px; max-width:350px; }
  .versus .price { font-size:80px; margin-top:12px; padding:0 8px; }
  .versus .pct { font-size:30px; margin-top:8px; }
  .versus .pct.big { font-size:38px; }
  /* The VS badge sits in the gap at card height, on its own disc, never over the art. */
  .versus .vs { position:absolute; left:50%; top:230px; transform:translate(-50%,-50%); font-size:40px; color:#fff; width:104px; height:104px; border-radius:999px;
    background:#0a0b11; box-shadow:0 0 0 3px #a5b4fc, 0 12px 40px rgba(0,0,0,.7); display:flex; align-items:center; justify-content:center; }
  .versus .side.dim { filter:saturate(.4) brightness(.6); }
  .versus .kicker { font-size:44px; letter-spacing:.1em; max-width:760px; line-height:1.2; min-height:106px; display:flex; align-items:center; }
  .versus .kicker.answer { color:#4ade80; text-transform:none; letter-spacing:0; font-weight:700; }
  .versus .wintag { font-size:30px; letter-spacing:.14em; text-transform:uppercase; color:#0a0b11; background:#4ade80; border-radius:999px; padding:10px 28px; margin-bottom:16px; opacity:0; }
  .versus .side .art { margin-top:0; }
  #outro img { width:560px; }
  #outro .now { font-size:40px; font-weight:600; color:#a5b4fc; letter-spacing:.18em; text-transform:uppercase; margin-top:64px; }
  #outro .games { display:flex; flex-direction:column; align-items:center; gap:18px; margin-top:30px; }
  #outro .games .g { font-size:88px; line-height:1.05; }
  #outro .tag { font-size:44px; margin-top:52px; }
  #outro .url { font-size:64px; font-weight:700; margin-top:40px; }
</style></head><body>
<div id="intro" class="abs">
  <div class="kicker">${esc(intro.kicker)}</div>
  <div class="title display holo-text${intro.title.length > 18 ? " sm" : intro.title.length > 12 ? " md" : ""}">${esc(intro.title)}</div>
  <div class="sub muted">${esc(intro.sub)}</div>
</div>
${screens.map(screenHtml).join("\n")}
<div id="outro" class="abs">
  <img src="${logo}">
  <div class="now">Now scanning</div>
  <div class="games">${outroGames.map((g) => `<div class="g display">${esc(g)}</div>`).join("")}</div>
  <div class="tag muted">Scan a card. See what it's worth.</div>
  <div class="url display holo-text">cardflip.io</div>
</div>
<script>
  const INTRO=${o.INTRO}, BEAT=${o.BEAT}, OUTRO=${o.OUTRO}, TOTAL=${o.TOTAL}, P=${P}, MUSIC=${o.MUSIC ? "true" : "false"};
  const STARTS=${JSON.stringify(starts)}, HOLDS=${JSON.stringify(screens.map((s) => HOLD[s.type]))};
  const Q=${outroStep(P, o.OUTRO)};
  const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
  const easeOut=(x)=>1-Math.pow(1-x,3);
  const easeInOut=(x)=>x<.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
  const money=(n)=>n>=100?"$"+Math.round(n).toLocaleString("en-US"):"$"+n.toFixed(2);
  function fadeIn(el, t, d=.45, dy=40){ if(!el) return; const p=easeOut(clamp(t/d)); el.style.opacity=p; el.style.transform="translateY("+((1-p)*dy)+"px)"; }
  function show(el, on){ el.style.display = on ? "" : "none"; }
  function slam(art, lt, pulse){ const ap=easeOut(clamp(lt/Math.min(.55,P))); art.style.opacity=ap; art.style.transform="translateY("+((1-ap)*120)+"px) rotate("+((1-ap)*-6)+"deg) scale("+(0.92+.08*ap+.015*pulse*ap)+")"; }
  // The classic count-up and pop: counts from "at", pops two beats later, shine sweeps across.
  function priceAt(price, lt, at){
    const to=Number(price.dataset.to);
    const pp=easeInOut(clamp((lt-at)/(2*P)));
    price.style.opacity=clamp((lt-at+.1)/.15);
    price.textContent=money(to*pp);
    const popAt=at+2*P;
    const pop = lt>=popAt ? Math.exp(-(lt-popAt)*9) : 0;
    const sweep = lt>=popAt ? clamp((lt-popAt)/(P*1.2)) : 0;
    price.style.transform="scale("+(1+.12*pop)+")";
    price.style.backgroundPosition=((1-sweep)*100)+"% 0";
    price.style.filter="drop-shadow(0 0 "+(18+40*pop)+"px rgba(74,222,128,"+(.45+.5*pop)+")) brightness("+(1+.35*pop)+")";
    return popAt;
  }
  window.render = function(t){
    const pulse = MUSIC ? Math.exp(-((t % P)/P)*7) : 0;
    const intro=document.getElementById("intro"), outro=document.getElementById("outro");
    show(intro, t<INTRO);
    if(t<INTRO){
      intro.style.opacity = 1-clamp((t-(INTRO-.3))/.3);
      fadeIn(intro.querySelector(".kicker"), t, .4);
      fadeIn(intro.querySelector(".title"), t-P*.5, .6, 60);
      fadeIn(intro.querySelector(".sub"), t-P*1.5, .5);
      intro.querySelector(".title").style.transform += " scale("+(1+.04*easeOut(clamp(t/INTRO))+.02*pulse)+")";
    }
    for(let i=0;i<STARTS.length;i++){
      const el=document.getElementById("s"+i);
      const len=HOLDS[i]*BEAT, lt=t-STARTS[i];
      const on = lt>=0 && lt<len;
      show(el,on);
      if(!on) continue;
      el.style.opacity = 1-clamp((lt-(len-.2))/.2);
      const type=el.dataset.type;
      fadeIn(el.querySelector(".kicker, .rank"), lt, .3);
      if(type==="versus"){
        // First BEAT: both cards with their prices and the question. Second BEAT: the week's move under each on the
        // downbeat, then the loser dims, the winner gets its tag and the question becomes the verdict (Chris 10-03: "a little confusing").
        const revealAt = BEAT + P;
        el.querySelectorAll(".side").forEach((side,k)=>{
          slam(side.querySelector(".art"), lt-k*P*.5, pulse);
          fadeIn(side.querySelector(".name"), lt-P*.8-k*P*.3, .35);
          fadeIn(side.querySelector(".meta"), lt-P*.95-k*P*.3, .35);
          priceAt(side.querySelector(".price"), lt, P*1.5+k*P*.3);
          const pct=side.querySelector(".pct");
          fadeIn(pct, lt-revealAt, .3, 20);
          const pop = lt>=revealAt ? Math.exp(-(lt-revealAt)*9) : 0;
          pct.style.transform += " scale("+(1+.25*pop)+")";
          const won = String(k)===el.dataset.win;
          side.classList.toggle("dim", lt>=revealAt+P && !won);
          const tag=side.querySelector(".wintag");
          if(won) fadeIn(tag, lt-(revealAt+P), .3, -16); else tag.style.opacity=0;
        });
        const kick=el.querySelector(".kicker");
        const answering = lt>=revealAt+P;
        kick.classList.toggle("answer", answering);
        kick.textContent = answering ? kick.dataset.answer : kick.dataset.ask;
        if(answering) fadeIn(kick, lt-(revealAt+P), .35, 10);
        const vs=el.querySelector(".vs"); vs.style.opacity=easeOut(clamp((lt-P*1.2)/.3));
        vs.style.transform="translate(-50%,-50%) scale("+(1+.1*pulse)+")";
        continue;
      }
      slam(el.querySelector(".art"), lt, pulse);
      fadeIn(el.querySelector(".name"), lt-P*.8, .35);
      fadeIn(el.querySelector(".meta"), lt-P*.95, .35);
      if(type==="reveal"){
        const g=el.querySelector(".guess");
        const asking = lt<BEAT;
        show(g, asking);
        if(asking){ fadeIn(g, lt-P*1.2, .4, 20); g.style.transform="scale("+(1+.06*pulse)+")"; g.style.opacity=Math.min(Number(g.style.opacity||0), .6+.4*pulse); }
        const price=el.querySelector(".price");
        show(price, !asking);
        let popAt=0;
        if(!asking) popAt=priceAt(price, lt, BEAT);
        fadeIn(el.querySelector(".pct"), asking? -1 : lt-popAt, .3, 20);
        continue;
      }
      if(type==="thennow"){
        fadeIn(el.querySelector(".row.then"), lt-P*2, .4, 20);
        const popAt=priceAt(el.querySelector(".row.now .val"), lt, BEAT);
        fadeIn(el.querySelector(".row.now .lbl"), lt-BEAT+.1, .3, 20);
        fadeIn(el.querySelector(".pct"), lt-popAt, .3, 20);
        continue;
      }
      const popAt=priceAt(el.querySelector(".price"), lt, P);
      fadeIn(el.querySelector(".pct"), lt-popAt, .3, 20);
    }
    const ot=t-(INTRO+${beatsOf(screens)}*BEAT);
    show(outro, ot>=0);
    if(ot>=0){
      fadeIn(outro.querySelector("img"), ot, .4, 30);
      fadeIn(outro.querySelector(".now"), ot-Q*.5, .35, 20);
      outro.querySelectorAll(".games .g").forEach((g, i) => { const gt = ot-Q*(1+i); fadeIn(g, gt, .3, 30); const pop = gt>=0 ? Math.exp(-gt*9) : 0; g.style.transform += " scale("+(1+.14*pop)+")"; });
      fadeIn(outro.querySelector(".tag"), ot-Q*6, .4);
      fadeIn(outro.querySelector(".url"), ot-Q*6.5, .45);
    }
  };
</script></body></html>`;
}
