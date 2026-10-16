/**
 * Promo codes + the FLIPBACK come-back mail (10-16). Run: npm run test:promo
 *
 * Pins: a trial account's code becomes more FREE TRIAL scans (never a Booster: that would unlock selling); other
 * tiers get bonus scans; once per account; unknown / expired / brand-new accounts refused; the mail reaches only
 * confirmed, opted-in, post-10-07 non-house accounts, once, stamped before it is sent.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-promo-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { redeemPromo, normalizeCode, PROMO_CODES } = await import(at("lib/server/promoCodes.ts"));
const { createUser, findUserById, scanTier, trialScansLeft, TRIAL_SCANS } = await import(at("lib/server/users.ts"));
const { reserveScan } = await import(at("lib/server/scanQuota.ts"));
const { renderComeback, comebackRecipients, sendComeback } = await import(at("lib/server/comebackMail.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const OCT10 = Date.UTC(2026, 9, 10, 16);
const NOW = Date.UTC(2026, 9, 16, 16);
const setCreated = (id, ms) => db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(ms, id);

console.log("redeem");
const t = await createUser("Tess Trial", "tess@example.com", "hunter22");
await setCreated(t.id, OCT10);
let tess = await findUserById(t.id);
check("starts as a trial account with the normal free scans", [scanTier(tess), trialScansLeft(tess)], ["trial", TRIAL_SCANS]);
check("code is normalized (case, spaces)", normalizeCode("  flip back "), "FLIPBACK");
let r = await redeemPromo(tess, " flipback ", NOW);
tess = await findUserById(t.id);
check("trial: +10 free trial scans", [r.ok, r.bucket, trialScansLeft(tess)], [true, "trial", TRIAL_SCANS + 10]);
check("trial: still a trial account (no Booster, so no selling)", [scanTier(tess), tess.extraScans ?? 0], ["trial", 0]);
check("the extra scans really spend", (await reserveScan(tess)).ok !== false);
r = await redeemPromo(tess, "FLIPBACK", NOW);
check("second redeem refused, nothing added", [r.ok, r.reason, trialScansLeft(await findUserById(t.id))], [false, "already", TRIAL_SCANS + 9]);
check("unknown code refused", (await redeemPromo(tess, "NOPE", NOW)).reason, "unknown");
check("expired code refused", (await redeemPromo(tess, "FLIPBACK", PROMO_CODES.FLIPBACK.expiresAt + 1)).reason, "expired");

const n = await createUser("New Ned", "ned@example.com", "hunter22");
await setCreated(n.id, Date.UTC(2026, 9, 18, 12));
check("an account made after the mail can't redeem", (await redeemPromo(await findUserById(n.id), "FLIPBACK", NOW)).reason, "new_account");

const s = await createUser("Sub Sam", "sam@example.com", "hunter22");
await setCreated(s.id, OCT10);
await db.prepare("UPDATE users SET sub_status = 'active', plan = 'standard' WHERE id = ?").run(s.id);
r = await redeemPromo(await findUserById(s.id), "FLIPBACK", NOW);
check("subscriber: +10 bonus scans", [r.ok, r.bucket, (await findUserById(s.id)).bonusScans], [true, "bonus", 10]);

console.log("\ncome-back mail");
const mail = renderComeback("Tess <b>", "https://cardflip.io/unsub");
check("both ways to claim: the link and the Account page box", [mail.html.includes("/app?code=FLIPBACK"), mail.html.includes("/app/account"), mail.text.includes("Have a code?")], [true, true, true]);
check("signed by the support team, not a person", [mail.text.includes("The CardFlip Support Team"), /\nChris\n/.test(mail.text)], [true, false]);
check("first name escaped in the HTML", [mail.html.includes("<b>,"), mail.html.includes("Tess")], [false, true]);

const old = await createUser("Old Ollie", "ollie@example.com", "hunter22");
await setCreated(old.id, Date.UTC(2026, 9, 1, 12));
const off = await createUser("Off Olga", "olga@example.com", "hunter22");
await setCreated(off.id, OCT10);
await db.prepare("UPDATE users SET digest_off = 1 WHERE id = ?").run(off.id);
const house = await createUser("House", "wageleymarketing@gmail.com", "hunter22");
await setCreated(house.id, OCT10);
const who = (await comebackRecipients()).map((u) => u.email).sort();
check("recipients: post-10-07, opted in, no house accounts", who, ["ned@example.com", "sam@example.com", "tess@example.com"]);

const sent = [];
let res = await sendComeback(async (to) => { sent.push(to); }, () => true);
check("sends each once plus the owner copy", [res.sent, sent.length], [3, 4]);
res = await sendComeback(async (to) => { sent.push(to); }, () => true);
check("a rerun mails nobody twice", [res.due, res.sent], [0, 0]);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
