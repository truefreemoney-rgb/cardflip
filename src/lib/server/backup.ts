import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { pipeline } from "node:stream/promises";
import { db, dbIsRemote } from "@/lib/db";

/**
 * Nightly off-volume backup of the SQLite database to the Tigris bucket
 * (`flyctl storage create` set AWS_* + BUCKET_NAME as app secrets). The DB
 * lives on a single Fly volume with no other copy, so this is the disaster
 * story: a consistent `VACUUM INTO` snapshot, gzipped, uploaded to
 * `nightly/cardflip-<weekday>.db.gz` (7 rotating copies), then server-side
 * copied to `monthly/cardflip-<yyyy-mm>.db.gz` (last backup of each month
 * survives). No SDK — Tigris speaks S3, and a PUT/copy needs only SigV4.
 */

const env = () => ({
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
  bucket: process.env.BUCKET_NAME,
  keyId: process.env.AWS_ACCESS_KEY_ID,
  secret: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || "auto",
});

export function backupConfigured(): boolean {
  // VACUUM INTO needs the database to be a local file — on Turso this whole
  // mechanism is retired in favour of the service's point-in-time restore.
  if (dbIsRemote) return false;
  const e = env();
  return Boolean(e.endpoint && e.bucket && e.keyId && e.secret);
}

function hmac(key: crypto.BinaryLike, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data).digest();
}
function sha256Hex(data: crypto.BinaryLike): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

async function s3Request(
  method: "PUT" | "HEAD" | "DELETE",
  key: string,
  body?: Buffer,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  const { endpoint, bucket, keyId, secret, region } = env();
  if (!endpoint || !bucket || !keyId || !secret) throw new Error("backup: AWS_*/BUCKET_NAME env not set");
  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const date = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body ?? "");

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const signedNames = Object.keys(headers).sort();
  const canonicalHeaders = signedNames.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = signedNames.join(";");
  // Key is our own ("nightly/..."), so encodeURI covers the path segments.
  const canonicalRequest = [method, encodeURI(url.pathname), "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${date}/${region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), "s3"), "aws4_request");
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body ? new Uint8Array(body) : undefined,
  });
  return res;
}

export async function putObject(key: string, body: Buffer, contentType = "application/gzip"): Promise<void> {
  const res = await s3Request("PUT", key, body, { "content-type": contentType });
  if (!res.ok) throw new Error(`backup: PUT ${key} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

export async function deleteObject(key: string): Promise<void> {
  const res = await s3Request("DELETE", key);
  if (!res.ok && res.status !== 404) throw new Error(`backup: DELETE ${key} failed: ${res.status}`);
}

/** Server-side copy inside the bucket — no re-upload of the payload. */
export async function copyObject(fromKey: string, toKey: string): Promise<void> {
  const { bucket } = env();
  const res = await s3Request("PUT", toKey, undefined, { "x-amz-copy-source": `/${bucket}/${fromKey}` });
  if (!res.ok) throw new Error(`backup: copy ${fromKey} -> ${toKey} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** Consistent snapshot of the live DB, gzipped to a temp file; returns its path. */
export async function makeSnapshotGz(): Promise<string> {
  const dir = path.join(process.cwd(), "data");
  const raw = path.join(dir, `backup-tmp-${process.pid}.db`);
  const gz = `${raw}.gz`;
  fs.rmSync(raw, { force: true });
  fs.rmSync(gz, { force: true });
  try {
    await db.exec(`VACUUM INTO '${raw.replace(/'/g, "''")}'`);
    await pipeline(fs.createReadStream(raw), zlib.createGzip({ level: 6 }), fs.createWriteStream(gz));
    return gz;
  } finally {
    fs.rmSync(raw, { force: true });
  }
}

export interface BackupResult {
  key: string;
  monthlyKey: string;
  bytes: number;
}

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export async function runNightlyBackup(now = new Date()): Promise<BackupResult> {
  const gz = await makeSnapshotGz();
  try {
    const body = fs.readFileSync(gz);
    const key = `nightly/cardflip-${WEEKDAYS[now.getUTCDay()]}.db.gz`;
    const monthlyKey = `monthly/cardflip-${now.toISOString().slice(0, 7)}.db.gz`;
    await putObject(key, body);
    await copyObject(key, monthlyKey);
    return { key, monthlyKey, bytes: body.length };
  } finally {
    fs.rmSync(gz, { force: true });
  }
}
