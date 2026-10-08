/**
 * The weekly mails (lib/server/campaigns.ts, docs/EMAILS.md). Run: npm run test:campaigns
 *
 * Pins: off = nothing sends; a day with no mail = nothing; outside the send
 * hour = nothing (force skips only that); Tuesday: trial with scans left /
 * out of scans get the right counts and pricing.ts prices, a subscriber
 * running low sees Booster + Move to Pro (standard plan only); admins,
 * accounts under a day old, unsubscribed, email-pending and pre-cutoff users
 * get nothing; one mail per person per day and the same mail once a week;
 * the owner gets one [COPY] per run; a failed send is logged and retried;
 * Sunday's mail renders from an empty catalog without throwing; test sends
 * are logged as tests and never count toward caps.
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
console.warn = () => {};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { sweepCampaigns, capBlocks, renderScans, renderWeek, campaignDueOn, inSendHour, sendCampaignTest, SIGNUP_CUTOFF, SAME_GAP_DAYS } = await import(at("lib/server/campaigns.ts"));
const { createUser, OWNER_EMAIL: OWNER } = await import(at("lib/server/users.ts"));
const { PRICE, SCANS, PLAN_NAME } = await import(at("lib/pricing.ts"));
const { db } = await import(at("lib/db.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const DAY = 86_400_000;
const TUE = Date.UTC(2026, 9, 13, 14, 0, 0); // Tuesday Oct 13, 10:00am ET (EDT)
const TUE_EARLY = TUE - 3_600_000; // 9:00am ET
const WED = TUE + DAY;
const THU = TUE + 2 * DAY;
const SUN = Date.UTC(2026, 9, 18, 22, 30, 0); // Sunday Oct 18, 6:30pm ET
const old = TUE - 3 * DAY;

const left = await createUser("Ash Ketchum", "left@example.com", "hunter22", "user");
const out = await createUser("Misty", "out@example.com", "hunter22", "user");
const low = await createUser("Brock", "low@example.com", "hunter22", "user");
const fresh = await createUser("New", "fresh@example.com", "hunter22", "user");
const admin = await createUser("Boss", "boss@example.com", "hunter22", "admin");
const unsub = await createUser("Gone", "gone@example.com", "hunter22", "user");
const before = await createUser("Early", "early@example.com", "hunter22", "user");
void admin;
await db.prepare("UPDATE users SET created_at = ? WHERE id NOT IN (?, ?)").run(old, fresh.id, before.id);
await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(TUE - 3_600_000, fresh.id);
await db.prepare("UPDATE users SET trial_scans_used = 2 WHERE id = ?").run(left.id);
await db.prepare("UPDATE users SET trial_scans_used = ? WHERE id = ?").run(SCANS.trial, out.id);
await db.prepare("UPDATE users SET digest_off = 1 WHERE id = ?").run(unsub.id);
await db.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(SIGNUP_CUTOFF - 1, before.id);
// A live standard subscriber with 12 plan scans left and the next payment in 12 days.
await db.prepare("UPDATE users SET plan = 'standard', sub_status = 'active', sub_period_end = ?, plan_scans = 12 WHERE id = ?").run(TUE + 12 * DAY, low.id);

const mails = [];
const deps = (on = true, fail = false) => ({
  on: async () => on,
  configured: () => true,
  send: async (to, m) => {
    if (fail) throw new Error("smtp down");
    mails.push({ to, ...m });
  },
});

check("schedule: Tue/Thu/Sun pick the right mail, Wednesday none", [campaignDueOn(TUE), campaignDueOn(THU), campaignDueOn(SUN), campaignDueOn(WED)], ["scans", "cards", "week", null]);
check("send hour: 10am ET yes, 9am ET no, Sunday 6:30pm yes", [inSendHour("scans", TUE), inSendHour("scans", TUE_EARLY), inSendHour("week", SUN)], [true, false, true]);

check("off sends nothing", (await sweepCampaigns(TUE, {}, deps(false))).skipped, "switched off");
check("Wednesday sends nothing", (await sweepCampaigns(WED, {}, deps())).skipped, "no mail today");
check("Tuesday 9am sends nothing", (await sweepCampaigns(TUE_EARLY, {}, deps())).skipped?.startsWith("not the send hour"), true);

const failed = await sweepCampaigns(TUE, {}, deps(true, true));
check("failed sends counted", [failed.sent, failed.failed], [0, 3]);

const r = await sweepCampaigns(TUE, {}, deps());
check("Tuesday: the two trial users + the subscriber get mail (admin, fresh, unsubscribed, pre-10-07 skipped)", mails.map((m) => m.to).filter((t) => t !== OWNER).sort(), ["left@example.com", "low@example.com", "out@example.com"]);
check("owner gets one [COPY] per run", mails.filter((m) => m.to === OWNER).map((m) => m.subject.slice(0, 7)), ["[COPY] "]);
check("sweep counts", [r.campaign, r.due, r.sent, r.failed], ["scans", 3, 3, 0]);
const mLeft = mails.find((m) => m.to === "left@example.com");
const mOut = mails.find((m) => m.to === "out@example.com");
const mLow = mails.find((m) => m.to === "low@example.com");
check("trial left: count + first name", [mLeft.subject, mLeft.text.startsWith("Hi Ash,")], [`You still have ${SCANS.trial - 2} free scans`, true]);
check("trial out: pricing.ts prices", [mOut.subject, mOut.text.includes(PRICE.pack), mOut.text.includes(PRICE.standard), mOut.text.includes(String(SCANS.pack))], ["You're out of free scans", true, true, true]);
check("subscriber low: scans left, next credit date, Booster + Move to Pro", [mLow.subject, mLow.text.includes("arrive on Oct 25"), mLow.text.includes(PLAN_NAME.pack), mLow.text.includes(`Move to ${PLAN_NAME.pro}`)], ["You have 12 scans left", true, true, true]);
check("every mail has one tip", [mLeft.text.includes("ONE TIP"), mLow.text.includes("ONE TIP")], [true, true]);
check("unsubscribe link carries token + k=updates", /\/api\/digest\/unsubscribe\?u=.+&t=[0-9a-f]+&k=updates/.test(mLeft.unsubUrl));

mails.length = 0;
const sameDay = await sweepCampaigns(TUE + 3_600_000, { force: true }, deps());
check("a second run the same day mails nobody again", sameDay.sent, 0);

mails.length = 0;
const thu = await sweepCampaigns(THU, {}, deps());
check("Thursday: nobody has scanned, so everyone gets the five-game list from the showcase leads", [thu.campaign, thu.sent, thu.failed], ["cards", 4, 0]);
const mThu = mails.find((m) => m.to === "left@example.com");
check("Thursday trial headline: free scans waiting; at least one showcase card (the test DB has only Pokémon)", [mThu.subject, (mThu.text.match(/^· /gm) ?? []).length >= 1], ["Your 3 free scans are waiting", true]);

mails.length = 0;
const sun = await sweepCampaigns(SUN, {}, deps());
check("Sunday: everyone due gets the week mail (fresh account is a day old by now)", [sun.campaign, mails.map((m) => m.to).filter((t) => t !== OWNER).sort()], ["week", ["fresh@example.com", "left@example.com", "low@example.com", "out@example.com"]]);
const mSun = mails.find((m) => m.to === "left@example.com");
check("week mail: five game lines + scans count", [mSun.text.includes("THE WEEK"), mSun.text.includes("Pokémon:"), mSun.text.includes("Yu-Gi-Oh!:"), mSun.text.includes("0 cards scanned")], [true, true, true, true]);

mails.length = 0;
const tueAgain = await sweepCampaigns(TUE + 7 * DAY, {}, deps());
check("next Tuesday everyone is due again", tueAgain.sent, 4);

await sendCampaignTest("scans:trial_left", OWNER, TUE, deps());
const logged = await db.prepare("SELECT status, COUNT(*) AS n FROM email_sends GROUP BY status ORDER BY status").all();
check("log: copies + failed + sent + one test", logged.map((x) => [x.status, Number(x.n)]), [["copy", 4], ["failed", 3], ["sent", 15], ["test", 1]]);

const h = (campaign, ago) => [{ user_id: "x", campaign, sent_at: TUE - ago * DAY }];
check("cap: a mail earlier today blocks", capBlocks(h("scans", 0), "cards", TUE + 3_600_000), "already mailed today");
check("cap: the same mail within the week blocks", capBlocks(h("scans", SAME_GAP_DAYS - 1), "scans", TUE), "had this mail this week");
check("cap: a different mail yesterday is fine", capBlocks(h("scans", 1), "cards", TUE), null);
check("cap: clear after the gap", capBlocks(h("scans", SAME_GAP_DAYS + 1), "scans", TUE), null);

const one = renderScans({ variant: "trial_left", left: 1, included: 5, nextCreditAt: null, plan: null, tip: null }, "", "u");
check("singular + no-name greeting + no tip block", [one.subject, one.text.startsWith("Hi,"), one.text.includes("ONE TIP")], ["You still have 1 free scan", true, false]);
const proLow = renderScans({ variant: "sub_low", left: 5, included: 750, nextCreditAt: null, plan: "pro", tip: null }, "Chris", "u");
check("pro plan running low: Booster only, no Move to Pro", [proLow.text.includes(PLAN_NAME.pack), proLow.text.includes("Move to")], [true, false]);
const week = renderWeek({ games: [{ game: "pokemon", label: "Pokémon", movePct: 2.1, note: "x" }, { game: "lorcana", label: "Lorcana", movePct: -1.9, note: "y" }], jump: null, set: null, sleeper: null, scans: 4120, mostScanned: "Pikachu ex" }, "Chris", "u");
check("week subject names the top and bottom game", [week.subject, week.text.includes("4,120 cards scanned. Most scanned: Pikachu ex.")], ["This week in cards: Pokémon up, Lorcana down", true]);

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
