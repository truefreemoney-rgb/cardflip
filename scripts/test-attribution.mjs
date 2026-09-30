/**
 * Signup attribution (lib/attribution.ts, 09-30): which post brought the person.
 * Run: npm run test:attribution
 *
 * Pins: classifySource (tag beats referrer; search, social hosts, other:<host>,
 * direct); parseTouch sanitizing and dropping what is malformed; first touch wins
 * for 30 days and a real source replaces a stored "direct"; trackedUrl / shortPath /
 * draftCampaign; the proxy's short-link 302 (and that no real route uses those
 * segments); Bluesky's facet carries the utm uri while the text stays cardflip.io;
 * every site's post still fits its limit with the short path or "Link in bio" in
 * place of the plain address; and that the pages are wired (layout mounts the
 * capture, signup sends the touch, the first visit ping carries the tag, the
 * privacy page says so).
 *
 * The DB-backed halves live in test-analytics (visit ping, signups by source) and
 * test-auth-routes (signup writes the columns, malformed dropped).
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// social.ts opens the database on import; keep it in a throwaway directory.
const work = mkdtempSync(path.join(tmpdir(), "cardflip-attribution-test-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const repo = (p) => new URL(`../${p}`, import.meta.url);
const A = await import(at("lib/attribution.ts"));
const { proxy } = await import(at("proxy.ts"));
const { NextRequest } = await import("next/server");

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

console.log("classifySource: a tag wins, then the referrer, else direct");
const table = [
  ["bluesky", "", "bluesky"], ["Bluesky", "", "bluesky"], ["bsky", "", "bluesky"],
  ["x", "", "x"], ["twitter", "", "x"], ["facebook", "", "facebook"], ["fb", "", "facebook"],
  ["instagram", "", "instagram"], ["ig", "", "instagram"], ["threads", "", "threads"], ["tiktok", "", "tiktok"],
  ["pinterest", "", "pinterest"], ["GOOGLE", "", "search"], ["bing", "", "search"],
  ["newsletter", "", "other:newsletter"], ["x", "google.com", "x"], ["bluesky", "t.co", "bluesky"],
  ["", "bsky.app", "bluesky"], ["", "x.com", "x"], ["", "t.co", "x"], ["", "twitter.com", "x"],
  ["", "l.facebook.com", "facebook"], ["", "m.facebook.com", "facebook"], ["", "facebook.com", "facebook"],
  ["", "instagram.com", "instagram"], ["", "l.instagram.com", "instagram"], ["", "threads.net", "threads"],
  ["", "tiktok.com", "tiktok"], ["", "vm.tiktok.com", "tiktok"],
  ["", "pinterest.com", "pinterest"], ["", "pinterest.co.uk", "pinterest"], ["", "pin.it", "pinterest"],
  ["", "google.com", "search"], ["", "google.co.uk", "search"], ["", "bing.com", "search"], ["", "duckduckgo.com", "search"],
  ["", "search.brave.com", "search"], ["", "ecosia.org", "search"], ["", "yandex.ru", "search"],
  ["", "news.example.org", "other:news.example.org"], ["", "reddit.com", "other:reddit.com"],
  // Look-alikes do not borrow a real source's name.
  ["", "notgoogle.com", "other:notgoogle.com"], ["", "fakefacebook.com", "other:fakefacebook.com"], ["", "x.com.evil.org", "other:x.com.evil.org"],
  ["", "", "direct"], [undefined, null, "direct"], [42, {}, "direct"],
];
for (const [utm, ref, want] of table) check(`utm ${JSON.stringify(utm)}, referrer ${JSON.stringify(ref)} -> ${want}`, A.classifySource(utm, ref), want);
check("source labels: plain words for the admin table", ["bluesky", "x", "search", "direct", "unknown", "other:reddit.com"].map(A.sourceLabel), ["Bluesky", "X", "Search engines", "Direct", "Not recorded", "reddit.com"]);

console.log("parseTouch: sanitized, and malformed is dropped");
for (const bad of [null, undefined, "nope", 5, [], {}, { s: "evil" }, { s: 5 }, { s: "other:" + "a".repeat(100) }, { s: "" }]) {
  check(`dropped: ${JSON.stringify(bad)?.slice(0, 30)}`, A.parseTouch(bad), null);
}
check("a bare source is enough; the rest defaults blank", A.parseTouch({ s: "bluesky" }), { s: "bluesky", m: "", c: "", refHost: "", landing: "", t: 0 });
check("fields are lowercased and stripped to [a-z0-9._-]", A.parseTouch({ s: " BlueSky ", m: "Social!!", c: "Pokemon Set 0930<script>", refHost: "L.Facebook.com/x", landing: "/a b?x=1#top", t: 12.9 }), { s: "bluesky", m: "social", c: "pokemonset0930script", refHost: "l.facebook.comx", landing: "/ab", t: 12 });
check("an other:<host> source survives", A.parseTouch({ s: "OTHER:News.Example.org" })?.s, "other:news.example.org");
check("campaign capped at 40, medium at 20", [A.parseTouch({ s: "x", c: "a".repeat(99) }).c.length, A.parseTouch({ s: "x", m: "b".repeat(99) }).m.length], [40, 20]);
check("landing must be a path: no scheme, no query, no doubled slashes, capped", [
  A.parseTouch({ s: "x", landing: "javascript:alert(1)" }).landing,
  A.parseTouch({ s: "x", landing: "//evil.com/x" }).landing,
  A.parseTouch({ s: "x", landing: "/cards/pokemon/base-set/?utm_source=x" }).landing,
  A.parseTouch({ s: "x", landing: "/" + "a".repeat(300) }).landing.length,
], ["", "/evil.com/x", "/cards/pokemon/base-set", 120]);
check("a bad timestamp becomes 0 (which expires at once)", [{ t: "abc" }, { t: NaN }, { t: -5 }, { t: Infinity }].map((o) => A.parseTouch({ s: "x", ...o }).t), [0, 0, 0, 0]);

console.log("touchFromPage + chooseTouch: first touch wins for 30 days, a real source replaces a stored direct");
const NOW = Date.UTC(2026, 8, 30, 15);
const DAY = 86_400_000;
const page = (search, referrer, pathname = "/") => A.touchFromPage({ search, referrer, pathname }, NOW);
check("a tagged link", page("?utm_source=bluesky&utm_medium=social&utm_campaign=pokemon-set-0930", ""), { s: "bluesky", m: "social", c: "pokemon-set-0930", refHost: "", landing: "/", t: NOW });
check("a search result lands on a card page", page("", "https://www.google.com/search?q=charizard", "/cards/pokemon/base-set/"), { s: "search", m: "", c: "", refHost: "google.com", landing: "/cards/pokemon/base-set", t: NOW });
check("our own page as the referrer is direct", page("", "https://cardflip.io/pricing", "/app"), { s: "direct", m: "", c: "", refHost: "", landing: "/app", t: NOW });
const tagged = page("?utm_source=x&utm_campaign=mtg-movers-0930", "");
const direct = page("", "");
const google = page("", "https://www.google.com/");
const aged = (t, days) => ({ ...t, t: NOW - days * DAY });
check("nothing stored: this visit", A.chooseTouch(null, tagged, NOW), tagged);
check("a stored real source is never replaced (first touch wins)", A.chooseTouch(aged(google, 3), tagged, NOW), aged(google, 3));
check("a stored direct gives way to a real source", A.chooseTouch(aged(direct, 3), tagged, NOW), tagged);
check("a stored direct stays when this visit is direct too (keeps the first landing)", A.chooseTouch(aged({ ...direct, landing: "/pricing" }, 3), direct, NOW).landing, "/pricing");
check("29 days old still counts", A.chooseTouch(aged(google, 29), tagged, NOW), aged(google, 29));
check("31 days old has expired", A.chooseTouch(aged(google, 31), tagged, NOW), tagged);
check("an unstamped (t 0) touch is treated as expired", A.chooseTouch({ ...google, t: 0 }, tagged, NOW), tagged);
check("a touch stamped far in the future is not trusted", A.chooseTouch({ ...google, t: NOW + 10 * DAY }, tagged, NOW), tagged);

console.log("trackedUrl / shortPath / draftCampaign");
check("campaign = the draft id with the day as MMDD", [A.draftCampaign("pokemon-set-2026-09-30"), A.draftCampaign("mtg-movers-2026-12-01"), A.draftCampaign("pokemon-games-2027-01-05"), A.draftCampaign("Odd Id!")], ["pokemon-set-0930", "mtg-movers-1201", "pokemon-games-0105", "oddid"]);
check("trackedUrl: the full utm link", A.trackedUrl("bluesky", "mtg-movers-0930"), "https://cardflip.io/?utm_source=bluesky&utm_medium=social&utm_campaign=mtg-movers-0930");
check("trackedUrl: Pinterest's link field", A.trackedUrl("pinterest", "pokemon-set-0930"), "https://cardflip.io/?utm_source=pinterest&utm_medium=social&utm_campaign=pokemon-set-0930");
check("trackedUrl: the campaign is sanitized", A.trackedUrl("x", "A B&utm_source=evil"), "https://cardflip.io/?utm_source=x&utm_medium=social&utm_campaign=abutm_sourceevil");
check("shortPath per site", ["bluesky", "x", "facebook", "threads", "instagram", "tiktok"].map((s) => A.shortPath(s, "mtg-movers-0930")), [
  "cardflip.io/b/mtg-movers-0930", "cardflip.io/x/mtg-movers-0930", "cardflip.io/f/mtg-movers-0930", "cardflip.io/th/mtg-movers-0930", "cardflip.io/i/mtg-movers-0930", "cardflip.io/tt/mtg-movers-0930",
]);
check("the bio links the owner sets", A.BIO_URLS, { instagram: "https://cardflip.io/i", tiktok: "https://cardflip.io/tt" });
check("the caption words", A.BIO_LINK_TEXT, "Link in bio");

console.log("short links: a path -> /?utm_... (the proxy's 302)");
const q = (u) => Object.fromEntries(new URL(u, "https://cardflip.io").searchParams);
check("x with a campaign", q(A.shortLinkTarget("/x/mtg-movers-0930")), { utm_source: "x", utm_medium: "social", utm_campaign: "mtg-movers-0930" });
check("each code names its site", ["b", "x", "f", "th", "i", "tt"].map((c) => q(A.shortLinkTarget(`/${c}/a-1`)).utm_source), ["bluesky", "x", "facebook", "threads", "instagram", "tiktok"]);
check("no campaign = the profile link, campaign 'bio'", [A.shortLinkTarget("/i"), A.shortLinkTarget("/tt/")], ["/?utm_source=instagram&utm_medium=social&utm_campaign=bio", "/?utm_source=tiktok&utm_medium=social&utm_campaign=bio"]);
for (const no of ["/", "/pricing", "/xyz", "/i/a/b", "/index", "/x/Has_Upper", "/x/under_score", "/u/x", "/tt/x/y", "/b2", "/api/x/a", "/ix"]) {
  check(`not a short link: ${no}`, A.shortLinkTarget(no), null);
}
check("/th alone is the Threads profile link; /t is nothing", [A.shortLinkTarget("/th") !== null, A.shortLinkTarget("/t")], [true, null]);

console.log("proxy: the redirect, in front of everything but the country block");
const hit = (p, country) => proxy(new NextRequest(new URL(p, "https://cardflip.io"), { headers: country ? { "x-vercel-ip-country": country } : {} }));
{
  const r = hit("/x/mtg-movers-0930");
  check("302 to the tagged landing page", [r.status, r.headers.get("location")], [302, "https://cardflip.io/?utm_source=x&utm_medium=social&utm_campaign=mtg-movers-0930"]);
  check("the bio links", [hit("/i").headers.get("location"), hit("/tt").headers.get("location")], ["https://cardflip.io/?utm_source=instagram&utm_medium=social&utm_campaign=bio", "https://cardflip.io/?utm_source=tiktok&utm_medium=social&utm_campaign=bio"]);
  check("every code redirects", ["b", "x", "f", "th", "i", "tt"].map((c) => hit(`/${c}/pokemon-set-0930`).status), [302, 302, 302, 302, 302, 302]);
  check("an ordinary page passes through", [hit("/pricing").status, hit("/pricing").headers.get("location")], [200, null]);
  check("near-misses pass through", ["/x/Bad_Path", "/xx", "/i/a/b", "/index"].map((p) => hit(p).headers.get("location")), [null, null, null, null]);
  check("the query of the short link is not carried into utm", hit("/x/a-1?utm_source=evil").headers.get("location"), "https://cardflip.io/?utm_source=x&utm_medium=social&utm_campaign=a-1");
  check("a blocked country still gets the 403, not the redirect", hit("/x/mtg-movers-0930", "IN").status, 403);
}

console.log("no real route uses the short-link segments");
{
  const taken = new Set(["b", "x", "f", "th", "i", "tt"]);
  const top = (dir) => readdirSync(repo(dir), { withFileTypes: true }).map((e) => e.name.replace(/\.[a-z0-9]+$/i, "").replace(/^\((.+)\)$/, "$1"));
  check("src/app has no b, x, f, th, i or tt segment or file", top("src/app").filter((n) => taken.has(n)), []);
  check("public has no b, x, f, th, i or tt file or folder", top("public").filter((n) => taken.has(n)), []);
}

console.log("Bluesky: the facet carries the utm uri, the text says cardflip.io");
{
  const { blueskyFacets } = await import(at("lib/server/sites/bluesky.ts"));
  const text = "Pokémon moves. cardflip.io\n\n#PokemonTCG #TCG";
  const bytes = (s) => new TextEncoder().encode(s).length;
  const uri = A.trackedUrl("bluesky", "pokemon-set-0930");
  const facets = blueskyFacets(text, uri);
  check("the link facet points at the tagged url, on the same bytes as before", facets[0], {
    index: { byteStart: bytes("Pokémon moves. "), byteEnd: bytes("Pokémon moves. cardflip.io") },
    features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://cardflip.io/?utm_source=bluesky&utm_medium=social&utm_campaign=pokemon-set-0930" }],
  });
  check("the visible text is untouched (0 extra characters)", text.includes("cardflip.io") && !text.includes("utm_"), true);
  check("without a uri the facet is the plain address, as before", blueskyFacets(text)[0].features[0].uri, "https://cardflip.io");
  check("tag facets are unchanged", blueskyFacets(text, uri).slice(1).map((f) => f.features[0].tag), ["PokemonTCG", "TCG"]);
}

console.log("every site's post fits with its link in place of the plain address");
{
  const { fitText, backlinkFor } = await import(at("lib/server/socialPublish.ts"));
  const S = await import(at("lib/server/social.ts"));
  const { PLAN_TAGS } = await import(at("lib/socialPlan.ts"));
  const { x } = await import(at("lib/server/sites/x.ts"));
  const { bluesky } = await import(at("lib/server/sites/bluesky.ts"));
  const { facebook, instagram, threads } = await import(at("lib/server/sites/meta.ts"));
  const { pinterest } = await import(at("lib/server/sites/pinterest.ts"));
  const SITES = [x, bluesky, facebook, instagram, threads];

  const DAY_ID = "2026-09-30";
  const mover = (i, game) => ({ cardId: `c${i}`, name: `A Fairly Long Card Name Ex ${i}`, setName: "Scarlet & Violet Paldean Fates", number: `${100 + i}`, imageUrl: "", variant: "normal", from: 1234.5, to: 2345.6, pct: 90.5, game });
  const movers = (game) => [1, 2, 3, 4, 5].map((i) => mover(i, game));
  const leads = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh"].map((g) => ({ game: g, cardId: g, name: "A Fairly Long Card Name Ex", setName: "Scarlet & Violet Paldean Fates", number: "199", price: 1234.56, imageUrl: "" }));
  const TAGS = { pokemon: ["PokemonTCG", "PokemonCards", "TCG"], mtg: ["MTG", "MagicTheGathering", "MTGFinance"], lorcana: ["DisneyLorcana", "Lorcana", "TCG"], onepiece: ["OnePieceCardGame", "OPTCG", "TCG"], yugioh: ["Yugioh", "YuGiOhTCG", "TCG"] };
  const drafts = [];
  const add = (game, kind, caption, shortCaption, hashtags) => drafts.push({ id: `${game}-${kind}-${DAY_ID}`, kind, game, day: DAY_ID, title: kind, caption, shortCaption, hashtags, imagePath: "", cardIds: [] });
  for (const game of Object.keys(TAGS)) {
    for (const also of [false, true]) {
      const spot = { setId: "s", setName: "Scarlet & Violet Paldean Fates", cards: movers(undefined) };
      add(game, "movers", S.moversCaption(game, movers(undefined), also), S.moversShortCaption(game, movers(undefined), also), TAGS[game]);
      add(game, "dips", S.dipsCaption(game, movers(undefined), also), S.dipsShortCaption(game, movers(undefined), also), TAGS[game]);
      add(game, "set", S.setCaption(game, spot, also), S.setShortCaption(game, spot, also), TAGS[game]);
    }
    add(game, "card", S.cardCaption(game, mover(1)), S.cardCaption(game, mover(1)), TAGS[game]);
  }
  add("pokemon", "movers", S.mixedMoversCaption(movers("mtg").concat(movers("pokemon"))), S.mixedMoversShortCaption(movers("mtg").concat(movers("pokemon"))), [...PLAN_TAGS.mixedMovers]);
  add("pokemon", "games", S.gamesCaption(leads), S.gamesShortCaption(leads), [...PLAN_TAGS.games]);

  // X counts any link as 23 (a t.co); the typed path is at most 34 characters, so even an unrecognised link fits.
  const xCount = (text, link) => text.length - link.length + 23;
  let problems = [];
  let longestLink = 0;
  for (const d of drafts) {
    for (const site of SITES) {
      const link = backlinkFor(site, d);
      const out = fitText(d, site.maxChars, site.maxTags, link);
      const counted = link?.chars != null ? out.length - link.text.length + link.chars : out.length;
      const tags = (out.match(/(?:^|\s)#[A-Za-z]\w*/g) ?? []).length;
      if (counted > site.maxChars) problems.push(`${site.id} ${d.id} is ${counted}/${site.maxChars}`);
      if (site.maxTags && tags > site.maxTags) problems.push(`${site.id} ${d.id} has ${tags} tags`);
      if (site.backlink === "path") {
        if (site.id === "x") longestLink = Math.max(longestLink, link.text.length);
        if (!out.includes(link.text)) problems.push(`${site.id} ${d.id} lost its link`);
        if (site.id === "x" && (xCount(out, link.text) > 280 || out.length > 280)) problems.push(`x ${d.id} exceeds 280 (${xCount(out, link.text)} counted, ${out.length} typed)`);
      } else if (site.backlink === "bio") {
        if (!out.includes("Link in bio") || out.includes("cardflip.io")) problems.push(`${site.id} ${d.id} is not Link in bio`);
      } else if (!out.includes("cardflip.io") || out.includes("cardflip.io/")) problems.push(`${site.id} ${d.id} lost its plain address`);
    }
  }
  check(`${drafts.length} drafts x ${SITES.length} sites: within each limit, at most five tags on Instagram, link or Link in bio present`, problems, []);
  check("the longest short path is 34 characters or fewer (X's 246 + 34 = 280 even if it were not a link)", longestLink <= 34, true);

  // Nothing else about a post changes: swap the link back and the text is what it was before this shipped.
  let drift = [];
  for (const d of drafts) {
    for (const site of [x, instagram, facebook]) {
      const link = backlinkFor(site, d);
      const before = fitText(d, site.maxChars, site.maxTags);
      const after = fitText(d, site.maxChars, site.maxTags, link).replace(link.text, "cardflip.io");
      if (before !== after) drift.push(`${site.id} ${d.id}`);
    }
  }
  check("X, Instagram and Facebook: same words, same tags, same cuts as the plain-address post", drift, []);

  const dd = { id: "pokemon-set-2026-10-01", kind: "set", game: "pokemon", day: "2026-10-01", caption: "c cardflip.io", shortCaption: "s cardflip.io", hashtags: ["A", "B"] };
  check("Bluesky and Pinterest keep the plain address (their links are tagged in the facet and the link field)", [backlinkFor(bluesky, dd), backlinkFor(pinterest, dd)], [undefined, undefined]);
  check("fitText with no link is exactly what it was", fitText(dd, 300), "c cardflip.io\n\n#A #B");
  check("X: the path replaces the address and costs the address's 11 characters", fitText(dd, 300, undefined, backlinkFor(x, dd)), "c cardflip.io/x/pokemon-set-1001\n\n#A #B");
  check("Instagram: Link in bio", fitText(dd, 300, undefined, backlinkFor(instagram, dd)), "c Link in bio\n\n#A #B");
  // A caption that only just fits: the 11-character address is swapped for a 31-character path on Threads, which counts it in full.
  const snug = { ...dd, caption: `${"w".repeat(470)} cardflip.io`, shortCaption: "s cardflip.io", hashtags: ["A", "B"] };
  const t = fitText(snug, 500, undefined, backlinkFor(threads, snug));
  check("Threads counts the path in full: the long caption no longer fits at 500, the short one (with its tags) goes out", [t.length <= 500, t.startsWith("s cardflip.io/th/"), t.endsWith("#A #B")], [true, true, true]);
  const tiny = fitText({ ...dd, caption: "c".repeat(400), shortCaption: `${"s".repeat(30)}\n\nAlso scans Magic, Lorcana, One Piece and Yu-Gi-Oh. cardflip.io`, hashtags: [] }, 120, undefined, { text: "Link in bio" });
  check("last resorts keep the sign-off the site uses", [tiny.length <= 120, tiny.endsWith("Link in bio"), tiny.includes("cardflip.io")], [true, true, false]);
}

console.log("wiring (a browser is not run here)");
{
  const src = (p) => readFileSync(repo(`src/${p}`), "utf8");
  check("the root layout mounts AttributionCapture beside RefCapture", /<RefCapture \/>\s*<AttributionCapture \/>/.test(src("app/layout.tsx")), true);
  check("the signup page sends the touch it kept", src("app/signup/page.tsx").includes("readReferralCode(), readTouch()"), true);
  check("signup() puts the touch in the request body", /\.\.\.\(touch \? \{ touch \} : \{\}\)/.test(src("lib/client/auth.ts")), true);
  check("the first visit ping carries the tag (and only the first)", [src("components/VisitPing.tsx").includes("first: true"), src("components/VisitPing.tsx").includes("utm_source")], [true, true]);
  check("the capture stores localStorage only: no cookie, nothing third-party", [/document\.cookie/.test(src("components/AttributionCapture.tsx")), /fetch\(|sendBeacon|https?:\/\//.test(src("components/AttributionCapture.tsx"))], [false, false]);
  check("the capture leaves the console alone", src("components/AttributionCapture.tsx").includes('startsWith("/admin")'), true);
  check("the privacy page says what is remembered and why", src("app/privacy/page.tsx").includes("we remember that source in your browser and save it with your account at signup, so we know which posts bring people. It holds no personal details."), true);
}

if (failures) { console.log(`\n${failures} failing`); process.exit(1); }
console.log("\nall attribution checks passed");
