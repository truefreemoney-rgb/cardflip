// Corner-finder benchmark on the recorded phone frames (.outline-dumps):
// accuracy against labels.json (IoU of the box with the label, >= 0.9 counts
// as correct) and stability (how far the pick moves when the four search
// windows shift 4-8 frame px, which is what a hand-held phone does between
// two ticks; 10-15 night: this reproduces the live tick-to-tick jitter).
// Patches are built exactly as CameraCapture.cornersFromSource does (PATCH
// 110 px for half a guide width). Run from the repo root:
//   node --experimental-strip-types scripts/outline-eval/bench.mjs [filter]
// Labeled frames only unless a filter is given. env: MIN (20), KEEP (6; the
// phone uses 10), PATCH (110), SPAN (0.5), PRIOR=1 (hand the unshifted pick
// to the shifted runs as last tick's box, as the phone does: the tracking
// path), SUPPORT=0 (no working crop), TUNE (JSON over PickTuning), VERBOSE=1
// (a line per frame), NOSHIFT=1 (skip the stability runs, 7x faster).
// Baselines (10-15 night): 10 noon frames 2/10 correct, mean IoU 0.818,
// shift move median 13.3 %; 18 frames 3/18, 0.732, 10.6 %. 10-16 (new picker,
// KEEP=10 PRIOR=1): 4/18, 0.756, shift move median 0.9 % p75 3.0 %, 39 ms;
// see docs/STATE.md.
import { createRequire } from "node:module";
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const require = createRequire(import.meta.url);
const sharp = require("sharp");
const pq = await import(new URL("../../src/lib/photoQuality.ts", import.meta.url).href);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DUMPS = path.resolve(".outline-dumps");
const labels = JSON.parse(readFileSync(process.env.LABELS ?? path.join(HERE, "labels.json"), "utf8"));
const filter = process.argv[2] ?? "";
const PATCH = +(process.env.PATCH ?? 110);
const SPAN = +(process.env.SPAN ?? 0.5);
const MIN = +(process.env.MIN ?? 20);
const KEEP = +(process.env.KEEP ?? 6);
const PRIOR = process.env.PRIOR === "1";
// SUPPORT=0 leaves the working crop out (corner scores + geometry only); TUNE='{"cap":60,...}' overrides PickTuning knobs.
const SUPPORT = process.env.SUPPORT !== "0";
const TUNE = process.env.TUNE ? JSON.parse(process.env.TUNE) : {};
const SHIFTS = [[-4, 0], [4, 0], [0, -4], [0, 4], [-8, 0], [8, 0]];
// NOISE=σ adds Gaussian grey noise (seeded, so runs repeat) to the patches of
// the SHIFTED runs only: a live tick is a new frame, not the same frame
// shifted, and the candidate list changes under sensor noise (10-16: the
// phone's tracked box moved 4.5 % a tick while this bench said 0.9 %).
const NOISE = +(process.env.NOISE ?? 0);
let seed = 12345;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const addNoise = (gray, sigma) => { if (!sigma) return gray; for (let i = 0; i < gray.length; i++) gray[i] = Math.max(0, Math.min(255, Math.round(gray[i] + gauss() * sigma))); return gray; };
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && f.includes(filter) && (filter || labels[f.slice(11, 23)])).sort();

// TRACK=1: the shifted runs carry the unshifted pick over with trackCardCorners
// (patches centred on its corners, as the phone does), picking afresh only
// when the track is lost. TRACKTUNE='{"reach":0.04,"floor":15}' overrides TRACK_TUNING.
const TRACK = process.env.TRACK === "1";
const TRACKTUNE = process.env.TRACKTUNE ? JSON.parse(process.env.TRACKTUNE) : {};

async function patchesFor(img, FW, FH, g, dx, dy, centres) {
  const half = g.w * SPAN / 2;
  const scale = PATCH / (g.w * SPAN);
  const out = [];
  for (const [cx0, cy0] of centres ?? [[g.x, g.y], [g.x + g.w, g.y], [g.x + g.w, g.y + g.h], [g.x, g.y + g.h]]) {
    const cx = cx0 + dx, cy = cy0 + dy;
    const left = Math.max(0, Math.round(cx - half)), top = Math.max(0, Math.round(cy - half));
    const right = Math.min(FW, Math.round(cx + half)), bottom = Math.min(FH, Math.round(cy + half));
    const pw = Math.max(8, Math.round((right - left) * scale)), ph = Math.max(8, Math.round((bottom - top) * scale));
    const rgba = await img.clone().extract({ left, top, width: right - left, height: bottom - top }).resize(pw, ph, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    const gray = pq.toGray(rgba, pw * ph);
    out.push({ gray: dx || dy ? addNoise(gray, NOISE) : gray, pw, ph, ox: left, oy: top, scale });
  }
  return out;
}
const boxOf = (q) => { const xs = q.map((p) => p.x), ys = q.map((p) => p.y); return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]; };
const iouBox = ([l, r, t, b], [L, R, T, B]) => {
  const ix = Math.max(0, Math.min(r, R) - Math.max(l, L)), iy = Math.max(0, Math.min(b, B) - Math.max(t, T));
  const inter = ix * iy;
  return inter / ((r - l) * (b - t) + (R - L) * (B - T) - inter);
};
const med = (a) => { const s = [...a].sort((p, q) => p - q); return s.length ? s[Math.floor(s.length / 2)] : NaN; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : NaN; };

let n = 0, found = 0, labeled = 0, correct = 0, iouSum = 0, msSum = 0, tracks = 0, shifts = 0;
const lostWhy = {};
const moves = [], perCorner = [[], [], [], []], wrongs = [];
for (const f of files) {
  const stamp = f.replace(".json", "");
  const meta = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!meta.crop) continue;
  const { sx, sy, sw, sh, w, h } = meta.crop;
  const g = meta.geometry.video;
  const img = sharp(path.join(DUMPS, `${stamp}.jpg`));
  const { width: FW, height: FH } = await img.metadata();
  const toCrop = (c) => ({ x: ((c.x - sx) / sw) * w, y: ((c.y - sy) / sh) * h });
  // The working crop as CameraCapture draws it (224 wide, a quarter-guide past the guide each side).
  let support = null;
  if (SUPPORT) {
    const rgba = await img.clone().extract({ left: Math.round(sx), top: Math.round(sy), width: Math.round(sw), height: Math.round(sh) }).resize(w, h, { fit: "fill" }).ensureAlpha().raw().toBuffer();
    support = { gray: pq.toGray(rgba, w * h), w, h, sx, sy, sw, sh };
  }
  const run = async (dx, dy, prefer, preferScores) => {
    const out = (p, tracked) => ({ corners: p.quad.corners.map(toCrop), frame: p.quad.corners, scores: p.fixes.map((x) => (x.score === -Infinity ? 0 : x.score)), support: p.support, tracked });
    if (TRACK && prefer) {
      // The prior is from the unshifted frame; the shifted patches sit round it, as the phone's do round last tick's corners.
      const patches = await patchesFor(img, FW, FH, g, dx, dy, prefer.map((p) => [p.x, p.y]));
      const t0 = performance.now();
      const why = { reason: "" };
      const track = pq.trackCardCorners(patches, prefer, g.w, FW, FH, { support, tune: TUNE, track: TRACKTUNE, lastScores: preferScores ?? null, why });
      if (track) return { ms: performance.now() - t0, pick: out(track, true) };
      const key = why.reason.split(" ").slice(0, 2).join(" ");
      lostWhy[key] = (lostWhy[key] ?? 0) + 1;
    }
    const patches = await patchesFor(img, FW, FH, g, dx, dy);
    const t0 = performance.now();
    const cands = pq.cardCornerCandidates(patches, g.w, KEEP);
    // With TRACK the last box only breaks ties here (trackReach 0), as on the phone.
    const pick = pq.pickCardCorners(cands, MIN, FW, FH, { prefer: prefer ?? null, support, tune: TRACK ? { ...TUNE, trackReach: 0 } : TUNE });
    const ms = performance.now() - t0;
    return { ms, pick: pick ? out(pick, false) : null };
  };
  const base = await run(0, 0, null);
  n++; msSum += base.ms;
  const short = stamp.slice(11, 23);
  const lab = labels[short];
  let line = `${short}  ${base.ms.toFixed(0).padStart(3)}ms  `;
  if (base.pick) {
    found++;
    line += `scores ${base.pick.scores.map((s) => s.toFixed(0)).join("/").padEnd(14)} sup ${base.pick.support.toFixed(2)}`;
  } else line += "none".padEnd(21);
  if (lab) {
    labeled++;
    const iou = base.pick ? iouBox(boxOf(base.pick.corners), lab) : 0;
    iouSum += iou;
    if (iou >= 0.9) correct++; else wrongs.push(short);
    line += ` IoU ${iou.toFixed(2)}${iou >= 0.9 ? " OK   " : " WRONG"}`;
    if (base.pick) {
      const [L, R, T, B] = lab;
      const labC = [[L, T], [R, T], [R, B], [L, B]];
      const d = base.pick.corners.map((p, i) => Math.hypot(p.x - labC[i][0], p.y - labC[i][1]) / meta.expect.w * 100);
      d.forEach((v, i) => perCorner[i].push(v));
      line += `  corner err % ${d.map((v) => v.toFixed(1).padStart(5)).join(" ")}`;
    }
  }
  if (base.pick && !process.env.NOSHIFT) {
    let worst = 0, lost = 0, held = 0;
    for (const [dx, dy] of SHIFTS) {
      const r = await run(dx, dy, PRIOR ? base.pick.frame : null, PRIOR ? base.pick.scores : null);
      if (!r.pick) { lost++; continue; }
      if (r.pick.tracked) held++;
      // The patches moved, not the card: any move of the box is jitter.
      worst = Math.max(worst, Math.max(...r.pick.corners.map((p, i) => Math.hypot(p.x - base.pick.corners[i].x, p.y - base.pick.corners[i].y))) / meta.expect.w * 100);
    }
    moves.push(worst);
    tracks += held;
    shifts += SHIFTS.length;
    line += `  shift move ${worst.toFixed(1).padStart(5)}%${lost ? ` (${lost} lost)` : ""}${TRACK ? ` held ${held}/${SHIFTS.length}` : ""}`;
  }
  if (process.env.VERBOSE) console.log(line);
}
console.log(`frames ${n}: found ${found}, ${(msSum / Math.max(1, n)).toFixed(1)} ms` +
  (labeled ? ` | labeled ${labeled}: correct ${correct}, mean IoU ${(iouSum / labeled).toFixed(3)}, corner err med % ${perCorner.map((c) => med(c).toFixed(1)).join("/")}` : "") +
  (moves.length ? ` | shift move med ${med(moves).toFixed(1)}% p75 ${pct(moves, 0.75).toFixed(1)}% >8%: ${moves.filter((m) => m > 8).length}/${moves.length}${TRACK ? ` held ${tracks}/${shifts}` : ""}` : "") +
  (wrongs.length ? `\nwrong: ${wrongs.join(" ")}` : "") +
  (TRACK && Object.keys(lostWhy).length ? `\ntrack lost: ${JSON.stringify(lostWhy)}` : ""));
