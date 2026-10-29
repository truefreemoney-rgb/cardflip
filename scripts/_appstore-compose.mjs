// App Store screenshots, framed (docs/APP-STORE-LISTING.md "Screenshots to make"): each raw 440x956 @3x screen
// goes under one line of text on the app's dark background, inside a phone bezel that bleeds off the bottom.
// Sizes: 6.9" 1320x2868 (440x956 @3x) and 6.5" 1284x2778 (428x926 @3x). Also a 660-wide JPG preview per shot.
import { chromium } from "@playwright/test";
import fs from "node:fs";
import sharp from "sharp";
const [rawDir, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const SHOTS = [
  ["01-first-scan", "Your first scan is free"],
  ["02-scanner", "Point. Scan. Done."],
  ["03-first-card", "See what it sells for"],
  ["04-inventory", "Your whole collection, priced"],
  ["05-watchlist", "Get told when prices move"],
  ["06-editor-3", "List on eBay in a few taps"],
];
const SIZES = [["6.9", 440, 956], ["6.5", 428, 926]];
const font = fs.readFileSync("mobile/node_modules/@expo-google-fonts/bricolage-grotesque/700Bold/BricolageGrotesque_700Bold.ttf").toString("base64");
const b = await chromium.launch();
for (const [key, w, h] of SIZES) {
  const c = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 3, colorScheme: "dark" });
  const p = await c.newPage();
  for (const [name, caption] of SHOTS) {
    const src = `${rawDir}/${name}.png`;
    if (!fs.existsSync(src)) { console.log("missing", src); continue; }
    const img = fs.readFileSync(src).toString("base64");
    await p.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
      @font-face { font-family: Bricolage; src: url(data:font/ttf;base64,${font}) format("truetype"); font-weight: 700; }
      html, body { margin: 0; width: ${w}px; height: ${h}px; overflow: hidden; background: #0a0b11; }
      body { position: relative; font-family: Bricolage, system-ui, sans-serif;
        background: radial-gradient(120% 70% at 50% -10%, #2a2358 0%, #15162a 45%, #0a0b11 100%); }
      .glow { position: absolute; left: 50%; top: 58%; width: 120%; height: 60%; transform: translateX(-50%);
        background: radial-gradient(50% 50% at 50% 50%, rgba(99,102,241,0.35) 0%, rgba(99,102,241,0) 70%); }
      h1 { position: absolute; left: 0; right: 0; top: ${Math.round(h * 0.052)}px; margin: 0; padding: 0 24px; text-align: center;
        color: #fff; font-size: ${Math.round(w * 0.078)}px; line-height: 1.12; letter-spacing: -0.01em; font-weight: 700; }
      .phone { position: absolute; left: 50%; top: ${Math.round(h * 0.168)}px; transform: translateX(-50%);
        width: ${Math.round(w * 0.86)}px; padding: 8px; border-radius: ${Math.round(w * 0.135)}px; background: #1c1d2b;
        box-shadow: 0 0 0 1.5px #3a3c52, 0 40px 90px rgba(0,0,0,0.7), 0 0 120px rgba(99,102,241,0.18); }
      .screen { display: block; width: 100%; border-radius: ${Math.round(w * 0.118)}px; }
    </style></head><body><div class="glow"></div><h1>${caption}</h1>
    <div class="phone"><img class="screen" src="data:image/png;base64,${img}"></div></body></html>`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(300);
    const out = `${outDir}/${name.replace(/-\d$/, "")}-${key}.png`;
    await p.screenshot({ path: out });
    if (key === "6.9") await sharp(out).resize({ width: 660 }).jpeg({ quality: 82 }).toFile(out.replace("-6.9.png", "-preview.jpg"));
    console.log("framed", out);
  }
  await c.close();
}
await b.close();
