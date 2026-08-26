// Copy every card photo from data/photos/ into the Tigris S3 bucket.
//
//   AWS_ENDPOINT_URL_S3=... BUCKET_NAME=... AWS_ACCESS_KEY_ID=... \
//   AWS_SECRET_ACCESS_KEY=... node scripts/migrate-photos.mjs [--dry-run]
//
// One-time cutover step for the Fly -> Vercel migration: photos live on the
// Fly volume today and on Tigris after (keys `photos/<id>.jpg`, matching
// lib/server/cardPhotos.ts). Idempotent — a re-run just overwrites the same
// keys. Run with the photo dir copied local (like the DB re-seed), or on the
// Fly machine itself since the AWS_* secrets are already set there.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const env = {
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  bucket: process.env.BUCKET_NAME,
  keyId: process.env.AWS_ACCESS_KEY_ID,
  secret: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "auto",
};
if (!env.endpoint || !env.bucket || !env.keyId || !env.secret) {
  console.error("Set AWS_ENDPOINT_URL_S3, BUCKET_NAME, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");

const PHOTO_DIR = process.env.PHOTO_SOURCE ?? path.join(process.cwd(), "data", "photos");

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();
const sha256Hex = (data) => crypto.createHash("sha256").update(data).digest("hex");

// Same hand-rolled SigV4 PUT as src/lib/server/backup.ts (kept dependency-free).
async function putObject(key, body) {
  const url = new URL(`${env.endpoint}/${env.bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const headers = {
    "content-type": "image/jpeg",
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = signedNames.join(";");
  const canonicalRequest = ["PUT", encodeURI(url.pathname), "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${env.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${env.secret}`, date), env.region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${env.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: new Uint8Array(body),
  });
  if (!res.ok) throw new Error(`PUT ${key} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

const files = fs.existsSync(PHOTO_DIR)
  ? fs.readdirSync(PHOTO_DIR).filter((f) => /^[0-9a-f-]{36}\.jpg$/i.test(f))
  : [];
console.log(`${files.length} photo(s) in ${PHOTO_DIR}${dryRun ? " (dry run)" : ""}`);

let done = 0;
let failed = 0;
for (const f of files) {
  const key = `photos/${f.toLowerCase()}`;
  if (dryRun) {
    console.log(`would PUT ${key}`);
    continue;
  }
  try {
    await putObject(key, fs.readFileSync(path.join(PHOTO_DIR, f)));
    done++;
    if (done % 25 === 0) console.log(`${done}/${files.length}...`);
  } catch (err) {
    failed++;
    console.error(`FAILED ${key}: ${err.message}`);
  }
}
console.log(`done: ${done} uploaded, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
