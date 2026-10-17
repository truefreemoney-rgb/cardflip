/**
 * #33 input checks (10-16 audit): vision photos must be real pictures (type read from the bytes), the tiebreak id list
 * is bounded, and a bad push subscription is a 400, not a 500.
 * Run: npm run test:inputchecks
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-inputchecks-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { readImageInput, MAX_IMAGE_BYTES } = await import(at("lib/server/imageInput.ts"));
const { pushSubscriptionProblem } = await import(at("lib/server/push.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const b64 = (bytes) => Buffer.from([...bytes, ...new Array(40).fill(0)]).toString("base64");
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0]);
const PNG = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = b64([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const GIF = b64([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const pick = (r) => (r.ok ? r.mediaType : `${r.status} ${r.error}`);

check("jpeg bytes -> image/jpeg", pick(readImageInput(JPEG)), "image/jpeg");
check("png bytes -> image/png (whatever label the client sent)", pick(readImageInput(PNG)), "image/png");
check("webp bytes -> image/webp", pick(readImageInput(WEBP)), "image/webp");
check("gif bytes -> image/gif", pick(readImageInput(GIF)), "image/gif");
check("missing -> 400", pick(readImageInput(undefined)), "400 Missing image");
check("a number -> 400 (was cast to a string)", pick(readImageInput(12345)), "400 Missing image");
check("an object -> 400", pick(readImageInput({ length: 5 })), "400 Missing image");
check("not base64 -> 400", pick(readImageInput("this is not base64 at all!!")), "400 That isn't a picture");
check("base64 of text -> 400", pick(readImageInput(Buffer.from("hello world, definitely not a picture").toString("base64"))), "400 That isn't a picture");
check("a data: URL prefix is not stripped -> 400 (the app sends bare base64)", pick(readImageInput(`data:image/jpeg;base64,${JPEG}`)), "400 That isn't a picture");
check("over 5 MB -> 413", pick(readImageInput("A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 8))), "413 Image too large");

const fcm = "https://fcm.googleapis.com/fcm/send/abc";
const KEY = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
check("push: a real-shaped subscription is fine", pushSubscriptionProblem({ endpoint: fcm, keys: { p256dh: KEY, auth: "tBHItJI5svbpez7KI4CCXg" } }), null);
check("push: not a push service -> problem", pushSubscriptionProblem({ endpoint: "https://evil.example/x", keys: { p256dh: KEY, auth: "a" } }), "Bad push endpoint");
check("push: not a URL -> problem", pushSubscriptionProblem({ endpoint: "nonsense", keys: { p256dh: KEY, auth: "a" } }), "Bad push endpoint");
check("push: key with junk characters -> problem", pushSubscriptionProblem({ endpoint: fcm, keys: { p256dh: "<script>", auth: "a" } }), "Bad push keys");
check("push: huge key -> problem", pushSubscriptionProblem({ endpoint: fcm, keys: { p256dh: "A".repeat(5000), auth: "a" } }), "Bad push keys");

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
for (const r of ["app/api/vision/scan/route.ts", "app/api/vision/trial/route.ts", "app/api/vision/tiebreak/route.ts"]) {
  const s = src(r);
  check(`${r}: photo goes through readImageInput, no client mediaType`, s.includes("readImageInput(body?.image)") && !s.includes("body?.mediaType"));
}
const scan = src("app/api/vision/scan/route.ts");
check("scan: the photo is checked before a scan is reserved", scan.indexOf("readImageInput(body?.image)") < scan.indexOf("reserveScan("));
check("tiebreak: more than 6 ids is refused", src("app/api/vision/tiebreak/route.ts").includes("rawIds.length > 6"));
check("push POST answers 400 on a bad subscription", src("app/api/push/route.ts").includes("if (pushSubscriptionProblem(sub))"));

console.log(failures === 0 ? "\nAll input checks passed" : `\n${failures} input check(s) failed`);
process.exitCode = failures === 0 ? 0 : 1;
