/**
 * Google Display / Demand Gen ad images (10-07, retargeting campaign).
 * Real cards with their price chips on the brand background, almost no text
 * (Google prefers images without overlay text; the words live in the ad's
 * headline fields). Writes 1200x628 landscape, 1200x1200 square and
 * 960x1200 portrait PNGs to the folder given (default: Downloads).
 *
 *   node scripts/google-ad-images.mjs ["C:\\Users\\Chris\\Downloads\\CardFlip Google Ads"]
 */
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const out = process.argv[2] ?? path.join(process.env.USERPROFILE ?? ".", "Downloads", "CardFlip Google Ads");
mkdirSync(out, { recursive: true });
const logo = `data:image/png;base64,${readFileSync(new URL("../public/brand/cardflip-logo.png", import.meta.url)).toString("base64")}`;

// Prices read off cardflip.io/pokemon/charizard-card-value on 10-07.
const CARDS = [
  { img: "https://assets.tcgdex.net/en/sm/sm3/150/high.webp", price: "$806.10" },
  { img: "https://tcgplayer-cdn.tcgplayer.com/product/42382_in_1000x1000.jpg", price: "$928.32" }, // Base Set Charizard
  { img: "https://assets.tcgdex.net/en/me/me02/125/high.webp", price: "$659.53" },
];

const SIZES = [
  { name: "landscape-1200x628", w: 1200, h: 628, card: 300, logo: 260 },
  { name: "square-1200x1200", w: 1200, h: 1200, card: 340, logo: 420 },
  { name: "portrait-960x1200", w: 960, h: 1200, card: 262, logo: 360 },
];

function html({ w, h, card, logo: logoW }) {
  const tilt = [-9, 0, 9];
  const lift = [card * 0.08, 0, card * 0.08];
  const cards = CARDS.map(
    (c, i) => `
    <div class="card" style="transform: translateY(${lift[i]}px) rotate(${tilt[i]}deg); z-index:${i === 1 ? 3 : 1}">
      <img src="${c.img}" />
      <div class="chip">${c.price}</div>
    </div>`,
  ).join("");
  return `<!doctype html><html><head><style>
    * { box-sizing: border-box; margin: 0; }
    body { width:${w}px; height:${h}px; overflow:hidden; font-family: "Segoe UI", system-ui, sans-serif;
      background: radial-gradient(ellipse at 50% 55%, #3b1d7a 0%, #160b33 45%, #07060d 100%); }
    .wrap { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:${Math.round(h * 0.05)}px; }
    .logo { width:${logoW}px; }
    .row { display:flex; align-items:center; }
    .card { position:relative; width:${card}px; margin:0 ${Math.round(card * 0.03)}px; filter: drop-shadow(0 18px 30px rgba(0,0,0,.6)); }
    .card img { width:100%; border-radius:${Math.round(card * 0.045)}px; display:block; }
    .chip { position:absolute; left:50%; bottom:-${Math.round(card * 0.07)}px; transform:translateX(-50%);
      background:linear-gradient(90deg,#6d5dfc,#a855f7); color:#fff; font-weight:800; font-size:${Math.round(card * 0.12)}px;
      padding:${Math.round(card * 0.025)}px ${Math.round(card * 0.07)}px; border-radius:999px; white-space:nowrap;
      box-shadow:0 6px 18px rgba(124,58,237,.55); }
  </style></head><body><div class="wrap">
    <img class="logo" src="${logo}" />
    <div class="row">${cards}</div>
  </div></body></html>`;
}

const browser = await chromium.launch();
for (const s of SIZES) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.setContent(html(s), { waitUntil: "networkidle" });
  const file = path.join(out, `cardflip-${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(file);
  await page.close();
}
await browser.close();
