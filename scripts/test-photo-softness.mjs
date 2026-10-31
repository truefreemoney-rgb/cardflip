// Blur gate check (10-30, lib/server/photoSoftness.ts): every one of Chris's own scan photos passes the gate, and the
// same photos blurred to a Kindle-class camera's softness are refused. Owner photos only, no API key, writes nothing.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/test-photo-softness.mjs
import fs from "node:fs";
import sharp from "sharp";
import { createClient } from "@libsql/client";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const P = await import("../src/lib/server/photoSoftness.ts");
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const rows = (await db.execute({ sql: `SELECT p.bytes, c.game, c.card_name FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} ORDER BY c.created_at DESC LIMIT 60`, args: OWNER_ARGS })).rows;
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log("FAIL", what); } };
let minText = Infinity, minNum = Infinity, maxBlurText = 0, maxBlurNum = 0;
for (const r of rows) {
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const s = await P.photoSoftness(bytes.toString("base64"));
  check(s && !P.tooSoft(s), `${r.game} ${r.card_name}: a real scan refused (${JSON.stringify(s)})`);
  if (s) { minText = Math.min(minText, s.text); minNum = Math.min(minNum, s.number); }
  // A Kindle-class soft photo: the same picture shrunk to ~980 px and blurred (the real ones scored 42-194 / 62-214).
  const soft = await sharp(bytes).resize({ width: 980 }).blur(3.2).jpeg({ quality: 80 }).toBuffer();
  const b = await P.photoSoftness(soft.toString("base64"));
  check(P.tooSoft(b), `${r.game} ${r.card_name}: a blurred copy passed (${JSON.stringify(b)})`);
  if (b) { maxBlurText = Math.max(maxBlurText, b.text); maxBlurNum = Math.max(maxBlurNum, b.number); }
}
check(P.tooSoft(null) === false, "null score must let the read decide");
check(P.BLURRY_MESSAGE.includes("Capture"), "message names the Capture tap");
console.log(`real photos: softest text ${minText}, softest number ${minNum} (gate ${P.SOFT_MAX}) | blurred copies: sharpest text ${maxBlurText}, sharpest number ${maxBlurNum}`);
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
