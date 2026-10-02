// Which catalog picture links are dead. Read-only: asks each distinct
// image_url once (HEAD, GET when HEAD is refused) and lists the rows whose
// link does not answer 200 with an image.
//
//   node scripts/sweep-picture-links.mjs [--game yugioh] [--out file.json]
//
// Reads the local mirror (data/cardflip.db). Yu-Gi-Oh has no row with a
// blank picture, but its links were never checked (10-01): TCGplayer's CDN
// answers 403 for a product it has no scan of.
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@libsql/client";

const arg = (name, fallback) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback);
const game = arg("--game", "yugioh");
const out = arg("--out", path.join(process.cwd(), "backups", `dead-picture-links-${game}.json`));
const local = createClient({ url: "file:data/cardflip.db" });
const rows = (await local.execute({ sql: "SELECT id, name, set_code, collector_number, image_url FROM tcg_cards WHERE game = ? AND COALESCE(image_url, '') <> ''", args: [game] })).rows;
const byUrl = new Map();
for (const r of rows) {
  if (!byUrl.has(r.image_url)) byUrl.set(r.image_url, []);
  byUrl.get(r.image_url).push(r);
}
console.log(`${game}: ${rows.length} rows, ${byUrl.size} distinct links`);

async function status(url) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(15000) });
      if (res.status === 405 || res.status === 501) res = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (res.status === 429 || res.status >= 500) { await new Promise((r) => setTimeout(r, 2000 * (attempt + 1))); continue; }
      const type = res.headers.get("content-type") ?? "";
      // optcgapi serves TCGplayer's "image not available" drawing (an SVG, 31 KB)
      // as image/jpeg under a .jpg name: a small answer is opened and looked at.
      const size = Number(res.headers.get("content-length") ?? 0);
      if (res.ok && type.startsWith("image/") && game === "onepiece" && size > 0 && size < 40000) {
        const body = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(15000) })).arrayBuffer());
        if (body.subarray(0, 1).toString("latin1") === "<") return "placeholder";
      }
      return res.ok && type.startsWith("image/") ? 200 : res.status === 200 ? `200 ${type}` : res.status;
    } catch (err) {
      if (attempt === 2) return `error ${String(err.message ?? err).slice(0, 40)}`;
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return "gave up";
}

const urls = [...byUrl.keys()];
const dead = [];
let next = 0;
let checked = 0;
await Promise.all(Array.from({ length: 24 }, async () => {
  while (next < urls.length) {
    const url = urls[next++];
    const s = await status(url);
    if (s !== 200) for (const r of byUrl.get(url)) dead.push({ id: r.id, name: r.name, set_code: r.set_code, collector_number: r.collector_number, image_url: url, status: s });
    if (++checked % 5000 === 0) console.log(`  ${checked}/${urls.length} checked, ${dead.length} dead rows so far`);
  }
}));
fs.writeFileSync(out, JSON.stringify(dead, null, 1));
// The links alone, committed: sync-yugioh.mjs and repoint-dead-pictures.mjs read it.
fs.writeFileSync(path.join(process.cwd(), "scripts", `dead-pictures-${game}.json`), JSON.stringify([...new Set(dead.map((d) => d.image_url))].sort(), null, 0));
const byStatus = {};
for (const d of dead) byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
console.log(`${dead.length} rows with a dead link (${Object.entries(byStatus).map(([k, v]) => `${k}: ${v}`).join(", ") || "none"}) -> ${out}`);
