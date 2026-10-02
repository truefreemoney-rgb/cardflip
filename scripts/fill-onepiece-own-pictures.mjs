// One Piece promo printings that no feed has a picture of (TCGplayer's CDN
// answers 403, Bandai's card list has no file): the six Welcome Pack Vol. 1
// cards. Found through Google Images on CardTrader's catalog (10-01), each one
// checked against eBay seller photos, copied into public/catalog/onepiece
// (480px, never hotlinked).
//
//   node scripts/fill-onepiece-own-pictures.mjs
//
// Then push, and once the deploy serves the files:
//   node scripts/fill-missing-pictures.mjs --game onepiece --prod
// (its HAND_PRODUCTS map points the rows at https://cardflip.io/catalog/onepiece/<file>).
// CardTrader's DON!! Boa Hancock (EB-03) pictures are the Japanese print: left out.
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const DIR = path.join(process.cwd(), "public", "catalog", "onepiece");
const HEADERS = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" };
const SOURCE = "https://www.cardtrader.com/uploads/blueprints/image";
const PICTURES = {
  "OP05-030-welcome-pack-vol-1.jpg": `${SOURCE}/328160/donquixote-rosinante-welcome-pack-vol-1-promos.png`,
  "OP05-004-welcome-pack-vol-1.jpg": `${SOURCE}/328157/emporio-ivankov-welcome-pack-vol-1-promos.png`,
  "OP05-070-welcome-pack-vol-1.jpg": `${SOURCE}/328155/fra-nosuke-welcome-pack-vol-1-promos.png`,
  "OP05-042-welcome-pack-vol-1.jpg": `${SOURCE}/328158/issho-welcome-pack-vol-1-promos.png`,
  "OP05-105-welcome-pack-vol-1.jpg": `${SOURCE}/328159/satori-welcome-pack-vol-1-promos.png`,
  "OP04-087-welcome-pack-vol-1.jpg": `${SOURCE}/328156/trafalgar-law-welcome-pack-vol-1-promos.png`,
};

fs.mkdirSync(DIR, { recursive: true });
for (const [file, url] of Object.entries(PICTURES)) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(30000) });
  if (!res.ok) { console.log(`  !! ${file}: ${res.status}`); process.exitCode = 1; continue; }
  await sharp(Buffer.from(await res.arrayBuffer())).resize({ width: 480, withoutEnlargement: true }).jpeg({ quality: 78, mozjpeg: true }).toFile(path.join(DIR, file));
  console.log(`  ${file} ${(fs.statSync(path.join(DIR, file)).size / 1024).toFixed(0)} KB`);
}
