// One-off: check PSA public API quota state from this (non-Vercel) IP.
// Reads PSA_API_TOKEN from .env.local / .env.vercel.local; never prints it.
import { readFileSync } from 'node:fs';

let token = process.env.PSA_API_TOKEN;
for (const f of ['.env.local', '.env.vercel.local']) {
  if (token) break;
  try {
    const m = readFileSync(f, 'utf8').match(/^PSA_API_TOKEN=(.+)$/m);
    if (m) token = m[1].trim().replace(/^"|"$/g, '');
  } catch {}
}
if (!token) {
  console.log('NO TOKEN FOUND in env or .env files');
  process.exit(1);
}

const res = await fetch('https://api.psacard.com/publicapi/cert/GetByCertNumber/28400235', {
  headers: { Authorization: `Bearer ${token}` },
});
console.log('status:', res.status);
for (const [k, v] of res.headers) {
  if (/rate|limit|quota|remaining|retry/i.test(k)) console.log(k + ':', v);
}
const body = await res.text();
console.log('body (first 300):', body.slice(0, 300));
