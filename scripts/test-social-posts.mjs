/**
 * Social posts page helpers (lib/socialPosts.ts). Run: npm run test:socialposts
 *
 * Pins: totals sum nulls as zero and leave views null until a site reports
 * them; comments group under "<site>:<post id>" in input order; counts
 * print exact with separators and a dash for unknown; the one-line preview
 * collapses whitespace and cuts on the limit; site labels cover every site
 * the autopilot posts to; a post's kind and slot come from the publisher's
 * log first, else from its words and Eastern hour (the optimization loop).
 */
import assert from "node:assert/strict";
import { count, easternOf, groupByPost, kindOfCaption, oneLine, postKey, sameLogged, SITE_ORDER, siteLabel, slotOfHour, tagPost, tally, whenET } from "../src/lib/socialPosts.ts";

// tally
assert.deepEqual(tally([]), { posts: 0, likes: 0, comments: 0, shares: 0, views: null });
assert.deepEqual(
  tally([
    { likes: 3, comments: null, shares: 1, views: null },
    { likes: null, comments: 2, shares: null, views: 40 },
    { likes: 5, comments: 1, shares: 0, views: 60 },
  ]),
  { posts: 3, likes: 8, comments: 3, shares: 1, views: 100 },
);

// grouping
const g = groupByPost([
  { id: "a", site: "x", postId: "1" },
  { id: "b", site: "facebook", postId: "1" },
  { id: "c", site: "x", postId: "1" },
]);
assert.deepEqual([...g.keys()], ["x:1", "facebook:1"]);
assert.deepEqual(g.get("x:1").map((c) => c.id), ["a", "c"]);
assert.equal(postKey("bluesky", "at://did:plc:abc/app.bsky.feed.post/xyz"), "bluesky:at://did:plc:abc/app.bsky.feed.post/xyz");

// counts
assert.equal(count(null), "—");
assert.equal(count(undefined), "—");
assert.equal(count(0), "0");
assert.equal(count(12345), "12,345");

// preview
assert.equal(oneLine("  Umbreon ex\n\n  jumped   12%  "), "Umbreon ex jumped 12%");
assert.equal(oneLine("abcdefghij", 6), "abcde…");
assert.equal(oneLine("short", 6), "short");

// labels
for (const s of SITE_ORDER) assert.notEqual(siteLabel(s), s, `label for ${s}`);
assert.equal(siteLabel("x"), "X");
assert.equal(siteLabel("newsite"), "Newsite");
assert.equal(siteLabel(""), "");

// time: Eastern, minute precision, never throws on junk
assert.equal(whenET("2026-09-28T17:05:00Z"), "Sep 28, 1:05 PM ET");
assert.equal(whenET("2026-09-28T17:05:00+0000"), "Sep 28, 1:05 PM ET");
assert.equal(whenET("2026-09-28T13:05:00-0400"), "Sep 28, 1:05 PM ET");
assert.equal(whenET(Date.UTC(2026, 0, 2, 5, 0)), "Jan 2, 12:00 AM ET");
assert.equal(whenET("nonsense"), "nonsense");
assert.equal(whenET(""), "");

// kind from the caption's opening words (real captions, prod 09-25 to 10-02)
assert.equal(kindOfCaption("Sun & Moon: five of the most valuable cards right now\nUmbreon GX #154 $135"), "set");
assert.equal(kindOfCaption("The five most valuable Pokémon cards in Power Keepers right now, market price from CardFlip's own"), "set");
assert.equal(kindOfCaption("Pokémon and Magic price gains this week\nWobbuffet +134%"), "movers");
assert.equal(kindOfCaption("The week's biggest price gains in Pokémon and Magic, from CardFlip's own price history."), "movers");
assert.equal(kindOfCaption("Biggest price jumps this week\nPokémon: Cresselia +59%\nMagic: Void Winnower +29%"), "games");
assert.equal(kindOfCaption("The biggest price jumps this week in Pokémon and Magic, and one card from Lorcana"), "games");
assert.equal(kindOfCaption("Pokémon price drops this week\nDark Charizard -54%"), "dips");
assert.equal(kindOfCaption("Card of the day: Friend Ball, Skyridge 126. Market price $15.71."), "card");
// The five angles (10-03), long and short forms; "most valuable" alone stays the set spotlight.
assert.equal(kindOfCaption("Five of the most valuable Pokémon cards priced on CardFlip today, across every set.\n\nCharizard ex (Base Set #4, Holo): $500"), "top");
assert.equal(kindOfCaption("Five of the most valuable Pokémon cards today, across every set\nCharizard ex $500"), "top");
assert.equal(kindOfCaption("The most valuable card in each game priced on CardFlip today: Pokémon, Magic, Lorcana and Yu-Gi-Oh."), "top");
assert.equal(kindOfCaption("The most valuable card in each game\nPokémon: Charizard ex $500"), "top");
assert.equal(kindOfCaption("What's it worth? Pokémon: Umbreon ex (Prismatic Evolutions #161, Holo).\n\nMarket price $412 today, +34% this week"), "guess");
assert.equal(kindOfCaption("What's it worth?\nUmbreon ex, Prismatic Evolutions #161\nMarket price $412 today"), "guess");
assert.equal(kindOfCaption("Then vs now: Pokémon: Rillaboom (Sword & Shield #14, Holo).\n\nMay: $6.35. Today: $24.00, +278% since May"), "thennow");
assert.equal(kindOfCaption("Pokémon head to head in Base Set: Charizard (Base Set #4, Holo) at $500 vs Blastoise (Base Set #2, Holo) at $300. Which one moved this week?"), "versus");
assert.equal(kindOfCaption("Lorcana head to head: Elsa vs Mickey Mouse\nElsa is worth more today: $61.00 to $40.00."), "versus");
assert.equal(kindOfCaption("Pokémon cards under $5 moving the most this week, from CardFlip's own price history.\n\nPenny (Sleep Set #1, Holo) $2.00 → $2.60, +30%"), "sleepers");
assert.equal(kindOfCaption("Pokémon and Magic sleepers under $5\nPenny $2.60, +30%"), "sleepers");
// Not the autopilot's formats: a hand-written post, the 09-25 mixed list, an empty read.
assert.equal(kindOfCaption("One scanner, five card games: Pokémon, Magic, Lorcana, One Piece and Yu-Gi-Oh."), null);
assert.equal(kindOfCaption("Pokémon price moves this week\nGrass Energy +650%"), null);
assert.equal(kindOfCaption(""), null);

// Eastern day and hour of a post, in every timestamp shape the platforms send
assert.deepEqual(easternOf("2026-10-02T11:06:09+0000"), { day: "2026-10-02", hour: 7 });
assert.deepEqual(easternOf("2026-10-02T03:30:00.000Z"), { day: "2026-10-01", hour: 23 });
assert.deepEqual(easternOf("2026-01-02T05:00:00Z"), { day: "2026-01-02", hour: 0 });
assert.equal(easternOf("nonsense"), null);
assert.equal(easternOf(""), null);
assert.deepEqual([7, 10, 11, 14, 16, 17, 19, 23].map(slotOfHour), ["morning", "morning", "midday", "midday", "midday", "evening", "evening", "evening"]);

// the publisher's link against the link the platform lists (real pairs, 10-02)
assert.ok(sameLogged({ url: "https://x.com/cardflipio/status/2105977590775165437", postId: "2105977590775165437" }, "https://x.com/i/status/2105977590775165437"));
assert.ok(sameLogged({ url: "https://www.facebook.com/122110114887482847/posts/122112919971482847", postId: "1314676718400499_122112919971482847" }, "https://www.facebook.com/1314676718400499_122112919971482847"));
assert.ok(sameLogged({ url: "https://bsky.app/profile/cardflip.bsky.social/post/3mwva4aq5cb2k", postId: "at://did:plc:abc/app.bsky.feed.post/3mwva4aq5cb2k" }, "https://bsky.app/profile/cardflip.bsky.social/post/3mwva4aq5cb2k"));
assert.ok(!sameLogged({ url: "https://x.com/cardflipio/status/21", postId: "21" }, "https://x.com/i/status/2105977590775165421"));
assert.ok(!sameLogged({ url: "https://www.tiktok.com/@cardflipio/video/7692", postId: "" }, "https://www.tiktok.com/"));

// tagPost: the log wins over the words (a day plan can post any kind in any slot)
const log = [
  { site: "x", url: "https://x.com/i/status/111", day: "2026-10-02", slot: "evening", kind: "games" },
  { site: "x", url: "https://x.com/i/status/222", day: "2026-10-02", slot: "morning", kind: "set" },
];
const xPost = (id, text, at) => ({ site: "x", postId: id, url: `https://x.com/cardflipio/status/${id}`, text, at });
// A logged row carries its game and format (phase 5); a row from before 10-03 has neither.
assert.deepEqual(tagPost(xPost("111", "Pokémon price gains this week", "2026-10-02T23:05:00Z"), log), { kind: "games", slot: "evening", game: null, format: null });
assert.deepEqual(tagPost(xPost("222", "whatever", "2026-10-02T11:05:00Z"), [{ ...log[1], game: "mtg", format: "picture" }]), { kind: "set", slot: "morning", game: "mtg", format: "picture" });
// Not in the log by link: the words give the kind, the log's row for that site, day and kind gives the slot,
assert.deepEqual(tagPost(xPost("999", "Base Set 2: the five most valuable cards right now", "2026-10-03T01:10:00Z"), log), { kind: "set", slot: "morning", game: null, format: null });
// and with no such row (before the log shipped, another site's row) the Eastern hour does.
assert.deepEqual(tagPost(xPost("999", "Base Set 2: the five most valuable cards right now", "2026-09-28T11:05:00Z"), log), { kind: "set", slot: "morning", game: null, format: null });
assert.deepEqual(tagPost({ ...xPost("999", "Pokémon price drops this week", "2026-10-02T23:05:00Z"), site: "threads" }, log), { kind: "dips", slot: "evening", game: null, format: null });
// TikTok is posted by hand, whenever: the slot is the one whose video that day shows the post's kind.
const videos = [
  { day: "2026-10-02", slot: "morning", kind: "set" },
  { day: "2026-10-02", slot: "midday", kind: "movers" },
  { day: "2026-10-02", slot: "evening", kind: "games" },
];
const tt = (text, at) => ({ site: "tiktok", postId: "7692", url: "https://www.tiktok.com/@cardflipio/video/7692", text, at });
// A TikTok post is always the video.
assert.deepEqual(tagPost(tt("The biggest price jumps this week in Pokémon and Magic", "2026-10-02T15:40:00Z"), log, videos), { kind: "games", slot: "evening", game: null, format: "video" });
assert.deepEqual(tagPost(tt("The biggest price jumps this week in Pokémon and Magic", "2026-09-20T15:40:00Z"), log, videos), { kind: "games", slot: "midday", game: null, format: "video" });
// None of ours: no kind and no slot, whatever the hour.
assert.deepEqual(tagPost(xPost("5", "One scanner, five card games", "2026-10-02T23:05:00Z"), log, videos), { kind: null, slot: null, game: null, format: null });
// A timestamp that does not parse keeps the kind and leaves the slot open.
assert.deepEqual(tagPost(xPost("5", "Pokémon price gains this week", ""), log), { kind: "movers", slot: null, game: null, format: null });

console.log("test-social-posts: ok");
