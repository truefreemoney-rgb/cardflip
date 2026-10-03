/**
 * Public card price pages, sitemaps and page metadata (SEO sweep 09-30). Pure
 * functions and source checks only: no database, no server, no network.
 * Run: npm run test:cardpages
 *
 * Pins:
 *  - keys: the regex runs before any database read (garbage, sealed, graded, '#'
 *    ids, traversal, SQL characters are all refused), Magic's set code folds to
 *    lowercase, every other key is case-sensitive; "--" splits the URL segment;
 *  - slugs: decorative, never contain "--", a wrong slug 308s to the canonical URL;
 *  - the $5 floor: at or over is indexed, under (or flagged, or stale) is noindex,follow,
 *    and a flagged price is never the headline and never in a description;
 *  - sitemaps: /sitemap.xml is an index, children hold at most 10,000 URLs, names
 *    round-trip, the XML is escaped, /login is out;
 *  - seo.ts: every public page carries canonical + og:image + siteName + summary_large_image,
 *    every private page is noindex, the root sets no canonical;
 *  - www -> apex redirect; robots lists /sitemap.xml;
 *  - rendering cost rules in the source (no prerender, revalidate, no cookies/headers, no next/image).
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(name, got, want) {
  try {
    if (typeof want === "function") assert.ok(want(got), name);
    else assert.deepEqual(got, want, name);
    pass++;
  } catch {
    fail++;
    console.log(`FAIL  ${name}\n      got:  ${JSON.stringify(got)}\n      want: ${typeof want === "function" ? "(predicate)" : JSON.stringify(want)}`);
  }
}

const cp = await import(at("lib/cardPages.ts"));
const sx = await import(at("lib/sitemapXml.ts"));
const sp = await import(at("lib/sitemapPages.ts"));
const seo = await import(at("lib/seo.ts"));
const pm = await import(at("lib/pageMeta.ts"));
const sd = await import(at("lib/structuredData.ts"));
const { PRICING } = await import(at("lib/pricing.ts"));
const { helpArticles } = await import(at("lib/helpArticles.ts"));
const proxyMod = await import(at("proxy.ts"));
const robots = (await import(at("app/robots.ts"))).default();

// --- 1. keys ---------------------------------------------------------------------

console.log("keys");
const ok = (g, k, want = k) => check(`${g} key ${k}`, cp.parseCardKey(g, k), want);
const bad = (g, k) => check(`${g} key refused: ${JSON.stringify(k).slice(0, 40)}`, cp.parseCardKey(g, k), null);
ok("pokemon", "base1-4");
ok("pokemon", "swsh12pt5gg-GG01");
ok("pokemon", "base1-4-1st");
ok("pokemon", "sv3pt5-199");
ok("mtg", "lea-232");
ok("mtg", "LEA-232", "lea-232"); // folded: the page then redirects to the lowercase address
ok("mtg", "plst-M11-153");
ok("mtg", "sld-1001\u2605");
ok("lorcana", "crd_1a2b3c4d5e6f");
ok("onepiece", "OP01-077");
ok("onepiece", "OP01-077_p1");
ok("onepiece", "ST01-012_r1");
ok("yugioh", "ygo-12345");
ok("yugioh", "ygo-12345-1st");
for (const g of ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]) {
  bad(g, "");
  bad(g, "../etc/passwd");
  bad(g, "a/b");
  bad(g, "x' OR 1=1 --");
  bad(g, "a;drop table cards");
  bad(g, "x".repeat(200));
  bad(g, "sealed-base1");
  bad(g, "tcgp-sealed-foo");
  bad(g, "graded-psa-10-base1-4");
  bad(g, "%00");
}
bad("onepiece", "OP01-077#2"); // positional ids can renumber: no page
bad("lorcana", "base1-4");
bad("yugioh", "base1-4");
bad("mtg", "justoneword");
bad("pokemon", "-leading");
check("an encoded key is decoded", cp.parseCardKey("mtg", "sld-1001%E2%98%85"), "sld-1001\u2605");
check("a broken escape is refused, not thrown", cp.parseCardKey("pokemon", "base1-4%E0%A4%A"), null);

check("segment splits on the first --", cp.parseCardSegment("charizard--base1-4"), { nameSlug: "charizard", key: "base1-4" });
check("a key may hold a single dash", cp.parseCardSegment("a-b--OP01-077_p1"), { nameSlug: "a-b", key: "OP01-077_p1" });
check("no -- means no card", cp.parseCardSegment("charizard"), null);
check("an overlong segment is refused", cp.parseCardSegment("x".repeat(300) + "--a"), null);

// --- 2. slugs and URLs -----------------------------------------------------------

console.log("slugs and urls");
check("slug: accents", cp.slugify("Flab\u00e9b\u00e9"), "flabebe");
check("slug: apostrophe", cp.slugify("Sheoldred's Edict"), "sheoldreds-edict");
check("slug: ampersand", cp.slugify("Gold & Silver"), "gold-and-silver");
check("slug: punctuation collapses", cp.slugify("Pikachu -- V (Full Art)"), "pikachu-v-full-art");
check("slug: never empty", cp.slugify("!!!"), "card");
check("slug: never has --", ["A -- B", "a---b", "--x--", "Yu-Gi-Oh! -- Dark"].every((s) => !cp.slugify(s).includes("--")), true);
check("slug: capped", cp.slugify("a".repeat(200)).length <= 60, true);
check("slug: Yu-Gi-Oh!", cp.slugify("Yu-Gi-Oh! Legacy of the Duelist"), "yu-gi-oh-legacy-of-the-duelist");

check("game slugs", [cp.CARD_GAME_SLUGS.pokemon, cp.CARD_GAME_SLUGS.mtg, cp.CARD_GAME_SLUGS.lorcana, cp.CARD_GAME_SLUGS.onepiece, cp.CARD_GAME_SLUGS.yugioh], ["pokemon", "magic", "lorcana", "one-piece", "yugioh"]);
check("game from slug", [cp.gameFromSlug("magic"), cp.gameFromSlug("one-piece"), cp.gameFromSlug("mtg"), cp.gameFromSlug("")], ["mtg", "onepiece", null, null]);
check("card path", cp.cardPath("pokemon", "base-set", "Charizard", "base1-4"), "/cards/pokemon/base-set/charizard--base1-4");
check("card path round trip", cp.parseCardSegment(cp.cardPath("mtg", "alpha", "Black Lotus", "lea-232").split("/").pop()), { nameSlug: "black-lotus", key: "lea-232" });
check("card path encodes a star", cp.cardPath("mtg", "x", "Y", "sld-1001\u2605").endsWith("--sld-1001%E2%98%85"), true);
check("hub paths", [cp.gamePath("onepiece"), cp.setPath("yugioh", "lob")], ["/cards/one-piece", "/cards/yugioh/lob"]);
check("magic key from a row", cp.cardKey("mtg", { id: "uuid", setCode: "LEA", number: "232" }), "lea-232");
check("other keys are the id", cp.cardKey("pokemon", { id: "base1-4" }), "base1-4");

const canon = { game: "pokemon", setSlug: "base-set", name: "Charizard", key: "base1-4" };
check("canonical: same = no redirect", cp.canonicalRedirect({ game: "pokemon", set: "base-set", nameSlug: "charizard", key: "base1-4" }, canon), null);
check("canonical: wrong name slug 308s", cp.canonicalRedirect({ game: "pokemon", set: "base-set", nameSlug: "zzz", key: "base1-4" }, canon), "/cards/pokemon/base-set/charizard--base1-4");
check("canonical: wrong set slug 308s", cp.canonicalRedirect({ game: "pokemon", set: "other", nameSlug: "charizard", key: "base1-4" }, canon), "/cards/pokemon/base-set/charizard--base1-4");
check("canonical: uppercase magic key 308s", cp.canonicalRedirect({ game: "magic", set: "alpha", nameSlug: "black-lotus", key: "LEA-232" }, { game: "mtg", setSlug: "alpha", name: "Black Lotus", key: "lea-232" }), "/cards/magic/alpha/black-lotus--lea-232");

const slugs = cp.setSlugs([
  { key: "sv1", name: "Trainer Gallery", code: "TG", release: "2022-01-01" },
  { key: "sv2", name: "Trainer Gallery", code: "TG2", release: "2023-01-01" },
  { key: "sv3", name: "Base Set", code: "BS", release: "1999-01-09" },
]);
check("set slugs: the older keeps the plain slug", [slugs.get("sv1"), slugs.get("sv3")], ["trainer-gallery", "base-set"]);
check("set slugs: the newer gets its code", slugs.get("sv2"), "trainer-gallery-tg2");
check("set slugs: stable when a set is added later", cp.setSlugs([{ key: "sv0", name: "Trainer Gallery", code: "X", release: "2024-01-01" }, { key: "sv1", name: "Trainer Gallery", code: "TG", release: "2022-01-01" }]).get("sv1"), "trainer-gallery");
check("set slug pattern", [cp.isSetSlug("base-set"), cp.isSetSlug("Base Set"), cp.isSetSlug("../x"), cp.isSetSlug("a".repeat(120))], [true, false, false, false]);

// --- 3. the $5 floor, freshness, the guard ---------------------------------------

console.log("floor and guard");
check("floor is $5", cp.INDEX_FLOOR_USD, 5);
const today = "2026-09-30";
const mk = (variant, startDay, prices, flag = null) => ({ variant, startDay, prices, flag });
const fresh = (p, variant = "holofoil", flag = null) => mk(variant, "2026-09-28", [p, p, p], flag);
check("lastPoint skips trailing nulls", cp.lastPoint("2026-09-28", [4, 5, null]), { day: "2026-09-29", price: 5 });
check("lastPoint of nothing", cp.lastPoint("2026-09-28", [null, null]), null);
check("a week-old price is stale", [cp.isFresh("2026-09-23", today), cp.isFresh("2026-09-22", today)], [true, false]);

const prices5 = cp.variantPrices("pokemon", [fresh(5)], today);
check("$5.00 is indexed", cp.indexDecision(prices5), { index: true, reason: "ok" });
check("$4.99 is not", cp.indexDecision(cp.variantPrices("pokemon", [fresh(4.99)], today)), { index: false, reason: "below-floor" });
// Long-tail games (10-02): $1 floor for One Piece, Lorcana and Yu-Gi-Oh!; Pokémon and Magic keep $5.
check("long-tail floor is $1", [cp.LONG_TAIL_FLOOR_USD, cp.indexFloorUsd("onepiece"), cp.indexFloorUsd("lorcana"), cp.indexFloorUsd("yugioh")], [1, 1, 1, 1]);
check("Pokémon and Magic keep the $5 floor", [cp.indexFloorUsd("pokemon"), cp.indexFloorUsd("mtg")], [5, 5]);
check("a $1.00 Yu-Gi-Oh! card is indexed at its floor", cp.indexDecision(cp.variantPrices("yugioh", [fresh(1)], today), cp.indexFloorUsd("yugioh")), { index: true, reason: "ok" });
check("a $0.99 one is not", cp.indexDecision(cp.variantPrices("yugioh", [fresh(0.99)], today), cp.indexFloorUsd("yugioh")), { index: false, reason: "below-floor" });
check("the sitemap and the card loader use the per-game floor", [/indexFloorUsd\(game\)/.test(read("src/lib/server/cardSitemap.ts")), /indexDecision\(prices, indexFloorUsd\(facts\.game\)\)/.test(read("src/lib/server/cardPages.ts"))], [true, true]);
check("no page names the flat floor any more", ["src/app/cards/page.tsx", "src/app/cards/[game]/page.tsx", "src/app/cards/[game]/[set]/page.tsx"].some((f) => /INDEX_FLOOR_USD/.test(read(f))), false);
check("no price is not", cp.indexDecision([]), { index: false, reason: "no-price" });
check("a stale price is dropped", cp.variantPrices("pokemon", [mk("holofoil", "2026-09-01", [50, 50])], today), []);
const flagged = cp.variantPrices("pokemon", [fresh(900, "holofoil", { hard: true, reason: "cardmarket 20x" })], today);
check("a flagged price is kept as a row but never the headline", [flagged.length, cp.headlinePrice(flagged)], [1, null]);
check("a page with only flagged prices is noindex", cp.indexDecision(flagged), { index: false, reason: "flagged" });
const mixed = cp.variantPrices("pokemon", [fresh(900, "holofoil", { hard: false, reason: "flat" }), fresh(6, "reverseHolofoil")], today);
check("the headline skips the flagged printing", cp.headlinePrice(mixed)?.variant, "reverseHolofoil");
check("a flagged $900 does not make a page indexable on its own", cp.indexDecision(cp.variantPrices("pokemon", [fresh(900, "holofoil", { hard: true, reason: "x" }), fresh(2, "reverseHolofoil")], today)).index, false);
check("printings sort usual-first", cp.variantPrices("pokemon", [fresh(3, "reverseHolofoil"), fresh(9, "holofoil"), fresh(1, "normal")], today).map((p) => p.variant), ["normal", "holofoil", "reverseHolofoil"]);
check("one price line for Yu-Gi-Oh! and One Piece", [cp.variantLabel("yugioh", "normal"), cp.variantLabel("onepiece", "normal")], ["Market price", "Market price"]);

const young = (p) => cp.variantPrices("yugioh", [mk("normal", "2026-09-30", [p])], today);
const old = (p) => cp.variantPrices("yugioh", [mk("normal", "2026-09-01", Array.from({ length: 30 }, () => p))], today);
check("a priced day is counted per printing", [young(10)[0].days, old(10)[0].days], [1, 30]);
check("an unverified price: four figures on a day of history", [cp.isUnverified({ price: 1000, days: 1 }), cp.isUnverified({ price: 999, days: 1 }), cp.isUnverified({ price: 5000, days: cp.MATURE_PRICED_DAYS })], [true, false, false]);
check("a day-old $213,589 card is noindex and never printed (soft flag, no headline)", [cp.indexDecision(young(213589)), young(213589)[0].flag?.hard, cp.headlinePrice(young(213589))], [{ index: false, reason: "flagged" }, false, null]);
check("the same price with two weeks of history is indexed", cp.indexDecision(old(2500)), { index: true, reason: "ok" });
check("a day-old $40 card is indexed", cp.indexDecision(young(40)), { index: true, reason: "ok" });
check("mature days match the guard's minPricedDays", cp.MATURE_PRICED_DAYS, (await import(at("lib/server/priceTrust.ts"))).PRICE_TRUST.minPricedDays);

// change words: a young series says nothing rather than guessing
const pts = (n, f) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.UTC(2026, 8, 30) - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10), price: f(i) }));
check("30-day change", cp.changeOver(pts(40, (i) => (i < 10 ? 10 : 12)), 30)?.pct, (v) => Math.abs(v - 20) < 0.001);
check("a 5-day series has no 30-day change", cp.changeOver(pts(5, () => 10), 30), null);
check("words: up", cp.changeWords(12.34, 30), "Up 12.3% over the last 30 days");
check("words: down", cp.changeWords(-7.06, 90), "Down 7.1% over the last 90 days");
check("words: flat", cp.changeWords(0.2, 30), "Little changed over the last 30 days");
check("chart needs a week of points", cp.CHART_MIN_POINTS, 7);
check("a price's day is shown in Eastern", cp.priceDayLabel("2026-09-30"), "Sep 30, 2026");

// --- 4. card metadata ------------------------------------------------------------

console.log("card metadata");
const facts = { game: "pokemon", id: "base1-4", key: "base1-4", name: "Charizard", number: "4/102", setKey: "base1", setSlug: "base-set", setName: "Base Set", setCode: "base1", release: "1999-01-09", rarity: "", tags: [], image: "https://assets.tcgdex.net/en/base/base1/4/high.webp" };
const view = (prices, f = facts) => ({ facts: f, prices, headline: cp.headlinePrice(prices), decision: cp.indexDecision(prices) });
const v5 = view(prices5);
const m5 = cp.cardMetadata(v5);
check("H1 has name, number, set, price", cp.cardHeading(facts), "Charizard 4/102 Base Set price");
check("indexable page has no robots tag", m5.robots, undefined);
check("canonical is the card path", m5.alternates?.canonical, "/cards/pokemon/base-set/charizard--base1-4");
check("og image is the card art", m5.openGraph?.images?.[0]?.url, facts.image);
check("description prints the price as of its day", m5.description, (d) => d.includes("$5.00") && d.includes("Sep 30, 2026") && d.length <= 155);
const longFacts = { ...facts, name: "Torrential Tribute", number: "HL04-EN006", setName: "Hobby League 4 Special Promotional Collection", tags: ["Parallel Rare", "1st Edition"] };
const mLong = cp.cardMetadata(view(cp.variantPrices("pokemon", [fresh(12.46)], today), longFacts));
check("description: the cents of a price never start the clip, and it fits", mLong.description, (d) => d.startsWith("Torrential Tribute") && d.includes("$12.46") && d.length <= 155);
check("clipDescription splits on sentence ends, not on the dot in a price", seo.clipDescription("Card costs $12.46 today. " + "Second sentence here. ".repeat(10), 60), "Card costs $12.46 today. Second sentence here.");
const mBelow = cp.cardMetadata(view(cp.variantPrices("pokemon", [fresh(3)], today)));
check("below the floor: noindex,follow", mBelow.robots, { index: false, follow: true });
const mFlag = cp.cardMetadata(view(flagged));
check("flagged: noindex and the number is not in the description", [mFlag.robots, String(mFlag.description).includes("900")], [{ index: false, follow: true }, false]);
check("Lorcana (AVIF) shares the default card", cp.shareImage({ game: "lorcana", image: "https://cards.lorcast.io/x.avif" }), null);
check("an AVIF from any host shares the default card", cp.shareImage({ game: "pokemon", image: "https://x/y.avif?a=1" }), null);
const long = { ...facts, name: "Charizard ex Special Illustration Rare Premium Collection Promo", setName: "Scarlet and Violet 151 Ultra Premium Collection", tags: ["1st Edition", "Holo"] };
check("title stays within 60 and keeps the word price", cp.cardTitle(long), (t) => t.length <= 60 && t.endsWith("price"));
check("1st Edition stays in the heading", cp.cardHeading({ ...facts, tags: ["1st Edition"] }), (h) => h.includes("1st Edition"));
check("facts paragraph states only catalog facts", cp.factsParagraph(facts), "Charizard is card 4/102 in Base Set, released Jan 9, 1999.");
check("Yu-Gi-Oh! tags", cp.printingTags("yugioh", { id: "ygo-1-1st", rarity: "Ultra Rare", variant: null }), ["Ultra Rare", "1st Edition"]);
check("Pok\u00e9mon 1st-Edition twin is excluded nowhere: its key is valid", cp.parseCardKey("pokemon", "base1-4-1st"), "base1-4-1st");
check("exclusions", [cp.cardExclusion("pokemon", "sealed-x", true, "i"), cp.cardExclusion("pokemon", "base1-4", false, "i"), cp.cardExclusion("pokemon", "base1-4", true, ""), cp.cardExclusion("pokemon", "base1-4", true, "i")], ["bad-key", "orphan", "no-image", null]);
check("card JSON-LD: a Product with no offers and no ratings", sd.cardGraph(v5), (g) => g["@type"] === "Product" && g.sku === "base1-4" && !("offers" in g) && !("aggregateRating" in g) && g.image === facts.image);

// --- 5. sitemaps -----------------------------------------------------------------

console.log("sitemaps");
check("chunk size is at most 10,000", cp.SITEMAP_CHUNK <= 10_000, true);
check("chunk counts", [sx.chunkCount(0), sx.chunkCount(1), sx.chunkCount(10_000), sx.chunkCount(10_001), sx.chunkCount(21_100)], [0, 1, 1, 2, 3]);
const children = sx.sitemapChildren({ pokemon: 8600, mtg: 21100, lorcana: 483, onepiece: 892, yugioh: 8100 }, "2026-09-30");
check("children: pages + 1 + 3 + 1 + 1 + 1 files", children.map((c) => c.name), ["pages.xml", "cards-pokemon-1.xml", "cards-magic-1.xml", "cards-magic-2.xml", "cards-magic-3.xml", "cards-lorcana-1.xml", "cards-one-piece-1.xml", "cards-yugioh-1.xml"]);
check("children: a game with no cards has no file", sx.sitemapChildren({ pokemon: 10 }).map((c) => c.name), ["pages.xml", "cards-pokemon-1.xml"]);
check("names round-trip", children.slice(1).every((c) => { const p = sx.parseSitemapName(c.name); return p && p !== "pages" && sx.cardSitemapName(p.game, p.chunk) === c.name; }), true);
check("parse: pages", sx.parseSitemapName("pages.xml"), "pages");
check("parse: one-piece", sx.parseSitemapName("cards-one-piece-2.xml"), { game: "onepiece", chunk: 2 });
for (const n of ["", "cards-x-1.xml", "cards-magic-0.xml", "cards-magic-1.xml.gz", "../sitemap.xml", "cards-magic-1", "cards-magic--1.xml", "cards-magic-99999.xml", "PAGES.xml"]) check(`parse refuses ${JSON.stringify(n)}`, sx.parseSitemapName(n), null);
const idx = sx.indexXml(children);
check("index XML shape", [idx.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), idx.includes("<sitemapindex xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"), (idx.match(/<sitemap>/g) ?? []).length], [true, true, children.length]);
check("index locs are absolute under /sitemaps/", idx.includes("<loc>https://cardflip.io/sitemaps/cards-magic-2.xml</loc>") || idx.includes("/sitemaps/cards-magic-2.xml</loc>"), true);
const us = sx.urlsetXml([{ path: "/cards/magic/a-b/x--lea-232", lastmod: "2026-09-30" }, { path: "/cards/x?a=1&b=2" }, { path: "/cards/o'brien<tag>" }]);
check("urlset XML shape", [us.includes("<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">"), (us.match(/<url>/g) ?? []).length, us.includes("<lastmod>2026-09-30</lastmod>")], [true, 3, true]);
check("urlset escapes & ' <", [us.includes("a=1&amp;b=2"), us.includes("o&apos;brien&lt;tag&gt;"), /&(?!amp;|apos;|lt;|gt;|quot;)/.test(us)], [true, true, false]);
check("a full chunk is one valid file", sx.urlsetXml(Array.from({ length: cp.SITEMAP_CHUNK }, (_, i) => ({ path: `/cards/pokemon/s/c${i}--x${i}` }))).split("<url>").length - 1, cp.SITEMAP_CHUNK);

const stat = sp.staticEntries(helpArticles.map((a) => a.id));
const statPaths = stat.map((e) => e.path);
check("static pages: no /login, no private pages", statPaths.some((p) => p === "/login" || p.startsWith("/app") || p.startsWith("/admin") || p === "/reset-password"), false);
check("static pages: home, pricing, cards, signup, terms, privacy", ["/", "/pricing", "/help", "/cards", "/signup", "/terms", "/privacy"].every((p) => statPaths.includes(p)), true);
check("static pages: every help article has a URL", helpArticles.every((a) => statPaths.includes(`/help/${a.id}`)), true);
check("static pages: no duplicates", new Set(statPaths).size, statPaths.length);

// --- 6. seo metadata helper ------------------------------------------------------

console.log("seo metadata");
const base = seo.pageMetadata({ title: "Pricing", description: "d", path: "/pricing" });
check("always sets canonical", base.alternates?.canonical, "/pricing");
check("always sets og image, site name, type, url", [base.openGraph?.images?.[0]?.url, base.openGraph?.siteName, base.openGraph?.type, base.openGraph?.url], ["/opengraph-image", "CardFlip", "website", "/pricing"]);
check("always sets the large twitter card with an image", [base.twitter?.card, base.twitter?.images], ["summary_large_image", ["/opengraph-image"]]);
check("a page image replaces the default in both", (() => { const m = seo.pageMetadata({ title: "t", description: "d", path: "/x", image: "https://img/a.webp" }); return [m.openGraph?.images?.[0]?.url, m.twitter?.images]; })(), ["https://img/a.webp", ["https://img/a.webp"]]);
check("an absolute title skips the template", seo.pageMetadata({ title: "T", absoluteTitle: true, description: "d", path: "/x" }).title, { absolute: "T" });
check("noindex keeps following links", seo.pageMetadata({ title: "t", description: "d", path: "/x", noindex: true }).robots, { index: false, follow: true });
check("private metadata", [seo.noindexMetadata("x").robots, seo.noindexMetadata("x", { follow: true }).robots], [{ index: false, follow: false }, { index: false, follow: true }]);
check("clipDescription fits", [seo.clipDescription("A short one.").length, seo.clipDescription("Sentence one is here. ".repeat(20)).length <= 155, seo.clipDescription("x".repeat(400)).length <= 155], [12, true, true]);

for (const [name, m] of Object.entries(pm.PUBLIC_META)) {
  const og = m.openGraph;
  check(`public ${name}: canonical, image, site name, large twitter card, description, indexable`, [
    typeof m.alternates?.canonical === "string" && m.alternates.canonical.startsWith("/"),
    Boolean(og?.images?.[0]?.url),
    og?.siteName,
    m.twitter?.card,
    typeof m.description === "string" && m.description.length > 20 && m.description.length <= 160,
    m.robots,
  ], [true, true, "CardFlip", "summary_large_image", true, undefined]);
}
check("canonicals are distinct", new Set(Object.values(pm.PUBLIC_META).map((m) => m.alternates.canonical)).size, Object.keys(pm.PUBLIC_META).length);
for (const [name, m] of Object.entries(pm.PRIVATE_META)) check(`private ${name} is noindex and has no canonical`, [m.robots?.index, m.alternates], [false, undefined]);
check("login is noindex (and so out of the sitemap)", [pm.PRIVATE_META.login.robots?.index, statPaths.includes("/login")], [false, false]);
check("home title names what it is and the games", pm.HOME_TITLE, (t) => /card scanner/i.test(t) && /Pok.mon/.test(t) && t.includes("Yu-Gi-Oh!") && !/!!/.test(t));
const art = pm.helpArticleMetadata(helpArticles[0]);
check("help article: own canonical and the full block", [art.alternates?.canonical, art.openGraph?.siteName, art.twitter?.card], [`/help/${helpArticles[0].id}`, "CardFlip", "summary_large_image"]);

// --- 7. structured data ----------------------------------------------------------

console.log("structured data");
const graph = sd.siteGraph();
const offers = graph["@graph"].find((n) => n["@type"] === "SoftwareApplication").offers;
check("offers: free trial, Scan Pack, both plans, from pricing.ts", offers.map((o) => [o.name, o.price]), [["Free trial", "0.00"], ["Scan Pack", PRICING.pack.price.toFixed(2)], ["CardFlip", PRICING.standard.price.toFixed(2)], ["CardFlip Pro", PRICING.pro.price.toFixed(2)]]);
check("description names all five games", sd.DESCRIPTION, (d) => ["Pok", "Magic", "Lorcana", "Yu-Gi-Oh!", "One Piece"].every((g) => d.includes(g)));

// --- 8. www redirect, robots -----------------------------------------------------

console.log("www and robots");
check("www redirects to the apex with path and query", proxyMod.wwwRedirectUrl("www.cardflip.io", "/cards/magic/a/b--lea-1", "?x=1"), "https://cardflip.io/cards/magic/a/b--lea-1?x=1");
check("www with a port and capitals", proxyMod.wwwRedirectUrl("WWW.cardflip.io:443", "/", ""), "https://cardflip.io/");
check("the apex is left alone", [proxyMod.wwwRedirectUrl("cardflip.io", "/", ""), proxyMod.wwwRedirectUrl(null, "/", ""), proxyMod.wwwRedirectUrl("localhost:3000", "/", ""), proxyMod.wwwRedirectUrl("www.cardflip.io.evil.com", "/", "")], [null, null, null, null]);
check("robots lists the sitemap index", robots.sitemap, "https://cardflip.io/sitemap.xml");
const disallow = robots.rules[0].disallow;
check("robots: private areas disallowed, /reset-password is not (its noindex must be readable)", [disallow.includes("/app"), disallow.includes("/api/"), disallow.includes("/admin"), disallow.includes("/reset-password"), disallow.includes("/cards")], [true, true, true, false, false]);

// --- 9. rendering cost and site rules, read from the source ----------------------

console.log("source rules");
function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
const rootDir = fileURLToPath(new URL("../", import.meta.url));
const cardFiles = walk(path.join(rootDir, "src/app/cards")).filter((f) => /\.tsx?$/.test(f));
check("card routes exist: index, game, set, card", ["page.tsx", "[game]/page.tsx", "[game]/[set]/page.tsx", "[game]/[set]/[card]/page.tsx"].every((p) => existsSync(path.join(rootDir, "src/app/cards", p))), true);
for (const f of cardFiles) {
  const rel = path.relative(rootDir, f).replaceAll("\\", "/");
  const src = readFileSync(f, "utf8");
  check(`${rel}: revalidate = 172800`, /export const revalidate = 172800;/.test(src), true);
  if (rel.includes("[")) check(`${rel}: nothing prerendered at build`, /export const generateStaticParams = async \(\) => \[\];/.test(src), true);
  check(`${rel}: no cookies(), headers() or next/image`, /cookies\(|headers\(|next\/image|force-dynamic/.test(src), false);
}
const cardPageSrc = read("src/app/cards/[game]/[set]/[card]/page.tsx");
check("card page: loader is React cache()", /const load = cache\(/.test(cardPageSrc), true);
check("card page: key is checked before the database", cardPageSrc.indexOf("parseCardKey(") < cardPageSrc.indexOf("publicCardGame(") && cardPageSrc.indexOf("publicCardGame(") < cardPageSrc.indexOf("loadCardRecord("), true);
check("card page: mismatch is a 308", /permanentRedirect\(/.test(cardPageSrc), true);
check("card page: games are gated", /publicCardGame\(/.test(cardPageSrc), true);
const serverSrc = read("src/lib/server/cardPages.ts");
check("loaders: every game goes through gamePublic", /gamePublic\(/.test(serverSrc), true);
check("loaders: the price guard runs on every read", [/judgeSeries\(/.test(serverSrc), /loadTrustData\(/.test(serverSrc)], [true, true]);
check("loaders: no cookies/headers", /next\/headers/.test(serverSrc), false);
check("pages print prices only through PriceCell / the guarded view", /PriceFlagText/.test(read("src/components/CardPagesUi.tsx")), true);
check("sitemap.xml route is the index", /indexXml\(/.test(read("src/app/sitemap.xml/route.ts")), true);
check("child sitemaps: on-demand, cached a day", [/revalidate = 86400/.test(read("src/app/sitemaps/[name]/route.ts")), /generateStaticParams = async \(\) => \[\]/.test(read("src/app/sitemaps/[name]/route.ts"))], [true, true]);
check("the old Next sitemap.ts is gone (it would collide with the index)", existsSync(path.join(rootDir, "src/app/sitemap.ts")), false);
check("Google verification file kept", existsSync(path.join(rootDir, "public/google81bdfeef3799afa3.html")), true);
const layoutSrc = read("src/app/layout.tsx");
check("root layout sets no canonical and no JSON-LD", [/alternates/.test(layoutSrc), /JsonLd/.test(layoutSrc)], [false, false]);
check("no search-console verification change (env-driven, as before)", /BING_SITE_VERIFICATION/.test(layoutSrc) && /GOOGLE_SITE_VERIFICATION/.test(layoutSrc), true);
check("egg is noindex", /PRIVATE_META\.egg/.test(read("src/app/egg/layout.tsx")), true);
check("not-found is noindex", /PRIVATE_META\.notFound/.test(read("src/app/not-found.tsx")), true);

// --- 10. card story: the unique words on every card page (10-02) ------------------

console.log("card story");
const cs = await import(at("lib/cardStory.ts"));
const fees = await import(at("lib/fees.ts"));
const quarter = cs.sellMath(0.25);
check("sell math: a $0.25 card lists at $1.50 (Chris 09-30) and the seller keeps its value", [quarter.ask, quarter.covers, quarter.net >= 0.25], [1.5, "all", true]);
check("sell math: $7.50 lists at $8.68 (the taper)", [cs.sellMath(7.5).ask, cs.sellMath(7.5).covers], [8.68, "part"]);
const twentyFive = cs.sellMath(25);
check("sell math: from $10 up the market price stands and the net is ask − fees − postage", [twentyFive.covers, twentyFive.net], ["none", Math.round((twentyFive.ask - fees.estimatedEbayFees(twentyFive.ask) - fees.POSTAGE_USD) * 100) / 100]);
check("sell words: a cheap card is not worth selling on its own", cs.sellWords("Spidops", 0.25).verdict, "Not on its own.");
check("sell words: a $25 card is", cs.sellWords("Charizard", 25).verdict, "Yes.");
check("sell words: the detail names the card, the eBay Suggested Price and what you keep", cs.sellWords("Charizard", 25).detail, (d) => d.includes("Charizard") && d.includes("eBay Suggested Price") && d.includes("keep about $"));
check("sell words: never the word TCGplayer", cs.sellWords("Charizard", 25).detail.toLowerCase().includes("tcgplayer"), false);
check("sell words: no price, no sentence", cs.sellWords("Charizard", 0), null);
const storyPts = [
  { day: "2026-07-01", price: 10 },
  { day: "2026-07-15", price: 14.2 },
  { day: "2026-08-20", price: 9.8 },
  { day: "2026-09-30", price: 13.5 },
];
const range = cs.historyRange(storyPts);
check("range: high, low, inclusive days", [range.high.price, range.low.price, range.days], [14.2, 9.8, 92]);
check("range: one point is no range", cs.historyRange(storyPts.slice(0, 1)), null);
check("range words: near the top", cs.rangeWords(range, { price: 13.5, day: "2026-09-30" }), "Across 92 days of daily prices, the high was $14.20 on Jul 15, 2026 and the low $9.80 on Aug 20, 2026. Today's price sits near the top of that range.");
check("range words: at the high", cs.rangeWords(range, { price: 14.2, day: "2026-09-30" }), (s) => s.endsWith("Today's price is the highest CardFlip has recorded for this card."));
check("range words: flat", cs.rangeWords(cs.historyRange([{ day: "2026-09-01", price: 5 }, { day: "2026-09-02", price: 5 }]), { price: 5, day: "2026-09-02" }), (s) => s.endsWith("The price has not moved in that time."));
check("scan words: name, number, set and the free scans", cs.scanWords(facts), (s) => s.includes("Charizard 4/102 in Base Set") && s.includes(`${PRICING.trial.scans} scans are free`));
check("scan words: the printing tags ride along", cs.scanWords({ ...facts, game: "yugioh", tags: ["Ultra Rare", "1st Edition"] }), (s) => s.includes("(Ultra Rare, 1st Edition)") && s.includes("set code and the rarity"));
const storyPageSrc = read("src/app/cards/[game]/[set]/[card]/page.tsx");
check("the card page prints the sell line, the range and the scan angle", [/sellWords\(/.test(storyPageSrc), /rangeWords\(/.test(storyPageSrc), /scanWords\(/.test(storyPageSrc)], [true, true, true]);
check("the range's ends go through the guard's old-side check", /old: \{ back, value: end\.price \}/.test(serverSrc), true);

console.log(`\ncard pages: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
