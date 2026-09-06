/**
 * Invite a friend (subscribers only). Run: npm run test:referral
 *
 * Pins: a code is minted once and stable; signup with ?ref attaches the
 * referrer (unknown code ignored, never overwritten); the reward fires on the
 * friend's subscribed edge only when the referrer is a subscriber right now
 * (a trial referrer earns nothing, and stays unrewarded even if they
 * subscribe later), exactly once (retried webhook pays nothing); stats
 * count joined vs subscribed; bonus scans are spent only after the month's
 * allowance and survive the rollover; the invite API reports eligibility.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-referral-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { attachReferral, ensureReferralCode, findUserByReferralCode, referralStats, referralUrl, rewardReferrerIfDue, REFERRAL_BONUS_SCANS } = await import(at("lib/server/referrals.ts"));
const { createUser, findUserById, setSubscription, PLAN_SCANS } = await import(at("lib/server/users.ts"));
const { recordScan, scanQuota } = await import(at("lib/server/scanQuota.ts"));
const signup = await import(at("app/api/auth/signup/route.ts"));
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
  new Request("http://test/api/auth/signup", {
    method: "POST",
    headers: { "content-type": "application/json", "fly-client-ip": `10.9.0.${++ip}` },
    body: JSON.stringify(body),
  });
const subscribe = (id) => setSubscription(id, "active", Date.now() + 30 * 86_400_000, "standard");
const u = (id) => findUserById(id);

// --- code -------------------------------------------------------------------
const alice = await createUser("Alice", "alice@example.com", "hunter22", "user");
const code = await ensureReferralCode(alice);
check("code: 8 unambiguous chars", /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(code), true);
check("code: stable on the second ask", await ensureReferralCode(await u(alice.id)), code);
check("code: lookup, case/space-insensitive", (await findUserByReferralCode(`  ${code.toLowerCase()} `))?.id, alice.id);
check("code: unknown → null", await findUserByReferralCode("NOPE1234"), null);
check("url", referralUrl(code, "https://cardflip.io/"), `https://cardflip.io/?ref=${code}`);

// --- signup attaches ---------------------------------------------------------
const r1 = await signup.POST(post({ name: "Bob", email: "bob@example.com", password: "hunter22", ref: code }));
const bob = (await r1.json()).user;
check("signup: ref attaches the referrer", [r1.status, (await u(bob.id)).referredBy], [201, alice.id]);
const r2 = await signup.POST(post({ name: "Cid", email: "cid@example.com", password: "hunter22", ref: "ZZZZZZZZ" }));
const cid = (await r2.json()).user;
check("signup: unknown ref → plain signup, nothing attached", [r2.status, (await u(cid.id)).referredBy], [201, null]);
check("attach: never overwrites", [await attachReferral(bob.id, await ensureReferralCode(cid)), (await u(bob.id)).referredBy], [false, alice.id]);
check("attach: not to yourself", await attachReferral(alice.id, code), false);

// --- reward -------------------------------------------------------------------
check("reward: referrer on trial → nothing", await rewardReferrerIfDue(await u(bob.id)), false);
check("reward: bob stays unrewarded (referrer can still earn later if they subscribe first)", (await u(bob.id)).referralRewardedAt, null);
await subscribe(alice.id);
check("reward: referrer subscribed → +500 once", [await rewardReferrerIfDue(await u(bob.id)), (await u(alice.id)).bonusScans], [true, REFERRAL_BONUS_SCANS]);
check("reward: retried webhook pays nothing", [await rewardReferrerIfDue(await u(bob.id)), (await u(alice.id)).bonusScans], [false, REFERRAL_BONUS_SCANS]);
check("reward: no referrer → nothing", await rewardReferrerIfDue(await u(cid.id)), false);

const dee = (await (await signup.POST(post({ name: "Dee", email: "dee@example.com", password: "hunter22", ref: code }))).json()).user;
check("stats: joined vs subscribed", await referralStats(alice.id), { friendsJoined: 2, friendsSubscribed: 1, scansEarned: REFERRAL_BONUS_SCANS });
await rewardReferrerIfDue(await u(dee.id));
check("stats: second friend subscribes → 1,000 banked", [(await u(alice.id)).bonusScans, (await referralStats(alice.id)).friendsSubscribed], [1000, 2]);

// --- quota: bonus spent after the allowance -------------------------------------
const month = new Date().toISOString().slice(0, 7);
const cap = PLAN_SCANS.standard;
await db.prepare("UPDATE users SET scan_month = ?, scans_used = ?, bonus_scans = 2 WHERE id = ?").run(month, cap - 1, alice.id);
let q = scanQuota(await u(alice.id));
check("quota: remaining = allowance left + bonus", [q.used, q.included, q.remaining, q.bonus], [cap - 1, cap, 3, 2]);
q = await recordScan(await u(alice.id));
check("scan: last allowance scan counts against the month, bonus untouched", [q.used, q.remaining, q.bonus], [cap, 2, 2]);
q = await recordScan(await u(alice.id));
check("scan: past the cap → spends a bonus scan, used stays at cap", [q.used, q.remaining, q.bonus, (await u(alice.id)).bonusScans], [cap, 1, 1, 1]);
q = await recordScan(await u(alice.id));
check("scan: last bonus → 0 remaining", [q.remaining, q.bonus], [0, 0]);
check("quota: exhausted at 0", scanQuota(await u(alice.id)).remaining, 0);
await db.prepare("UPDATE users SET scan_month = '2000-01', scans_used = ?, bonus_scans = 5 WHERE id = ?").run(cap, alice.id);
q = scanQuota(await u(alice.id));
check("rollover: month resets, bonus carried", [q.used, q.remaining, q.bonus], [0, cap + 5, 5]);

// trial accounts never see a bonus in their quota
await db.prepare("UPDATE users SET bonus_scans = 9 WHERE id = ?").run(cid.id);
check("quota: a trial account's stray bonus is ignored", scanQuota(await u(cid.id)).bonus === undefined);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
