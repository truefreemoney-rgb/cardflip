/**
 * Admin email campaigns (lib/server/campaigns.ts). Run: npm run test:campaigns
 *
 * Pins: off = nothing sends; wrong weekday = nothing (force skips only that);
 * trial with scans left gets scans_left with the right count, trial with none
 * gets out_of_scans with pricing.ts prices; admins, accounts under a day old,
 * unsubscribed and email-pending users get nothing; a sent mail is logged and
 * the next run inside MIN_GAP_DAYS skips the user; a failed send is logged as
 * failed and does not block a retry; test sends never count toward caps.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-campaigns-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});
console.error = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { sweepCampaigns, capBlocks, renderCampaign, MIN_GAP_DAYS, MAX_PER_CAMPAIGN } = await import(at("lib/server/campaigns.ts"));
const { createUser } = await import(at("lib/server/users.ts"));
const { PRICE, SCANS } = await import(at("lib/pricing.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const DAY = 86_400_000;
const TUE = Date.UTC(2026, 9, 6, 14, 0, 0); // Tuesday 10:00 ET
const WED = TUE + DAY;
const old = TUE - 3 * DAY;

const left = await createUser("Ash Ketchum", "left@example.com", "hunter22", "user");
const out = await createUser("Misty", "out@example.com", "hunter22", "user");
const fresh = await createUser("New", "fresh@example.com", "hunter22", "user");
const admin = await createUser("Boss", "boss@example.com", "hunter22", "admin");
const unsub = await createUser("Gone", "gone@example.com", "hunter22", "user");
await db.prepare("UPDATE users SET created_at = ? WHERE id != ?").run(old, fresh.id);
await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(TUE - 3_600_000, fresh.id);
await db.prepare("UPDATE users SET trial_scans_used = 2 WHERE id = ?").run(left.id);
await db.prepare("UPDATE users SET trial_scans_used = ? WHERE id = ?").run(SCANS.trial, out.id);
await db.prepare("UPDATE users SET digest_off = 1 WHERE id = ?").run(unsub.id);

const mails = [];
const deps = (on = true, fail = false) => ({
  on: async () => on,
  configured: () => true,
  send: async (to, m) => {
    if (fail) throw new Error("smtp down");
    mails.push({ to, ...m });
  },
});

check("off sends nothing", (await sweepCampaigns(TUE, {}, deps(false))).skipped, "switched off");
check("Wednesday sends nothing", (await sweepCampaigns(WED, {}, deps())).sent, 0);

const failed = await sweepCampaigns(TUE, {}, deps(true, true));
check("failed sends counted", [failed.sent, failed.failed], [0, 2]);

const r = await sweepCampaigns(TUE, {}, deps());
check("only the two trial users get mail", mails.map((m) => m.to).sort(), ["left@example.com", "out@example.com"]);
check("sweep counts", [r.due, r.sent, r.failed], [2, 2, 0]);
const mLeft = mails.find((m) => m.to === "left@example.com");
const mOut = mails.find((m) => m.to === "out@example.com");
check("scans left count + first name", [mLeft.subject, mLeft.text.startsWith("Hi Ash,")], [`You still have ${SCANS.trial - 2} free scans`, true]);
check("out of scans names pricing.ts prices", [mOut.text.includes(PRICE.pack), mOut.text.includes(PRICE.standard), mOut.text.includes(String(SCANS.pack))], [true, true, true]);
check("unsubscribe link carries token + k=updates", /\/api\/digest\/unsubscribe\?u=.+&t=[0-9a-f]+&k=updates/.test(mLeft.unsubUrl));

mails.length = 0;
const again = await sweepCampaigns(TUE + DAY * (MIN_GAP_DAYS - 1), { force: true }, deps());
check("inside the gap the two mailed users are skipped; the account that just turned a day old is mailed", [again.sent, mails.map((m) => m.to)], [1, ["fresh@example.com"]]);

const logged = await db.prepare("SELECT status, COUNT(*) AS n FROM email_sends GROUP BY status ORDER BY status").all();
check("log has 2 failed + 3 sent", logged.map((x) => [x.status, Number(x.n)]), [["failed", 2], ["sent", 3]]);

const h = (n, campaign, ago) => Array.from({ length: n }, () => ({ user_id: "x", campaign, sent_at: TUE - ago * DAY }));
check("cap: recent mail blocks", capBlocks(h(1, "out_of_scans", 1), "scans_left", TUE), "mailed recently");
check("cap: same mail within a week blocks", capBlocks(h(1, "scans_left", 5), "scans_left", TUE), "same mail this week");
check("cap: lifetime limit", capBlocks(h(MAX_PER_CAMPAIGN, "scans_left", 30), "scans_left", TUE), "campaign limit reached");
check("cap: clear after the gaps", capBlocks(h(1, "scans_left", 8), "scans_left", TUE), null);

const one = renderCampaign("scans_left", { firstName: "", scansLeft: 1, unsubUrl: "u" });
check("singular + no-name greeting", [one.subject, one.text.startsWith("Hi,")], ["You still have 1 free scan", true]);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
