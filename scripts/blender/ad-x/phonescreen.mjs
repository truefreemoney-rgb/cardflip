// Phone screens for the X ads (10-26), drawn flat so the words are sharp (3D text read melted) and the phone reads as a
// real phone (status bar, island, home bar; Chris on v1: "make the phone screen look more like a phone screen", "the
// text in the middle is so small"). Writes <out>/screen_scan.png (camera view + brackets) and screen_result.png.
// node phonescreen.mjs <card png> <name> <set line> <price> <logo png> <out dir>
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const [card, name, setLine, price, logo, out] = process.argv.slice(2);
const W = 900, H = 1928;   // the 3D screen's aspect (0.467)
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const money = "$" + Number(price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
fs.mkdirSync(out, { recursive: true });

const statusBar = (fg = "#fff") => `
  <text x="92" y="92" font-family="Segoe UI" font-weight="700" font-size="44" fill="${fg}">9:41</text>
  <rect x="330" y="40" width="240" height="70" rx="35" fill="#000"/>
  ${[0, 1, 2, 3].map((i) => `<rect x="${656 + i * 16}" y="${88 - i * 9}" width="10" height="${12 + i * 9}" rx="2" fill="${fg}"/>`).join("")}
  <path d="M736 74 a26 26 0 0 1 36 0 M742 82 a17 17 0 0 1 24 0" stroke="${fg}" stroke-width="6" fill="none" stroke-linecap="round"/>
  <circle cx="754" cy="90" r="5" fill="${fg}"/>
  <rect x="784" y="64" width="54" height="28" rx="8" fill="none" stroke="${fg}" stroke-width="4" opacity="0.9"/>
  <rect x="789" y="69" width="40" height="18" rx="4" fill="${fg}"/><rect x="841" y="72" width="5" height="12" rx="2" fill="${fg}"/>`;
const homeBar = (fg = "#fff") => `<rect x="${W / 2 - 150}" y="${H - 34}" width="300" height="11" rx="6" fill="${fg}" opacity="0.85"/>`;

async function cardImg(w, r) {
  const h = Math.round(w * 1.4);
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}" fill="#fff"/></svg>`);
  return { buf: await sharp(card).resize(w, h, { fit: "fill" }).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer(), w, h };
}

// ---- camera view: the card fills the viewfinder, cyan brackets, a "Scanning" pill and the shutter ----
{
  const c = await cardImg(640, 26), x = (W - c.w) / 2, y = 420;
  const b = 52, L = 110, x0 = x - b, y0 = y - b, x1 = x + c.w + b, y1 = y + c.h + b;
  const br = [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]
    .map(([px, py, sx, sy]) => `<path d="M${px} ${py + sy * L} V${py} H${px + sx * L}" stroke="#4de3ff" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
  const bg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><radialGradient id="g" cx="50%" cy="45%" r="75%">
    <stop offset="0" stop-color="#2a1748"/><stop offset="1" stop-color="#07050d"/></radialGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`;
  const ui = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${statusBar()}${br}
    <rect x="${W / 2 - 190}" y="1500" width="380" height="96" rx="48" fill="#071a20" fill-opacity="0.9" stroke="#4de3ff" stroke-width="4"/>
    <text x="${W / 2}" y="1563" text-anchor="middle" font-family="Segoe UI" font-weight="700" font-size="46" fill="#4de3ff">Scanning…</text>
    <circle cx="${W / 2}" cy="1760" r="78" fill="none" stroke="#fff" stroke-width="10"/><circle cx="${W / 2}" cy="1760" r="62" fill="#fff"/>${homeBar()}</svg>`;
  await sharp(Buffer.from(bg)).composite([{ input: c.buf, left: Math.round(x), top: y }, { input: Buffer.from(ui) }]).png().toFile(path.join(out, "screen_scan.png"));
}

// ---- the result: CardFlip header, the card, name, set, condition, market price, the two buttons ----
{
  const c = await cardImg(500, 22), x = (W - c.w) / 2, y = 250;
  const lg = await sharp(logo).resize({ width: 470 }).toBuffer(), lgm = await sharp(lg).metadata();
  const T = (s, yy, size, fill, weight = 700, font = "Segoe UI") => `<text x="${W / 2}" y="${yy}" text-anchor="middle" font-family="${font}" font-weight="${weight}" font-size="${size}" fill="${fill}">${esc(s)}</text>`;
  const ui = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${statusBar()}
    ${T(name, 1065, 92, "#fff", 900, "Segoe UI Black")}${T(setLine, 1130, 40, "#a9a6b8", 600)}
    <rect x="${W / 2 - 130}" y="1166" width="260" height="62" rx="31" fill="#123d26"/>${T("NEAR MINT", 1209, 36, "#3dff8f", 800)}
    ${T("Market price", 1300, 42, "#a9a6b8", 600)}${T(money, 1452, 168, "#3dff8f", 900, "Segoe UI Black")}
    <rect x="70" y="1540" width="${W - 140}" height="128" rx="64" fill="#8b5cf6"/>${T("List on eBay", 1621, 52, "#fff", 800)}
    <rect x="70" y="1694" width="${W - 140}" height="128" rx="64" fill="#2a2738"/>${T("Add to collection", 1775, 52, "#fff", 800)}${homeBar()}</svg>`;
  await sharp({ create: { width: W, height: H, channels: 4, background: "#0e0b18" } })
    .composite([{ input: lg, left: Math.round((W - 470) / 2), top: Math.round(170 - lgm.height / 2) }, { input: c.buf, left: Math.round(x), top: y }, { input: Buffer.from(ui) }])
    .png().toFile(path.join(out, "screen_result.png"));
}
console.log("phone screens ->", out);
