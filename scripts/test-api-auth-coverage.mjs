/**
 * API auth coverage: every src/app/api route file that mutates (POST/PUT/PATCH/DELETE), plus every
 * /api/admin/** GET, must call a known auth gate, or be on the ALLOWLIST below with a reason.
 * A new route that forgets its gate fails here instead of shipping open. Static scan, no DB.
 * Run: npm run test:apiauth
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const API_DIR = join(process.cwd(), "src", "app", "api");

/** Calls that count as an auth gate (matched as identifier followed by "("). */
const AUTH_CALLS = [
  "requireUser",
  "requireAdminOwner",
  "requireAdmin",
  "requireAdminPanel",
  "adminRole",
  "opsKeyOk",
  "getSessionUser",
  "cronAuthError",
  "secretEqual",
  "presentedKey",
  "verifyWebhook",
  "verifyEbaySignature",
  "constructEvent",
  "verifyAdminLogin",
  "verifyPassword",
  "verifyOAuthState",
  "authError",
];

/** Public on purpose. Key = route path under /api (as printed below), value = why. */
const ALLOWLIST = {
  "/admin/logout": "clears the caller's own cookie; nothing to protect",
  "/auth/confirm-email": "emailed one-time link token is the credential; IP rate limited",
  "/auth/forgot": "password-reset request: public by design, IP and account rate limited",
  "/auth/logout": "ends the caller's own session cookie",
  "/auth/reset": "emailed one-time reset token is the credential; IP rate limited",
  "/vision/trial": "ad-landing free scan: public by design, gated by device/IP limits and a daily budget",
  "/visit": "anonymous visitor ping: public by design, IP rate limited, path shape validated",
  "/waitlist": "public signup form: honeypot plus IP rate limit",
};

let failures = 0;
function check(label, ok, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok || !detail ? "" : `\n         ${detail}`}`);
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/^route\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function exportedMethods(src) {
  const methods = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(m[1]);
  for (const m of src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\b/g)) methods.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (/^(GET|POST|PUT|PATCH|DELETE)$/.test(name)) methods.add(name);
    }
  }
  return methods;
}

const callRe = new RegExp(`\\b(?:${AUTH_CALLS.join("|")})\\s*\\(`);
const files = walk(API_DIR).sort();
let covered = 0;
const usedAllow = new Set();

for (const file of files) {
  const route = "/" + relative(API_DIR, file).split(sep).slice(0, -1).join("/");
  const src = readFileSync(file, "utf8");
  const methods = exportedMethods(src);
  const isAdmin = route === "/admin" || route.startsWith("/admin/");
  const mutating = [...methods].some((m) => m !== "GET") || (isAdmin && methods.has("GET"));
  if (!mutating) continue;
  if (callRe.test(src)) {
    covered++;
    continue;
  }
  if (route in ALLOWLIST) {
    usedAllow.add(route);
    continue;
  }
  check(`${route} (${[...methods].join("/")}) calls an auth gate or is allowlisted`, false, `${relative(process.cwd(), file)} has none of: ${AUTH_CALLS.join(", ")}`);
}

check(`${covered} mutating/admin routes call an auth gate`, covered > 0);
for (const route of Object.keys(ALLOWLIST)) {
  check(`allowlist entry ${route} is still a real route with no gate`, usedAllow.has(route), "stale entry: remove it (the route is gone or now has a gate)");
}

if (failures) {
  console.log(`\n${failures} api auth check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll api auth checks passed");
