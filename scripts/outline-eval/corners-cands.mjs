// Every corner candidate per patch for one frame, with its distance to the label's corner (crop px).
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const pq = await import(new URL("../../src/lib/photoQuality.ts", import.meta.url).href);
const here = path.dirname(fileURLToPath(import.meta.url));
const DUMPS = path.resolve(".outline-dumps");
const labels = JSON.parse(readFileSync(path.join(here, "labels.json"), "utf8"));
const short = process.argv[2];
const PATCH = +(process.env.PATCH ?? 124), SPAN = +(process.env.SPAN ?? 0.44);
const f = (await readdir(DUMPS)).find((x) => x.includes(short) && x.endsWith(".json"));
const stamp = f.replace(".json", "");
const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
const { sx, sy, sw, sh, w, h } = meta.crop;
const g = meta.geometry.video;
const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
const { width: FW, height: FH } = await img.metadata();
const corners = [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]];
const patches = [];
for (const [cx, cy] of corners) {
  const half = g.w * SPAN / 2;
  const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
  const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
  const rw = right - left, rh = bottom - top, scale = PATCH / (g.w * SPAN);
  const pw = Math.max(8, Math.round(rw * scale)), ph = Math.max(8, Math.round(rh * scale));
  const rgba = await img.clone().extract({ left, top, width: rw, height: rh }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  patches.push({ gray: pq.toGray(rgba, pw * ph), pw, ph, ox: left, oy: top, scale });
}
const cands = pq.cardCornerCandidates(patches, g.w, +(process.env.KEEP ?? 8));
const lab = labels[short];
const [L, R, T, B] = lab ?? [0, 0, 0, 0];
const labC = [[L, T], [R, T], [R, B], [L, B]];
cands.forEach((list, k) => {
  console.log(`${"TL TR BR BL".split(" ")[k]} label (${labC[k][0]},${labC[k][1]}):`);
  for (const c of list) {
    const cx = ((c.x - sx) / sw) * w, cy = ((c.y - sy) / sh) * h;
    const d = Math.hypot(cx - labC[k][0], cy - labC[k][1]);
    console.log(`   (${cx.toFixed(0)},${cy.toFixed(0)}) score ${c.score.toFixed(1)} r ${(c.r / (sw / w)).toFixed(1)}  ${d < 4 ? "<== label" : `${d.toFixed(0)} px off`}`);
  }
});
