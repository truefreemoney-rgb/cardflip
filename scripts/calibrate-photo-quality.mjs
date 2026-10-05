// Calibrates lib/photoQuality.ts on the real phone photos in prod (card_photos,
// read-only): light / glare numbers across the set, how often the card-edge
// finder fires, and a before/after contact sheet of every photo it would
// straighten, to eyeball. Nothing is written to the database.
// Run: node --experimental-strip-types --no-warnings scripts/calibrate-photo-quality.mjs [--limit 300] [--out dir]
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createClient } from "@libsql/client";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, "$1")), "..");
const pq = await import(new URL("../src/lib/photoQuality.ts", import.meta.url).href);
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const limit = Number(arg("limit", 300));
const out = arg("out", path.join(root, "backups", "photo-quality"));
fs.mkdirSync(out, { recursive: true });

const cfg = JSON.parse(fs.readFileSync(path.join(root, ".env.migration.json"), "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await db.execute({ sql: "SELECT p.card_id AS id, p.bytes AS bytes, c.card_name AS name, c.game AS game FROM card_photos p JOIN cards c ON c.id = p.card_id ORDER BY c.created_at DESC LIMIT ?", args: [limit] })).rows;
console.log(`${rows.length} photos`);

const lumas = [], blowns = [];
let found = 0, straighten = 0;
const sheet = [];
for (const r of rows) {
  const buf = Buffer.from(r.bytes);
  const small = await sharp(buf).rotate().resize({ width: 240 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = small.info;
  const light = pq.frameLight(small.data, w, h);
  lumas.push(light.luma);
  blowns.push(light.blown);
  const quad = pq.findCardQuad(pq.toGray(small.data, w * h), w, h);
  if (quad) found++;
  if (pq.shouldStraighten(quad)) {
    straighten++;
    const full = await sharp(buf).rotate().ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const s = full.info.width / w;
    const corners = pq.growQuad(quad.corners.map((p) => ({ x: p.x * s, y: p.y * s })), 0.015);
    const outH = full.info.height, outW = Math.round(outH * pq.CARD_ASPECT);
    const warped = pq.warpQuad(full.data, full.info.width, full.info.height, corners, outW, outH);
    const before = await sharp(full.data, { raw: { width: full.info.width, height: full.info.height, channels: 4 } }).resize({ height: 360 }).png().toBuffer();
    const after = await sharp(Buffer.from(warped.buffer), { raw: { width: outW, height: outH, channels: 4 } }).resize({ height: 360 }).png().toBuffer();
    sheet.push({ name: r.name, area: quad.area, angle: quad.angle, before, after });
  }
}
const pctl = (a, p) => [...a].sort((x, y) => x - y)[Math.floor((a.length - 1) * p)];
console.log(`luma p5 ${pctl(lumas, 0.05).toFixed(0)} p50 ${pctl(lumas, 0.5).toFixed(0)} | under ${pq.HINTS.darkLuma}: ${lumas.filter((l) => l < pq.HINTS.darkLuma).length}`);
console.log(`blown p50 ${(pctl(blowns, 0.5) * 100).toFixed(2)}% p90 ${(pctl(blowns, 0.9) * 100).toFixed(2)}% p97 ${(pctl(blowns, 0.97) * 100).toFixed(2)}% | over ${pq.HINTS.glareBlown * 100}%: ${blowns.filter((b) => b > pq.HINTS.glareBlown).length}`);
console.log(`card edges found ${found}/${rows.length}, would straighten ${straighten}`);

// Contact sheet: pairs side by side, 4 pairs per row.
if (sheet.length) {
  const cellW = 260 * 2 + 20, cellH = 400, perRow = 4;
  const W = cellW * perRow, H = cellH * Math.ceil(sheet.length / perRow);
  const comps = [];
  for (let i = 0; i < sheet.length; i++) {
    const x = (i % perRow) * cellW, y = Math.floor(i / perRow) * cellH;
    comps.push({ input: sheet[i].before, left: x, top: y + 30 });
    comps.push({ input: sheet[i].after, left: x + 270, top: y + 30 });
    const label = `${sheet[i].name} · ${(sheet[i].area * 100).toFixed(0)}% · ${sheet[i].angle.toFixed(1)}°`.replace(/[<&>]/g, "");
    comps.push({ input: Buffer.from(`<svg width="${cellW}" height="28"><text x="4" y="20" font-size="16" fill="white" font-family="sans-serif">${label}</text></svg>`), left: x, top: y });
  }
  const file = path.join(out, "straighten-sheet.png");
  await sharp({ create: { width: W, height: H, channels: 4, background: "#111" } }).composite(comps).png().toFile(file);
  console.log("sheet:", file);
}
