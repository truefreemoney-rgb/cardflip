// App Store screenshots v2 (premium): two-line copy, a realistic iPhone frame with the Dynamic Island, one element
// that breaks out of the phone per shot. Raw 440x956 @3x screens in docs/shots/appstore-raw.
// usage: node scripts/_appstore-compose2.mjs <outDir> [variant A|B] [shot keys...]
import { chromium } from "@playwright/test";
import fs from "node:fs";
import sharp from "sharp";
const [outDir, variantArg = "A", ...only] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const RAW = "docs/shots/appstore-raw";
const ASSETS = "docs/shots/appstore-assets";
const b64 = (p, mime) => `data:${mime};base64,${fs.readFileSync(p).toString("base64")}`;
const fontB = fs.readFileSync("mobile/node_modules/@expo-google-fonts/bricolage-grotesque/800ExtraBold/BricolageGrotesque_800ExtraBold.ttf").toString("base64");
const fontG = fs.readFileSync("mobile/node_modules/@expo-google-fonts/geist/500Medium/Geist_500Medium.ttf").toString("base64");
const fontG7 = fs.readFileSync("mobile/node_modules/@expo-google-fonts/geist/700Bold/Geist_700Bold.ttf").toString("base64");
const umbreon = b64(`${ASSETS}/umbreon-vmax-215.webp`, "image/webp");

// Floating pieces (CSS px at 440 wide). Each shot: raw file, headline, sub, float html.
const SHOTS = [
  { key: "01-value", raw: "03-first-card", h: "Know what your cards are <em>worth</em>", s: "Scan any card. See the real price in seconds.",
    float: `<img class="card" src="${umbreon}"><div class="pill price" style="left:222px;top:556px"><small>MARKET PRICE</small>$2,209.75</div>` },
  { key: "02-scanner", raw: "02-scanner", h: "Point. Scan. <em>Done.</em>", s: "No typing, no searching. Just aim your camera.",
    float: `<div class="pill found" style="right:12px;top:598px"><span class="chk">✓</span><div><small>MATCH FOUND</small>Umbreon VMAX</div></div>` },
  { key: "03-free", raw: "01-first-scan", h: "Your first scan is <em>free</em>", s: "Pokémon, Magic, Lorcana, One Piece, Yu-Gi-Oh!",
    float: `<div class="pill tag" style="left:18px;top:300px">No account needed</div>` },
  { key: "04-inventory", raw: "04-inventory", h: "Your whole collection, <em>priced</em>", s: "Every card you own, totaled and kept up to date.",
    float: `<div class="pill price" style="right:16px;top:306px"><small>UNSOLD</small>$3,390.86</div>` },
  { key: "05-watchlist", raw: "05-watchlist", h: "Get told when prices <em>move</em>", s: "Watch any card. We email you when it dips.",
    float: `<div class="pill notif" style="left:20px;top:296px"><div class="ico">CF</div><div><b>Price drop</b><span>Umbreon VMAX is $2,209.75</span></div></div>` },
  { key: "06-ebay", raw: "06-editor-3", h: "Sell it on <em>eBay</em>", s: "Title, price and description written for you, in a few taps.",
    float: `<div class="pill found" style="right:14px;top:300px"><span class="chk">✓</span><div><small>READY</small>Listed on eBay</div></div>` },
];
const SIZES = [["6.9", 440, 956], ["6.3", 402, 874]];

const html = (w, h, shot, variant) => {
  const screen = b64(`${RAW}/${shot.raw}.png`, "image/png");
  const tilt = variant === "B" ? "transform: perspective(1500px) rotateY(-7deg) rotateX(2deg) translateX(8px);" : "";
  const sc = w / 440;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face { font-family: Bric; src: url(data:font/ttf;base64,${fontB}) format("truetype"); font-weight: 800; }
  @font-face { font-family: Geist; src: url(data:font/ttf;base64,${fontG}) format("truetype"); font-weight: 500; }
  @font-face { font-family: Geist; src: url(data:font/ttf;base64,${fontG7}) format("truetype"); font-weight: 700; }
  html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #07080f; }
  body { position: relative; font-family: Geist, system-ui, sans-serif; color: #fff; }
  .stage { position: absolute; inset: 0; transform-origin: top left; transform: scale(${sc}); width: 440px; height: ${h / sc}px; }
  .bg { position: absolute; inset: 0;
    background:
      radial-gradient(60% 40% at 15% 8%, rgba(99,102,241,0.55) 0%, rgba(99,102,241,0) 70%),
      radial-gradient(55% 40% at 90% 22%, rgba(168,85,247,0.45) 0%, rgba(168,85,247,0) 70%),
      radial-gradient(70% 45% at 50% 85%, rgba(34,197,94,0.18) 0%, rgba(34,197,94,0) 70%),
      linear-gradient(180deg, #12132a 0%, #0a0b16 55%, #07080f 100%); }
  .noise { position: absolute; inset: 0; opacity: .07; mix-blend-mode: overlay;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='200' height='200' filter='url(%23n)' opacity='1'/></svg>"); }
  .copy { position: absolute; left: 0; right: 0; top: 42px; text-align: center; padding: 0 22px; }
  h1 { margin: 0; font-family: Bric; font-weight: 800; font-size: 38px; line-height: 1.04; letter-spacing: -0.022em;
    background: linear-gradient(180deg, #fff 0%, #d9dcff 100%); -webkit-background-clip: text; color: transparent; }
  h1 em { font-style: normal; color: #fff; -webkit-text-fill-color: #fff; background: linear-gradient(90deg, #6d5cff, #a855f7);
    -webkit-background-clip: border-box; background-clip: border-box; padding: 0 10px 2px; border-radius: 14px; display: inline-block; line-height: 1.02; }
  p { margin: 12px -6px 0; font-size: 16.5px; line-height: 1.3; color: rgba(255,255,255,.68); }
  .phonewrap { position: absolute; left: 50%; top: 212px; width: 362px; margin-left: -181px; ${tilt} }
  .phone { position: relative; padding: 9px; border-radius: 58px; background: linear-gradient(160deg, #3a3b4a 0%, #15161f 40%, #0b0b11 100%);
    box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 60px 120px rgba(0,0,0,.8), 0 0 140px rgba(99,102,241,.22); }
  .phone:before { content: ""; position: absolute; inset: 1.5px; border-radius: 57px; border: 1.5px solid rgba(255,255,255,.14); pointer-events: none; }
  .btn { position: absolute; width: 3px; background: #2a2b36; border-radius: 2px; left: -3px; }
  .btn.r { left: auto; right: -3px; }
  .scr { position: relative; border-radius: 49px; overflow: hidden; background: #0a0b11; }
  .bar { position: relative; height: 52px; background: #0a0b11; }
  .bar .t { position: absolute; left: 34px; top: 17px; font-family: Geist; font-weight: 700; font-size: 15px; color: #fff; }
  .bar .r { position: absolute; right: 30px; top: 18px; display: flex; gap: 5px; align-items: center; }
  .bar .r i { display: block; width: 3px; background: #fff; border-radius: 1px; }
  .bar .bat { width: 24px; height: 11px; border: 1.5px solid rgba(255,255,255,.5); border-radius: 4px; padding: 1.5px; margin-left: 4px; }
  .bar .bat b { display: block; width: 100%; height: 100%; background: #fff; border-radius: 2px; }
  .screen { display: block; width: 100%; }
  .island { position: absolute; left: 50%; top: 11px; width: 104px; height: 31px; margin-left: -52px; background: #000; border-radius: 20px; }
  .card { position: absolute; left: 104px; top: 286px; width: 232px; border-radius: 11px; transform: rotate(-6deg);
    box-shadow: 0 30px 60px rgba(0,0,0,.75), 0 0 0 1px rgba(255,255,255,.12); }
  .pill { position: absolute; display: flex; align-items: center; gap: 10px; padding: 12px 18px; border-radius: 20px;
    background: rgba(13,14,24,.88); border: 1px solid rgba(255,255,255,.14); backdrop-filter: blur(10px);
    box-shadow: 0 20px 50px rgba(0,0,0,.6); font-family: Bric; font-weight: 800; font-size: 22px; line-height: 1.1; letter-spacing: -0.01em; }
  .pill small { display: block; font-family: Geist; font-weight: 700; font-size: 10px; letter-spacing: .14em; color: rgba(255,255,255,.55); margin-bottom: 3px; }
  .pill.price { flex-direction: column; align-items: flex-start; gap: 0; color: #22c55e; font-size: 34px; padding: 12px 20px 14px; }
  .pill.found { font-size: 18px; } .pill.found small { color: #22c55e; }
  .chk { width: 30px; height: 30px; border-radius: 15px; background: #22c55e; color: #06130a; display: flex; align-items: center; justify-content: center; font-family: Geist; font-weight: 700; font-size: 17px; }
  .pill.tag { font-size: 17px; color: #fff; background: linear-gradient(90deg, #6d5cff, #a855f7); border: 0; }
  .pill.notif { font-family: Geist; font-weight: 500; font-size: 14px; color: rgba(255,255,255,.75); gap: 12px; }
  .pill.notif b { display: block; font-weight: 700; font-size: 15px; color: #fff; }
  .pill.notif span { color: #22c55e; font-weight: 700; }
  .ico { width: 36px; height: 36px; border-radius: 10px; background: linear-gradient(135deg, #6d5cff, #a855f7); display: flex; align-items: center; justify-content: center; font-family: Bric; font-weight: 800; font-size: 14px; color: #fff; }
  </style></head><body><div class="stage"><div class="bg"></div><div class="noise"></div>
  <div class="copy"><h1>${shot.h}</h1><p>${shot.s}</p></div>
  <div class="phonewrap"><div class="phone">
    <div class="btn" style="top:120px;height:26px"></div><div class="btn" style="top:160px;height:50px"></div><div class="btn" style="top:222px;height:50px"></div><div class="btn r" style="top:180px;height:70px"></div>
    <div class="scr"><div class="bar"><span class="t">9:41</span><div class="island"></div><div class="r"><i style="height:5px"></i><i style="height:7px"></i><i style="height:9px"></i><i style="height:11px"></i><div class="bat"><b></b></div></div></div><img class="screen" src="${screen}"></div></div></div>
  ${shot.float}
  </div></body></html>`;
};

const b = await chromium.launch();
for (const [key, w, h] of SIZES) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, colorScheme: "dark" });
  const p = await c.newPage();
  for (const shot of SHOTS) {
    if (only.length && !only.includes(shot.key)) continue;
    await p.setContent(html(w, h, shot, variantArg));
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(250);
    const out = `${outDir}/${shot.key}-${variantArg}-${key}.png`;
    await p.screenshot({ path: out });
    if (key === "6.9") await sharp(out).resize({ width: 660 }).jpeg({ quality: 84 }).toFile(out.replace("-6.9.png", "-preview.jpg"));
    console.log("made", out);
  }
  await c.close();
}
await b.close();
