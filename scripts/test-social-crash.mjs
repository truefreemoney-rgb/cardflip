/**
 * The publisher crash record (10-03): when /api/social/publish throws, the
 * route must record the error, mail Chris once an hour, and answer 500 with
 * the message in the body (10-02 9:51pm ET: a bare 500, nobody could say
 * why). Run: npm run test:socialcrash
 */
import { readFileSync } from "node:fs";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { recordPublishCrash, recentPublishCrash, crashMessage, SOCIAL_CRASH_KEY, SOCIAL_CRASH_SHOW_MS } = await import(at("lib/server/socialCrash.ts"));

// A fake settings table + a fake mailer, so nothing touches a database or SMTP.
const store = new Map();
const mails = [];
const deps = {
  get: async (k) => store.get(k) ?? null,
  set: async (k, v) => { store.set(k, v); },
  send: async (a) => { mails.push(a); },
};
const T0 = Date.parse("2026-10-03T01:51:36Z");

const crash = await recordPublishCrash(new TypeError("Cannot read properties of undefined (reading 'cards')"), { slot: null, now: T0 }, deps);
check("the record carries when, which slot, and the error", crash, { at: T0, slot: null, message: "TypeError: Cannot read properties of undefined (reading 'cards')" });
check("…and is stored under the settings key", JSON.parse(store.get(SOCIAL_CRASH_KEY)), crash);
check("Chris gets one mail naming the error", mails.map((m) => [m.workflow, m.message]), [["social-publish", "The publisher crashed: TypeError: Cannot read properties of undefined (reading 'cards')"]]);

await recordPublishCrash(new Error("again"), { slot: "evening", now: T0 + 5 * 60 * 1000 }, deps);
check("a second crash five minutes later is recorded but not mailed again (hourly gap)", [mails.length, JSON.parse(store.get(SOCIAL_CRASH_KEY)).message], [1, "Error: again"]);

await recordPublishCrash("plain string", { slot: "morning", now: T0 + 2 * 60 * 60 * 1000 }, deps);
check("two hours later it mails again, and names the slot", mails[1]?.message, "The publisher crashed on the morning slot: plain string");

check("the admin page sees a crash from an hour ago", (await recentPublishCrash(T0 + 60 * 60 * 1000, deps.get))?.message, "plain string");
check("…but not one older than the two-day window", await recentPublishCrash(T0 + 2 * 60 * 60 * 1000 + SOCIAL_CRASH_SHOW_MS + 1, deps.get), null);
check("a junk record never breaks the page", await recentPublishCrash(T0, async () => "{not json"), null);
check("messages are one line and capped", crashMessage(new Error("a\n\n" + "b".repeat(600))).length <= 500 && !/\n/.test(crashMessage(new Error("a\nb"))), true);

// A failing settings write or mailer must not turn the crash handler into a second crash.
const broken = { get: async () => { throw new Error("db down"); }, set: async () => { throw new Error("db down"); }, send: async () => { throw new Error("smtp down"); } };
check("db and mail both down: the record still comes back for the 500 body", (await recordPublishCrash(new Error("x"), { now: T0 }, broken)).message, "Error: x");

// Route files may only export handlers, so the wiring is read from the source.
const route = readFileSync(new URL("../src/app/api/social/publish/route.ts", import.meta.url), "utf8");
check("the route wraps publishSocial and records the crash", /try \{\s*report = await publishSocial\([\s\S]*?\} catch \(err\) \{[\s\S]*?recordPublishCrash\(err/.test(route), true);
check("…and still answers 500", /status: 500/.test(route), true);
const page = readFileSync(new URL("../src/app/admin/(console)/social/page.tsx", import.meta.url), "utf8");
check("/admin/social shows the last crash", page.includes("recentPublishCrash()") && page.includes("The publisher crashed"), true);

console.log(fails === 0 ? "\nAll social crash checks passed." : `\n${fails} social crash check(s) FAILED.`);
process.exit(fails === 0 ? 0 : 1);
