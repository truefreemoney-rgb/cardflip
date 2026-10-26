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
 */
import { readFileSync } from "node:fs";

process.env.NEXT_PUBLIC_X_EVENT_SIGNUP = "tw-test-signup";
process.env.NEXT_PUBLIC_X_EVENT_PURCHASE = "tw-test-purchase";

// A page with TikTok already loaded (so its queue never polls) and no Google ids.
const win = { location: { pathname: "/signup" }, ttq: { track() {} } };
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

for (const p of ["/app", "/app/account/welcome", "/app/collection"]) {
  win.location.pathname = p;
  pixelTrack("Subscribe", { value: 9.99 });
  pixelTrack("CompleteRegistration");
}
check("nothing goes to X inside /app", sent.splice(0), []);

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
check("an X id alone turns the gate on, and /admin stays off", [ga.includes("if (!GTAG_ID && !TIKTOK_PIXEL_ID && !X_PIXEL_ID) return;"), ga.includes('if ((!GTAG_ID && !TIKTOK_PIXEL_ID && !X_PIXEL_ID) || !pathname || pathname.startsWith("/admin")) return null;')], [true, true]);
check("the privacy page names X", src("app/privacy/page.tsx").includes("X’s pixel on those same pages"), true);

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall pixel checks passed");
