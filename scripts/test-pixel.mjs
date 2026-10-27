/**
 * Ad pixels (lib/client/pixel.ts + components/GoogleAnalytics.tsx; X Pixel 10-26).
 * Run: npm run test:pixel
 *
 * Pins: an X event goes out with its Events manager id (signup; a purchase with
 * its value, USD unless told), never inside /app (privacy page: nothing measures
 * inside the account), waits for the twq() stub that mounts after first paint;
 * events X has no id for send nothing; the base code switches X's automatic
 * extras off before config, under the same consent gate and /admin + /app rules
 * as TikTok; the privacy page names X.
 * Meta Pixel (10-27): standard event names (a Booster is Purchase, a /scan tap
 * the custom ClickButton), only value + currency travel, never inside /app,
 * waits for fbq(); the base code switches autoConfig off before init, sits
 * behind the same gate, is paused with consent('revoke') in /app; the privacy
 * page names Meta.
 */
import { readFileSync } from "node:fs";

process.env.NEXT_PUBLIC_X_EVENT_SIGNUP = "tw-test-signup";
process.env.NEXT_PUBLIC_X_EVENT_PURCHASE = "tw-test-purchase";
process.env.NEXT_PUBLIC_META_PIXEL_ID = "1234567890";

// A page with TikTok and Meta already loaded (so their queues never poll) and no Google ids.
const fbSent = [];
const fbq = (...args) => fbSent.push(args);
const win = { location: { pathname: "/signup" }, ttq: { track() {} }, fbq };
globalThis.window = win;

const { pixelTrack } = await import(new URL("../src/lib/client/pixel.ts", import.meta.url).href);
const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const sent = [];
const twq = (...args) => sent.push(args);

console.log("X events");
win.twq = twq;
pixelTrack("CompleteRegistration");
check("a signup sends X's Sign up event", sent.splice(0), [["event", "tw-test-signup", {}]]);
pixelTrack("Subscribe", { value: 9.99 });
check("a plan sends Purchase with its value in USD", sent.splice(0), [["event", "tw-test-purchase", { value: 9.99, currency: "USD" }]]);
pixelTrack("CompletePayment", { value: 4.99, currency: "CAD" });
check("a Booster keeps the currency it was given", sent.splice(0), [["event", "tw-test-purchase", { value: 4.99, currency: "CAD" }]]);
pixelTrack("ViewContent", { content_type: "product" });
pixelTrack("ClickButton");
check("events X has no id for send nothing", sent.splice(0), []);

for (const p of ["/app", "/app/collection", "/app/account"]) {
  win.location.pathname = p;
  pixelTrack("Subscribe", { value: 9.99 });
  pixelTrack("CompleteRegistration");
}
check("nothing goes to X inside /app", sent.splice(0), []);
// 10-27: the purchase thank-you page is the one /app page that sends its sale.
win.location.pathname = "/app/account/welcome";
pixelTrack("CompletePayment", { value: 4.99 });
check("the purchase thank-you page sends its sale to X", sent.splice(0), [["event", "tw-test-purchase", { value: 4.99, currency: "USD" }]]);

win.location.pathname = "/signup";
delete win.twq;
pixelTrack("CompleteRegistration");
await wait(400);
check("before the base code mounts, the event waits", sent.length, 0);
win.twq = twq;
await wait(600);
check("then goes out once, when twq() exists", sent.splice(0), [["event", "tw-test-signup", {}]]);

console.log("base code");
const ga = src("components/GoogleAnalytics.tsx");
const off = ga.match(/const X_OFF = \[([^\]]*)\]/)?.[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean);
check("X's automatic extras are listed off", off, ["autoConfig", "autoDwellTracking", "autoAdvancedMatching", "dataLayerTracking"]);
const snippet = ga.slice(ga.indexOf('<Script id="x-pixel"'));
check("the off switches run before config", snippet.indexOf("twq('set','${k}','false','${X_PIXEL_ID}')") > 0 && snippet.indexOf("twq('set'") < snippet.indexOf("twq('config','${X_PIXEL_ID}')"), true);
check("it loads X's own script", snippet.includes("u.src='https://static.ads-twitter.com/uwt.js'"), true);
check("only behind the consent gate and outside /app", ga.indexOf('if (mode !== "load" || inApp) return null;') > 0 && ga.indexOf('if (mode !== "load" || inApp) return null;') < ga.indexOf('<Script id="x-pixel"'), true);
check("an X id alone turns the gate on, and /admin stays off", [/const ANY_TAG = [^;]*X_PIXEL_ID/.test(ga), ga.includes("if (!ANY_TAG) return;"), ga.includes('if (!ANY_TAG || !pathname || pathname.startsWith("/admin")) return null;')], [true, true, true]);
check("the privacy page names X", src("app/privacy/page.tsx").includes("X’s pixel on those same pages"), true);

console.log("Meta events");
fbSent.length = 0;
win.location.pathname = "/signup";
pixelTrack("CompleteRegistration");
check("a signup sends Meta's CompleteRegistration", fbSent.splice(0), [["track", "CompleteRegistration", {}]]);
pixelTrack("Subscribe", { value: 9.99 });
check("a plan sends Subscribe with its value in USD", fbSent.splice(0), [["track", "Subscribe", { value: 9.99, currency: "USD" }]]);
pixelTrack("CompletePayment", { value: 4.99, currency: "CAD" });
check("a Booster is Meta's Purchase, currency kept", fbSent.splice(0), [["track", "Purchase", { value: 4.99, currency: "CAD" }]]);
pixelTrack("ViewContent", { content_type: "product" });
check("only value and currency travel", fbSent.splice(0), [["track", "ViewContent", {}]]);
pixelTrack("ClickButton");
check("a /scan tap goes as the custom ClickButton", fbSent.splice(0), [["trackCustom", "ClickButton", {}]]);
for (const p of ["/app", "/app/collection", "/app/account"]) {
  win.location.pathname = p;
  pixelTrack("Subscribe", { value: 9.99 });
  pixelTrack("CompleteRegistration");
}
check("nothing goes to Meta inside /app", fbSent.splice(0), []);
win.location.pathname = "/app/account/welcome";
pixelTrack("CompletePayment", { value: 4.99 });
check("the purchase thank-you page sends Purchase to Meta", fbSent.splice(0), [["track", "Purchase", { value: 4.99, currency: "USD" }]]);
win.location.pathname = "/signup";
delete win.fbq;
pixelTrack("CompleteRegistration");
await wait(400);
check("before the base code mounts, the event waits", fbSent.length, 0);
win.fbq = fbq;
await wait(600);
check("then goes out once, when fbq() exists", fbSent.splice(0), [["track", "CompleteRegistration", {}]]);
sent.length = 0;

console.log("Meta base code");
const meta = ga.slice(ga.indexOf('<Script id="meta-pixel"'));
check("it loads Meta's own script", meta.includes("'https://connect.facebook.net/en_US/fbevents.js'"), true);
check("autoConfig is off before init", meta.indexOf("fbq('set','autoConfig',false,'${META_PIXEL_ID}')") > 0 && meta.indexOf("fbq('set','autoConfig'") < meta.indexOf("fbq('init','${META_PIXEL_ID}')"), true);
check("only behind the consent gate and outside /app", ga.indexOf('if (mode !== "load" || inApp) return null;') > 0 && ga.indexOf('if (mode !== "load" || inApp) return null;') < ga.indexOf('<Script id="meta-pixel"'), true);
check("a Meta id alone turns the gate on, and /admin stays off", [/const ANY_TAG = [^;]*META_PIXEL_ID/.test(ga), ga.includes("if (!ANY_TAG) return;"), ga.includes('if (!ANY_TAG || !pathname || pathname.startsWith("/admin")) return null;')], [true, true, true]);
check("paused inside /app, resumed outside", ga.includes('if (inApp) w.fbq?.("consent", "revoke");') && ga.includes('else if (mode === "load") w.fbq?.("consent", "grant");'), true);
check("the privacy page names Meta", src("app/privacy/page.tsx").includes("Meta’s pixel on those same pages"), true);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall pixel checks passed");
