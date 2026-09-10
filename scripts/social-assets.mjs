// Social media kit renderer (docs/SOCIAL-KIT.md). One HTML template per
// asset kind, rendered by headless Chromium at every size the big sites
// want, written to public/social/ so Chris can download each one from
// cardflip.io/social/<file>.png on his phone. Brand pieces come from
// public/brand/ (the real logo PNGs); colours from docs/DESIGN.md.
//
//   npm run social:assets            # render everything
//   npm run social:assets -- --only x-banner
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const root = process.cwd();
const OUT = path.join(root, "public/social");
fs.mkdirSync(OUT, { recursive: true });
const only = (() => { const i = process.argv.indexOf("--only"); return i > -1 ? process.argv[i + 1] : null; })();

const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, "public/brand/cardflip-logo.png")).toString("base64")}`;
const icon = `data:image/png;base64,${fs.readFileSync(path.join(root, "public/brand/cardflip-icon.png")).toString("base64")}`;

const BG = "#0a0b11";
const TAGLINE = "Scan a card. See what it's worth. List it on eBay.";
const URL = "cardflip.io";

// [file, width, height, kind, {safe: {w,h} area that must hold the content}]
const ASSETS = [
  // Profile pictures — one square everyone accepts; sites crop it to a circle.
  ["avatar-1000", 1000, 1000, "avatar"],
  ["avatar-512", 512, 512, "avatar"],
  ["avatar-400", 400, 400, "avatar"],
  // Banners / covers, at each site's native size. safe = the part every phone shows.
  ["x-banner", 1500, 500, "banner", { safe: [1200, 380] }],
  ["bluesky-banner", 1500, 500, "banner", { safe: [1200, 380] }],
  ["facebook-cover", 1640, 856, "banner", { safe: [1250, 640] }],
  ["youtube-banner", 2560, 1440, "banner", { safe: [1546, 423] }],
  ["linkedin-cover", 1128, 191, "banner", { safe: [900, 150] }],
  ["twitch-banner", 1200, 480, "banner", { safe: [1000, 380] }],
  ["reddit-banner", 1920, 384, "banner", { safe: [1400, 300] }],
  ["pinterest-cover", 800, 450, "banner", { safe: [700, 380] }],
  ["discord-banner", 960, 540, "banner", { safe: [800, 440] }],
  // Post templates — the first post's cover on every site.
  ["post-square", 1080, 1080, "post"],
  ["post-story", 1080, 1920, "post"],
  ["post-landscape", 1200, 628, "post"],
  ["pinterest-pin", 1000, 1500, "post"],
];

const css = (w, h) => `
  * { margin: 0; box-sizing: border-box; }
  html, body { width: ${w}px; height: ${h}px; overflow: hidden; background: ${BG}; }
  body {
    font-family: "Geist", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
    background:
      radial-gradient(60% 55% at 50% 0%, rgba(99,102,241,.32), transparent 70%),
      radial-gradient(45% 45% at 100% 100%, rgba(240,171,252,.16), transparent 70%),
      ${BG};
  }
  .display { font-family: "Bricolage Grotesque", "Geist", system-ui, sans-serif; font-weight: 700; letter-spacing: -0.02em; }
  .holo { height: var(--bar, 6px); width: 100%; background: linear-gradient(90deg, #7dd3fc, #a78bfa, #f0abfc, #fcd34d); }
  .muted { color: rgba(255,255,255,.62); }
  .url { color: #c7d2fe; font-weight: 600; letter-spacing: .01em; }
`;

const head = (w, h) => `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700&family=Geist:wght@400;500;600&display=swap" rel="stylesheet"><style>${css(w, h)}</style>`;

function avatar(w, h) {
  // The CF mark on the brand ground, with room for the circle crop (~80% safe).
  const size = Math.round(w * 0.66);
  // The icon PNG carries its own black square, so the ground is plain black.
  return `${head(w, h)}<body style="display:grid;place-items:center;background:#000"><img src="${icon}" style="width:${size}px;height:${size}px;object-fit:contain"></body>`;
}

function banner(w, h, safe) {
  const [sw, sh] = safe;
  const logoH = Math.round(Math.min(sh * 0.34, sw * 0.13));
  const tag = Math.round(logoH * 0.42);
  const url = Math.round(logoH * 0.36);
  return `${head(w, h)}<body style="display:grid;place-items:center;--bar:${Math.max(4, Math.round(h * 0.012))}px">
    <div class="holo" style="position:absolute;left:0;bottom:0"></div>
    <div style="width:${sw}px;height:${sh}px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:${Math.round(logoH * 0.34)}px;text-align:center">
      <img src="${logo}" style="height:${logoH}px;width:auto">
      <p class="display" style="font-size:${tag}px;line-height:1.15">${TAGLINE}</p>
      <p class="url" style="font-size:${url}px">${URL} · 10 free scans</p>
    </div></body>`;
}

function post(w, h) {
  const portrait = h > w;
  const logoH = Math.round(Math.min(w, h) * (portrait ? 0.09 : 0.11));
  const big = Math.round(Math.min(w, h) * (portrait ? 0.11 : 0.115));
  const pad = Math.round(Math.min(w, h) * 0.08);
  return `${head(w, h)}<body style="--bar:${Math.round(Math.min(w, h) * 0.012)}px">
    <div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:space-between;padding:${pad}px;text-align:left">
      <img src="${logo}" style="height:${logoH}px;width:auto;align-self:flex-start">
      <div>
        <p class="muted" style="font-size:${Math.round(big * 0.38)}px;font-weight:500;margin-bottom:${Math.round(big * 0.3)}px">Is it worth anything?</p>
        <p class="display" style="font-size:${big}px;line-height:1.02;max-width:${Math.round(w * 0.84)}px">Scan the card.<br>See the price.<br>List it on eBay.</p>
        <p class="url" style="font-size:${Math.round(big * 0.42)}px;margin-top:${Math.round(big * 0.5)}px">${URL} · 10 free scans</p>
      </div>
    </div>
    <div class="holo" style="position:absolute;left:0;bottom:0"></div></body>`;
}

const browser = await chromium.launch();
const list = ASSETS.filter(([f]) => !only || f === only);
for (const [file, w, h, kind, opts] of list) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const html = kind === "avatar" ? avatar(w, h) : kind === "banner" ? banner(w, h, opts.safe) : post(w, h);
  await page.setContent(html, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(OUT, `${file}.png`), type: "png" });
  await page.close();
  console.log(`  ${file}.png  ${w}×${h}`);
}
await browser.close();
console.log(`${list.length} assets → public/social/  (live at https://cardflip.io/social/<file>.png after deploy)`);
