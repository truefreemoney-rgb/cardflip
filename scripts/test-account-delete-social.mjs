/**
 * Account deletion for a "Continue with Google" signup (A1, app-store readiness 10-16): no password
 * on the account, so the Account page sends none. Run: npm run test:deletesocial
 *
 * Pins: a Google signup (real start/callback routes, Google stubbed) is deleted by DELETE
 * /api/account with an empty password; the session cookie is cleared and the old token is dead;
 * a second device's session is gone too; every table with a user_id holds nothing for the account
 * afterwards except the money/cost ledgers kept on purpose (scan_usage, scan_credits,
 * scan_pack_purchases, promo_redemptions, signup_log for a confirmed signup); and the address
 * appears in no text column anywhere. A password account still needs its password.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "VERCEL", "STRIPE_SECRET_KEY", "BLOB_READ_WRITE_TOKEN"]) delete process.env[k];
process.env.EBAY_TOKEN_KEY = "test-signing-key";
process.env.GOOGLE_CLIENT_ID = "cid.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "secret";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-delete-social-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const start = await import(at("app/api/auth/google/start/route.ts"));
const callback = await import(at("app/api/auth/google/callback/route.ts"));
const account = await import(at("app/api/account/route.ts"));
const { findUserByEmail, createUser } = await import(at("lib/server/users.ts"));
const { getSessionUserId, createSession } = await import(at("lib/server/sessions.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

// --- Google stubbed (same shape as test-google-auth.mjs) ------------------------
let ipN = 0;
const ipHeader = () => ({ "fly-client-ip": `10.7.${++ipN >> 8}.${ipN & 255}` });
const jwt = (claims) => `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
let tokenReply = null;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/tokeninfo")) {
    const p = JSON.parse(Buffer.from((new URL(u).searchParams.get("id_token") ?? "").split(".")[1], "base64url").toString("utf8"));
    return new Response(JSON.stringify({ ...p, exp: String(p.exp), email_verified: String(p.email_verified) }), { status: 200 });
  }
  if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ id_token: tokenReply }), { status: 200 });
  return realFetch(url, init);
};

const EMAIL = "pat.delete@gmail.com";
testCookies.clear();
const s = await start.GET(new Request("https://cardflip.io/api/auth/google/start?mode=signup", { headers: ipHeader() }));
const loc = new URL(s.headers.get("location"));
testCookies.set("cf_gstate", s.cookies.get("cf_gstate").value);
tokenReply = jwt({
  iss: "https://accounts.google.com", aud: process.env.GOOGLE_CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 3600,
  sub: "g-delete-1", nonce: loc.searchParams.get("nonce"), email: EMAIL, email_verified: true, given_name: "Pat", name: "Pat Delete",
});
const cb = await callback.GET(new Request(`https://cardflip.io/api/auth/google/callback?code=authcode&state=${loc.searchParams.get("state")}`, { headers: ipHeader() }));
const user = await findUserByEmail(EMAIL);
const token = cb.cookies.get(SESSION_COOKIE)?.value;
check("google signup: account made, signed in", [Boolean(user), Boolean(token && (await getSessionUserId(token)) === user?.id)], [true, true]);
const otherDevice = (await createSession(user.id)).token;

// --- a row in every table that has a user_id (filled from the schema, so a new table is covered) --
const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all()).map((r) => r.name);
const cols = {};
for (const t of tables) cols[t] = await db.prepare(`PRAGMA table_info(${t})`).all();
const withUser = tables.filter((t) => t !== "users" && cols[t].some((c) => c.name === "user_id"));
const filler = (c, t) => {
  if (c.name === "user_id") return user.id;
  if (c.name === "email") return EMAIL;
  if (c.name === "card_id" && t === "card_photos") return "card-del-1";
  if (c.name === "ticket_id") return "ticket-del-1";
  if (c.name === "status" && t === "cards") return "ready";
  if (/INT/i.test(c.type)) return c.name === "number" ? 999001 : 1;
  if (/REAL|NUM/i.test(c.type)) return 1;
  return `${t}-${c.name}-del`;
};
// Parents first so foreign keys hold.
const order = ["cards", "support_tickets", ...withUser.filter((t) => t !== "cards" && t !== "support_tickets")];
const seeded = [];
for (const t of [...order, "card_photos"]) {
  if (!cols[t]?.length) continue;
  const need = cols[t].filter((c) => ((c.notnull || c.pk) && c.dflt_value == null && !(c.pk && /INT/i.test(c.type))) || c.name === "user_id" || c.name === "email");
  const vals = need.map((c) => (t === "cards" && c.name === "id" ? "card-del-1" : t === "support_tickets" && c.name === "id" ? "ticket-del-1" : filler(c, t)));
  try {
    await db.prepare(`INSERT INTO ${t} (${need.map((c) => c.name).join(", ")}) VALUES (${need.map(() => "?").join(", ")})`).run(...vals);
    seeded.push(t);
  } catch (err) {
    // The signup already wrote one (signup_log): that row is the test.
    if ((await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(user.id)).n) { seeded.push(t); continue; }
    console.log(`  (could not seed ${t}: ${err instanceof Error ? err.message : err})`);
  }
}
// A test send to the same address with no user_id (admin test mail) is the address too.
await db.prepare("INSERT INTO email_sends (user_id, email, campaign, status, sent_at) VALUES (NULL, ?, 'test', 'test', 1)").run(EMAIL.toUpperCase());
check("seeded every user_id table", withUser.filter((t) => !seeded.includes(t)), []);
// A stranger's rows must survive.
const stranger = await createUser("Other", "other@example.com", "hunter22");
await db.prepare("INSERT INTO email_sends (user_id, email, campaign, status, sent_at) VALUES (?, 'other@example.com', 'c', 'sent', 1)").run(stranger.id);

// --- delete, the way the Account page does for a no-password account -------------
const del = (pw, ip) => new Request("http://test/api/account", { method: "DELETE", headers: { "content-type": "application/json", "fly-client-ip": ip }, body: JSON.stringify({ password: pw }) });
testCookies.clear();
testCookies.set(SESSION_COOKIE, token);
const res = await account.DELETE(del("", "10.8.0.1"));
check("DELETE with no password: 200", res.status, 200);
check("session cookie cleared", testCookies.has(SESSION_COOKIE) ? testCookies.get(SESSION_COOKIE) : "", "");
check("both sessions dead", [await getSessionUserId(token), await getSessionUserId(otherDevice)], [null, null]);
check("users row gone", Boolean(await findUserByEmail(EMAIL)), false);

const KEPT = new Set(["scan_usage", "scan_credits", "scan_pack_purchases", "promo_redemptions", "signup_log"]);
const left = [];
for (const t of withUser) {
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(user.id)).n;
  if (n && !KEPT.has(t)) left.push(`${t}:${n}`);
}
check("no row left under the user id (outside the kept ledgers)", left, []);
const hasAddress = [];
for (const t of tables) {
  const text = cols[t].filter((c) => !c.type || /TEXT|CHAR|CLOB/i.test(c.type)).map((c) => c.name);
  if (!text.length) continue;
  const n = (await db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${text.map((c) => `lower(${c}) LIKE ?`).join(" OR ")}`).get(...text.map(() => `%${EMAIL}%`))).n;
  if (n) hasAddress.push(`${t}:${n}`);
}
check("the address is in no table at all", hasAddress, []);
check("a stranger's mail log survives", (await db.prepare("SELECT COUNT(*) AS n FROM email_sends WHERE user_id = ?").get(stranger.id)).n, 1);

// --- a password account still needs its password ---------------------------------
const pwToken = (await createSession(stranger.id)).token;
testCookies.clear();
testCookies.set(SESSION_COOKIE, pwToken);
check("password account: empty password refused", (await account.DELETE(del("", "10.8.0.2"))).status, 400);
check("password account: right password deletes", (await account.DELETE(del("hunter22", "10.8.0.3"))).status, 200);

console.log(failures ? `\n${failures} failure(s)` : "\nall passed");
process.exit(failures ? 1 : 0);
