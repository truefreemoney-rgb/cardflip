/**
 * #31 (audit 10-16): changes that guard an account sign out its other devices, and no session lives forever.
 * Run: npm run test:sessionrevoke
 *
 * Pins:
 *  - turning two-step ON (confirm) and OFF (disable) ends every other session; this device keeps its seat;
 *  - an established account's email move ends every other session: by the typed code (this device stays),
 *    by the emailed link opened in a signed-out browser (all go), by the direct write when code mail is off;
 *  - a code that only lifts a NEW signup's wall signs nobody out;
 *  - sessions still slide 30 days, but never past a year after the sign-in that made them, and a session
 *    older than that is refused (and deleted) however recently it was renewed.
 *
 * Throwaway db; next/headers is stubbed so requireUser() reads the cookie jar this test fills.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "VERCEL"]) delete process.env[k];
process.env.EMAIL_CONFIRM_DEV_ECHO = "1";
process.env.EBAY_TOKEN_KEY = "test-signing-key";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-sessionrevoke-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
console.error = () => {};
console.warn = () => {};
console.info = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const totpRoute = await import(at("app/api/account/totp/route.ts"));
const verifyRoute = await import(at("app/api/auth/verify-email/route.ts"));
const confirmRoute = await import(at("app/api/auth/confirm-email/route.ts"));
const accountRoute = await import(at("app/api/account/route.ts"));
const { SESSION_COOKIE } = await import(at("lib/server/auth.ts"));
const { createSession, getSessionUserId, touchSession, SESSION_TTL_MS, SESSION_MAX_AGE_MS } = await import(at("lib/server/sessions.ts"));
const { createUser, findUserById } = await import(at("lib/server/users.ts"));
const { totpCode } = await import(at("lib/server/totp.ts"));
const ev = await import(at("lib/server/emailVerify.ts"));
const { _resetRateLimits } = await import(at("lib/server/rateLimit.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`,
  );
}

let ip = 0;
const post = (body) =>
  new Request("http://test/api", { method: "POST", headers: { "content-type": "application/json", "fly-client-ip": `10.9.${++ip}.1` }, body: JSON.stringify(body) });
const patch = (body) =>
  new Request("http://test/api", { method: "PATCH", headers: { "content-type": "application/json", "fly-client-ip": `10.9.${++ip}.1` }, body: JSON.stringify(body) });
async function clearLimits() {
  _resetRateLimits();
  await db.prepare("DELETE FROM rate_limits").run();
}
/** Three signed-in devices; the first is "this one" (its cookie is in the jar). */
async function devices(userId) {
  const [mine, phone, laptop] = [await createSession(userId), await createSession(userId), await createSession(userId)];
  testCookies.set(SESSION_COOKIE, mine.token);
  return { mine: mine.token, phone: phone.token, laptop: laptop.token };
}
const alive = async (d) => [Boolean(await getSessionUserId(d.mine)), Boolean(await getSessionUserId(d.phone)), Boolean(await getSessionUserId(d.laptop))];

console.log("Two-step on / off");
{
  const u = await createUser("Tf", "tf@example.com", "hunter22", "user");
  let d = await devices(u.id);
  await clearLimits();
  const setup = await (await totpRoute.POST(post({ action: "setup" }))).json();
  const on = await totpRoute.POST(post({ action: "confirm", code: totpCode(setup.secret) }));
  const onBody = await on.json();
  check("turning two-step ON: 200, the 2 other devices signed out, this one stays", [on.status, onBody.signedOut, await alive(d)], [200, 2, [true, false, false]]);

  d = await devices(u.id);
  await clearLimits();
  const wrong = await totpRoute.POST(post({ action: "disable", password: "nope" }));
  check("a wrong password to turn it off signs nobody out", [wrong.status, await alive(d)], [400, [true, true, true]]);
  const off = await totpRoute.POST(post({ action: "disable", password: "hunter22" }));
  check("turning two-step OFF: the other devices signed out, this one stays", [off.status, (await off.json()).signedOut, await alive(d)], [200, 3, [true, false, false]]);
}

console.log("Email move");
{
  const u = await createUser("Em", "em-old@example.com", "hunter22", "user");
  let d = await devices(u.id);
  await clearLimits();
  const sent = await ev.sendChangeCode(u, "em-new@example.com");
  check("change code sent (dev echo)", sent.ok, true);
  const res = await verifyRoute.POST(post({ code: ev.devLastCode("em-new@example.com").code }));
  check("typed code moves the email and signs out the other devices; this one stays",
    [res.status, (await findUserById(u.id)).email, await alive(d)], [200, "em-new@example.com", [true, false, false]]);

  d = await devices(u.id);
  await clearLimits();
  await ev.sendChangeCode(u, "em-third@example.com");
  const t = new URL(ev.devLastCode("em-third@example.com").url).searchParams.get("t");
  testCookies.delete(SESSION_COOKIE); // the mail opened in a browser that isn't signed in
  const link = await confirmRoute.POST(post({ t }));
  check("the emailed link (signed-out browser) moves it and signs out every device",
    [link.status, (await findUserById(u.id)).email, await alive(d)], [200, "em-third@example.com", [false, false, false]]);

  // Code mail switched off: the account page writes the address at once.
  const w = await createUser("Wr", "wr-old@example.com", "hunter22", "user");
  d = await devices(w.id);
  await clearLimits();
  const saved = process.env.EMAIL_CONFIRM_DEV_ECHO;
  delete process.env.EMAIL_CONFIRM_DEV_ECHO;
  const direct = await accountRoute.PATCH(patch({ email: "wr-new@example.com", currentPassword: "hunter22" }));
  process.env.EMAIL_CONFIRM_DEV_ECHO = saved;
  const moved = (await findUserById(w.id)).email;
  check("a direct email write (no code mail) signs out the other devices too", [direct.status, moved, await alive(d)], [200, "wr-new@example.com", [true, false, false]]);
  d = await devices(w.id);
  await accountRoute.PATCH(patch({ name: "Renamed" }));
  check("a rename alone signs nobody out", await alive(d), [true, true, true]);
}

console.log("Sessions stop a year after sign-in");
{
  const u = await createUser("Old", "old@example.com", "hunter22", "user");
  const s = await createSession(u.id);
  const DAY = 86_400_000;
  // 10 months in, renewed last week: still fine, and a renewal slides 30 days.
  await db.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE user_id = ?").run(Date.now() - 300 * DAY, Date.now() + 23 * DAY, u.id);
  const r = await touchSession(s.token);
  check("10 months old: renews the full 30 days", Boolean(r) && Math.abs(r.expiresAt - (Date.now() + SESSION_TTL_MS)) < 5000, true);
  // 350 days in: a renewal stops at the 1-year mark, not 30 days out.
  await db.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE user_id = ?").run(Date.now() - 350 * DAY, Date.now() + 2 * DAY, u.id);
  const capped = await touchSession(s.token);
  const createdAt = (await db.prepare("SELECT created_at FROM sessions WHERE user_id = ?").get(u.id)).created_at;
  check("350 days old: renewal capped at a year after sign-in", capped?.expiresAt, Number(createdAt) + SESSION_MAX_AGE_MS);
  // A row that slid past the year anyway (older code): refused and deleted.
  await db.prepare("UPDATE sessions SET created_at = ?, expires_at = ? WHERE user_id = ?").run(Date.now() - 400 * DAY, Date.now() + 20 * DAY, u.id);
  check("400 days old, expiry still ahead: refused", await getSessionUserId(s.token), null);
  check("...and the row is gone", (await db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?").get(u.id)).n, 0);
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll session revoke checks passed.");
