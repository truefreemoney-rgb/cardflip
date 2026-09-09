/**
 * eBay Marketplace Account Deletion signature check (lib/server/ebayNotification.ts).
 * Run: npm run test:ebaydeletion
 *
 * Pins: a body signed with a P-256 key verifies against that key in eBay's
 * newline-stripped PEM form; a tampered body, a different key, a bad or
 * missing header, a non-ECDSA alg, an RSA key and garbage base64 are all
 * refused (and never throw). Pure — no DB, no network; the route only adds
 * the key fetch and the 200-and-ignore on failure.
 */
import crypto from "node:crypto";
import {
  formatPublicKey,
  parseSignatureHeader,
  verifyEbaySignature,
} from "../src/lib/server/ebayNotification.ts";

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = publicKey.export({ type: "spki", format: "pem" });
// eBay hands the key back with the armour but no line breaks.
const ebayKey = { key: pem.replace(/\n/g, ""), algorithm: "ECDSA", digest: "SHA1" };

const body = JSON.stringify({
  metadata: { topic: "MARKETPLACE_ACCOUNT_DELETION", schemaVersion: "1.0" },
  notification: { notificationId: "n1", data: { username: "seller_1", userId: "ma8vp1jySJC" } },
});
function header(rawBody, key = privateKey, extra = {}) {
  const signature = crypto.sign("sha1", Buffer.from(rawBody), key).toString("base64");
  return Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "kid-1", signature, digest: "SHA1", ...extra })).toString("base64");
}

// --- pure verify -------------------------------------------------------------
check("formatPublicKey rebuilds a parseable PEM", crypto.createPublicKey(formatPublicKey(ebayKey.key)).asymmetricKeyType, "ec");
check("parseSignatureHeader decodes", parseSignatureHeader(header(body))?.kid, "kid-1");
check("parseSignatureHeader: garbage → null", parseSignatureHeader("not base64 json"), null);
check("parseSignatureHeader: missing → null", parseSignatureHeader(null), null);
check("parseSignatureHeader: kid with a path → null", parseSignatureHeader(Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "../x", signature: "AA==" })).toString("base64")), null);

check("valid signature accepted", verifyEbaySignature(body, header(body), ebayKey));
check("accepted with a pre-parsed header", verifyEbaySignature(body, parseSignatureHeader(header(body)), ebayKey));
check("accepted when the key omits algorithm/digest (defaults to ECDSA/SHA1)", verifyEbaySignature(body, header(body), { key: ebayKey.key }));
check("tampered body rejected", verifyEbaySignature(body.replace("seller_1", "seller_2"), header(body), ebayKey), false);
const other = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
check("signed by a different key rejected", verifyEbaySignature(body, header(body, other.privateKey), ebayKey), false);
check("missing header rejected", verifyEbaySignature(body, null, ebayKey), false);
check("missing key rejected", verifyEbaySignature(body, header(body), null), false);
check("alg != ecdsa rejected", verifyEbaySignature(body, header(body, privateKey, { alg: "rsa" }), ebayKey), false);
check("garbage signature rejected (no throw)", verifyEbaySignature(body, Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "k", signature: "!!!" })).toString("base64"), ebayKey), false);
const rsa = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
check("RSA key rejected", verifyEbaySignature(body, header(body), { key: rsa.publicKey.export({ type: "spki", format: "pem" }) }), false);
check("unparseable key rejected (no throw)", verifyEbaySignature(body, header(body), { key: "-----BEGIN PUBLIC KEY-----nope-----END PUBLIC KEY-----" }), false);
check("sha256 digest honoured when the key says so", verifyEbaySignature(body, Buffer.from(JSON.stringify({ alg: "ecdsa", kid: "k", signature: crypto.sign("sha256", Buffer.from(body), privateKey).toString("base64") })).toString("base64"), { key: ebayKey.key, digest: "SHA256" }));

console.log(failures === 0 ? "\nAll eBay deletion checks passed" : `\n${failures} eBay deletion check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
