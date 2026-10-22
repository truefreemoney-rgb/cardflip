// The first vision read gets a 1,024 px picture (src/lib/server/vision.ts firstReadPicture, 10-22): a phone photo
// shrinks on its long edge, a small photo passes through untouched, a PNG comes back as JPEG, junk bytes fall back
// to the photo as sent. No API call. Run: npm run test:firstreadsize
import assert from "node:assert/strict";
import sharp from "sharp";

const { firstReadPicture, FIRST_READ_MAX_EDGE } = await import(new URL("../src/lib/server/vision.ts", import.meta.url).href);
assert.equal(FIRST_READ_MAX_EDGE, 1024, "first read long edge");

const dims = async (b64) => { const m = await sharp(Buffer.from(b64, "base64")).metadata(); return [m.width, m.height, m.format]; };
const make = (w, h, format = "jpeg") => sharp({ create: { width: w, height: h, channels: 3, background: { r: 200, g: 40, b: 40 } } })[format]().toBuffer();

let n = 0;
const check = (label, got, want) => { assert.deepEqual(got, want, label); n++; console.log("  PASS ", label); };

// Portrait phone photo, 1146x1600 (what the scanner sends): long edge -> 1024, width scaled, JPEG.
const tall = (await make(1146, 1600)).toString("base64");
const a = await firstReadPicture(tall, "image/jpeg");
check("1146x1600 photo shrinks to 733x1024 JPEG", [...(await dims(a.base64)), a.mediaType], [733, 1024, "jpeg", "image/jpeg"]);
assert.ok(a.base64.length < tall.length, "the shrunk picture is smaller");

// Landscape, 1600x1146 -> 1024x733.
const wide = (await make(1600, 1146)).toString("base64");
check("1600x1146 photo shrinks to 1024x733", (await dims((await firstReadPicture(wide, "image/jpeg")).base64)).slice(0, 2), [1024, 733]);

// Already small: untouched bytes, media type kept.
const small = (await make(800, 1000)).toString("base64");
const s = await firstReadPicture(small, "image/jpeg");
check("800x1000 photo passes through untouched", [s.base64 === small, s.mediaType], [true, "image/jpeg"]);

// Exactly the limit: untouched too (never enlarged, never re-encoded for nothing).
const edge = (await make(700, 1024)).toString("base64");
check("1024 long edge passes through", (await firstReadPicture(edge, "image/jpeg")).base64 === edge, true);

// A big PNG comes back as a JPEG at 1024.
const png = (await make(1200, 1600, "png")).toString("base64");
const p = await firstReadPicture(png, "image/png");
check("1200x1600 PNG -> 768x1024 JPEG", [...(await dims(p.base64)), p.mediaType], [768, 1024, "jpeg", "image/jpeg"]);

// Bytes sharp cannot read: the photo goes as sent (a bad resize must never fail a scan).
const junk = Buffer.from("not a picture at all").toString("base64");
const j = await firstReadPicture(junk, "image/jpeg");
check("unreadable bytes fall back to the photo as sent", [j.base64 === junk, j.mediaType], [true, "image/jpeg"]);

console.log(`\n${n} passing`);
