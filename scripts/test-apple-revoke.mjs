// Sign in with Apple revoke helpers (lib/server/appleAuth.ts, 10-31): a throwaway P-256 key stands in for
// the .p8, then the sealed refresh token round-trips, a wrong key cannot open it, and no key = not configured.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/test-apple-revoke.mjs
import { generateKeyPairSync } from "node:crypto";
import assert from "node:assert/strict";

const pem = () => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const keyA = { teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem() };
const keyB = { ...keyA, privateKey: pem() };

delete process.env.APPLE_TEAM_ID;
const mod = await import("../src/lib/server/appleAuth.ts");
assert.equal(mod.appleRevokeConfigured(), false, "no env = not configured");

const sealed = mod.sealAppleToken("r.refresh-token-123", keyA);
assert.match(sealed, /^v1\./);
assert.equal(mod.openAppleToken(sealed, keyA), "r.refresh-token-123");
assert.equal(mod.openAppleToken(sealed, keyB), null, "another key cannot open it");
assert.equal(mod.openAppleToken("garbage", keyA), null);

process.env.APPLE_TEAM_ID = keyA.teamId;
process.env.APPLE_SIWA_KEY_ID = keyA.keyId;
process.env.APPLE_SIWA_PRIVATE_KEY = keyA.privateKey.replace(/\n/g, "\\n"); // how Vercel holds it, one line
assert.equal(mod.appleRevokeConfigured(), true);
assert.equal(mod.openAppleToken(mod.sealAppleToken("x")), "x", "env key with \\n escapes works");
console.log("apple revoke helpers: 7 checks passed");
