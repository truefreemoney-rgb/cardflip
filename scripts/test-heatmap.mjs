/**
 * Heat map (10-18, lib/heatmap.ts, /api/heat, lib/server/heatmap.ts). Run: npm run test:heatmap
 *
 * Pins: pages are grouped by template and admin/api/unknown pages are never
 * recorded; tap labels never keep an email or a long number; the beacon keeps
 * only well-formed events (a bad tab id, a bot, junk numbers are dropped, taps
 * per view are capped) and always answers 204; the admin reads count visits,
 * one-page visits, exits, scroll depth, next/previous pages and dead taps
 * within one device.
 *
 * Throwaway db: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-heatmap-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { pageKey, pageLabel, cleanLabel, heatDevice, TAPS_PER_VIEW } = await import(at("lib/heatmap.ts"));
const { POST } = await import(at("app/api/heat/route.ts"));
const { getHeatmap } = await import(at("lib/server/heatmap.ts"));
const { db } = await import(at("lib/db.ts"));
const { NextRequest } = await import("next/server");

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("pages and labels");
check("a card page is the card page map", pageKey("/cards/pokemon/base-set/charizard--base1-4"), "/cards/[game]/[set]/[card]");
check("…and reads as 'Card page'", pageLabel(pageKey("/cards/pokemon/base-set/charizard--base1-4")), "Card page");
check("a set page", pageKey("/cards/pokemon/base-set"), "/cards/[game]/[set]");
check("set page 2+", pageKey("/cards/pokemon/base-set/page/2"), "/cards/[game]/[set]/page/[n]");
check("movers is its own map, not a set", pageKey("/cards/pokemon/movers"), "/cards/[game]/movers");
check("query and trailing slash ignored", pageKey("/pricing/?utm_source=x"), "/pricing");
check("home", pageKey("/"), "/");
check("admin is never recorded", pageKey("/admin/heatmap"), null);
check("api is never recorded", pageKey("/api/heat"), null);
check("an unknown page is not recorded", pageKey("/wp-login.php"), null);
check("a label keeps button text", cleanLabel("  Scan   Pokémon Cards "), "Scan Pokémon Cards");
check("an email is hidden", cleanLabel("me@example.com"), "(hidden)");
check("a long number is hidden", cleanLabel("Order 12345678"), "(hidden)");
check("a long label is cut", cleanLabel("x".repeat(80)).length, 48);
check("390 px wide is a phone", heatDevice(390), "phone");
check("1280 px wide is a computer", heatDevice(1280), "desktop");

console.log("beacon");
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const send = (body, ua = UA, ip = "203.0.113.7") =>
  POST(new NextRequest("http://localhost/api/heat", { method: "POST", headers: { "content-type": "application/json", "user-agent": ua, "x-forwarded-for": ip }, body: JSON.stringify(body) }));
const count = async (t) => Number((await db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n);
const card = "/cards/pokemon/base-set/charizard--base1-4";

let res = await send({ tab: "BAD", ev: [{ t: "v", s: 0, p: "/", w: 390 }] });
check("a bad tab id: 204, nothing kept", [res.status, await count("heat_views")], [204, 0]);
res = await send({ tab: "aaaaaaaaaaaa", ev: [{ t: "v", s: 0, p: "/", w: 390 }] }, "Googlebot/2.1");
check("a bot: 204, nothing kept", [res.status, await count("heat_views")], [204, 0]);
await send({ tab: "aaaaaaaaaaaa", ev: [{ t: "v", s: 0, p: "/admin", w: 390 }, { t: "v", s: 1, p: "/", w: "wide" }] });
check("admin pages and junk widths are dropped", await count("heat_views"), 0);

// Visit A (phone): home -> card page -> leaves. Taps on home: two on the scan button, one on nothing.
await send({
  tab: "aaaaaaaaaaaa",
  ev: [
    { t: "v", s: 0, p: "/", w: 390 },
    { t: "c", s: 0, p: "/", w: 390, x: 500, y: 300, h: 844, l: "Scan Pokémon Cards" },
    { t: "c", s: 0, p: "/", w: 390, x: 510, y: 310, h: 844, l: "Scan Pokémon Cards" },
    { t: "c", s: 0, p: "/", w: 390, x: 100, y: 900, h: 844, l: "" },
    { t: "d", s: 0, d: 80 },
    { t: "v", s: 1, p: card, w: 390 },
    { t: "d", s: 1, d: 30 },
  ],
});
// Visit B (phone): home only. Visit C (computer): pricing only.
await send({ tab: "bbbbbbbbbbbb", ev: [{ t: "v", s: 0, p: "/", w: 390 }, { t: "d", s: 0, d: 20 }] });
await send({ tab: "cccccccccccc", ev: [{ t: "v", s: 0, p: "/pricing", w: 1280 }] });
check("three visits, four views kept", [await count("heat_views"), await count("heat_taps")], [4, 3]);
await send({ tab: "dddddddddddd", ev: Array.from({ length: 79 }, (_, i) => (i === 0 ? { t: "v", s: 0, p: "/features", w: 1280 } : { t: "c", s: 0, p: "/features", w: 1280, x: 10, y: 10, h: 800, l: "x" })) });
check(`taps per view are capped at ${TAPS_PER_VIEW}`, Number((await db.prepare("SELECT COUNT(*) AS n FROM heat_taps WHERE page = '/features'").get()).n), TAPS_PER_VIEW);

console.log("admin reads");
const h = await getHeatmap(0, Date.now() + 1000, "phone", "/");
check("phone visits / one-page visits / views", [h.visits, h.oneAndDone, h.pageViews], [2, 1, 3]);
check("home: 2 views, 1 left there, average scroll 50%", h.pages.find((p) => p.page === "/"), { page: "/", label: "Home", views: 2, exits: 1, depth: 50 });
check("card page: 1 view, left there", h.pages.find((p) => p.label === "Card page")?.exits, 1);
check("the computer visit is not on the phone map", h.pages.some((p) => p.page === "/pricing"), false);
check("home -> card page is a step", h.steps, [{ from: "Home", to: "Card page", n: 1 }]);
const d = h.detail;
check("home detail: taps, dead taps, top button", [d.tapCount, d.deadTaps, d.topLabels], [3, 1, [{ label: "Scan Pokémon Cards", n: 2 }]]);
check("home next: card page and left", d.next.map((c) => c.label).sort(), ["Card page", "Left CardFlip"]);
check("home previous: both arrived there first", d.previous, [{ label: "Arrived here first", n: 2 }]);
check("home scroll reach 25/50/75/100", d.reach.map((r) => r.pct), [50, 50, 50, 0]);
check("the preview shows the visited address", d.samplePath, "/");
const desk = await getHeatmap(0, Date.now() + 1000, "desktop", null);
check("computer map: its own pages", desk.pages.map((p) => p.page).sort(), ["/features", "/pricing"]);

console.log(failures === 0 ? "\nall green" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
