/**
 * Art Series picture fingerprint (lib/server/artHash.ts). Run: npm run test:arthash
 *
 * Pins: the hash is stable across resize + JPEG + a phone-ish inset, two
 * different pictures are far apart, and matchArtSeries names the mirror row
 * for a re-encoded copy of its own picture while refusing a stranger.
 * Throwaway-db trick as in test-mirror.mjs.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-arthash-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { db } = await import(at("lib/db.ts"));
const { dHash, hamming, matchArtSeries, ART_MATCH_MAX_DISTANCE } = await import(at("lib/server/artHash.ts"));
const sharp = (await import("sharp")).default;

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

// Two synthetic "paintings": a diagonal gradient with a dark blob, and a
// horizontal gradient with a bright blob — deterministic, no fixtures.
async function painting(kind) {
  const w = 480, h = 680;
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const v = kind === "a" ? Math.round(((x + y) / (w + h)) * 255) : Math.round((x / w) * 255);
      const blob = kind === "a" ? (x - 200) ** 2 + (y - 300) ** 2 < 90 ** 2 : (x - 300) ** 2 + (y - 400) ** 2 < 110 ** 2;
      const c = blob ? (kind === "a" ? 20 : 240) : v;
      px[i] = c; px[i + 1] = (c + 40) % 256; px[i + 2] = 255 - c;
    }
  }
  return sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer();
}

const a = await painting("a");
const b = await painting("b");
const aSmallJpeg = await sharp(a).resize(300).jpeg({ quality: 70 }).toBuffer();
const aFramed = await sharp(a).extend({ top: 30, bottom: 30, left: 20, right: 20, background: "#e8e8e8" }).jpeg().toBuffer();

const ha = await dHash(a);
check("hash is 16 hex chars", /^[0-9a-f]{16}$/.test(ha));
check("same picture, resized + JPEG: within the match distance", hamming(ha, await dHash(aSmallJpeg)) <= ART_MATCH_MAX_DISTANCE);
check("different pictures: far apart", hamming(ha, await dHash(b)) > ART_MATCH_MAX_DISTANCE);

await db.prepare(
  `INSERT INTO mtg_cards (id, name, set_code, set_name, collector_number, set_release_date, price_usd, synced_at, type_line, art_hash)
   VALUES ('altc-a', 'Fell Beast''s Shriek', 'altc', 'Tales of Middle-earth Art Series', '18', '2023-06-23', 1, 0, 'Card', ?),
          ('altc-b', 'Aragorn, Hornburg Hero', 'altc', 'Tales of Middle-earth Art Series', '2', '2023-06-23', 1, 0, 'Card', ?)`,
).run(ha, await dHash(b));

check("re-encoded copy of a mirror picture is matched to its row",
  (await matchArtSeries(aSmallJpeg))?.id ?? null, "altc-a");
check("a framed copy (light border around the picture) still matches via the inset hashes",
  (await matchArtSeries(aFramed))?.id ?? null, "altc-a");
const noise = await sharp({ create: { width: 400, height: 560, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).jpeg().toBuffer();
check("a stranger is refused rather than guessed", await matchArtSeries(noise), null);

console.log(failures === 0 ? "\nAll art-hash checks passed" : `\n${failures} art-hash check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
