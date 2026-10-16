// Tick-to-tick jitter of the corner finder, from the ticks[] saved in each
// outline dump (crop px quads + the "corners a/b/c/d" score string).
// node tick-jitter.mjs [stampFilter]   (default = the post-fix run 10-16T02-37..39)
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const DUMPS = "C:/Users/Chris/cardflip/.outline-dumps";
const filter = process.argv[2] ?? "2026-10-16T02-3";
// Comma list of substrings, so one run covers a round that spans minutes ("04-21,04-22,04-23").
const parts = filter.split(",");
const files = (await readdir(DUMPS)).filter((f) => f.endsWith(".json") && parts.some((p) => f.includes(p))).sort();
const NAMES = ["TL", "TR", "BR", "BL"];
const all = []; // every tick in time order, with the dump's guide (expect) for scale
for (const f of files) {
  const m = JSON.parse(await readFile(path.join(DUMPS, f), "utf8"));
  if (!m.ticks || !m.expect) continue;
  for (const t of m.ticks) all.push({ ...t, gw: m.expect.w, gh: m.expect.h, dump: f.slice(11, 23) });
}
all.sort((a, b) => a.t - b.t);
const med = (a) => { if (!a.length) return NaN; const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
const reasons = {};
const scores = [[], [], [], []];
const moves = [[], [], [], []]; // per corner, |delta| / guide width, consecutive ticks both with a quad
const movesByScore = [[], [], [], []].map(() => ({ low: [], high: [] }));
let both = 0, gaps = 0, withQuad = 0, biggestMover = [0, 0, 0, 0];
let prev = null;
for (const t of all) {
  const key = (t.reason ?? "").split(" ")[0];
  reasons[key] = (reasons[key] ?? 0) + 1;
  let sc = null;
  if (key === "corners") {
    sc = (t.reason.split(" ")[1] ?? "").split("/").map(Number);
    sc.forEach((v, i) => scores[i].push(v));
  }
  if (t.quad) withQuad++;
  if (prev && prev.quad && t.quad && t.t - prev.t < 500) {
    both++;
    const ds = t.quad.map((p, i) => Math.hypot(p.x - prev.quad[i].x, p.y - prev.quad[i].y) / t.gw);
    ds.forEach((d, i) => {
      moves[i].push(d);
      if (sc) (sc[i] < 40 ? movesByScore[i].low : movesByScore[i].high).push(d);
    });
    biggestMover[ds.indexOf(Math.max(...ds))]++;
  } else if (prev && t.t - prev.t >= 500) gaps++;
  prev = t;
}
console.log(`dumps ${files.length}, ticks ${all.length}, with quad ${withQuad}, consecutive pairs ${both}, time gaps ${gaps}`);
console.log("reasons:", JSON.stringify(reasons));
console.log("\nper corner (move = corner displacement between consecutive ticks, % of guide width):");
for (let i = 0; i < 4; i++) {
  const m = moves[i];
  console.log(`${NAMES[i]}  score med ${med(scores[i]).toFixed(0)} p25 ${pct(scores[i], 0.25).toFixed(0)} p75 ${pct(scores[i], 0.75).toFixed(0)} | move med ${(100 * med(m)).toFixed(1)}% p75 ${(100 * pct(m, 0.75)).toFixed(1)}% p90 ${(100 * pct(m, 0.9)).toFixed(1)}% | >5%: ${(100 * m.filter((d) => d > 0.05).length / m.length).toFixed(0)}% of ticks | biggest mover ${biggestMover[i]}x | move when score<40 med ${(100 * med(movesByScore[i].low)).toFixed(1)}% (n${movesByScore[i].low.length}) vs >=40 ${(100 * med(movesByScore[i].high)).toFixed(1)}% (n${movesByScore[i].high.length})`);
}
// Whole-quad view: how often does ANY corner jump > 5 % / > 10 % between ticks.
let any5 = 0, any10 = 0;
for (let k = 0; k < moves[0].length; k++) {
  const mx = Math.max(moves[0][k], moves[1][k], moves[2][k], moves[3][k]);
  if (mx > 0.05) any5++;
  if (mx > 0.10) any10++;
}
console.log(`\nany corner > 5%: ${(100 * any5 / both).toFixed(0)}% of pairs; > 10%: ${(100 * any10 / both).toFixed(0)}%`);
// Per dump: the spread (max-min) of each corner over the dump's own ticks, so a stable-vs-wild dump is visible.
console.log("\nper dump: corner spread over its ticks (% guide w), quads/ticks, median scores");
const byDump = {};
for (const t of all) (byDump[t.dump] ??= []).push(t);
for (const [d, ts] of Object.entries(byDump)) {
  const qs = ts.filter((t) => t.quad);
  const spread = [0, 1, 2, 3].map((i) => {
    const xs = qs.map((t) => t.quad[i].x), ys = qs.map((t) => t.quad[i].y);
    return qs.length ? Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / ts[0].gw : NaN;
  });
  const scs = [0, 1, 2, 3].map((i) => med(ts.filter((t) => (t.reason ?? "").startsWith("corners")).map((t) => Number(t.reason.split(" ")[1].split("/")[i]))));
  console.log(`${d}  ${qs.length}/${ts.length}  spread ${spread.map((s) => (100 * s).toFixed(0).padStart(3)).join(" ")}  scores ${scs.map((s) => String(s).padStart(3)).join(" ")}`);
}
