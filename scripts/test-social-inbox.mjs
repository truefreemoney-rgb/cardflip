/**
 * Social inbox classifier (lib/socialModeration.ts). Run: npm run test:socialinbox
 *
 * Pins: sales pitches, DM/WhatsApp bait, two outside links and bare links
 * are spam; a collector's question is a question even with cardflip.io in
 * it; short praise is praise; a plain remark is other; our own account is
 * recognised by id or handle; replies are fitted to each site's limit on a
 * word boundary.
 */
import assert from "node:assert/strict";
import { classifyComment, fitReply, isOwnComment, isStale, replyPlan, replyProblem, REPLY_MAX, STALE_MS } from "../src/lib/socialModeration.ts";

const spam = [
  "DM me for cheap PSA 10 Charizards",
  "Message me on WhatsApp +1 555 0100 for wholesale boxes",
  "check out my page for free cards!!",
  "Link in bio 🔥🔥",
  "Earn $500 a day from home, ask me how",
  "https://scam.example.com https://other.example.net",
  "https://bit.ly/3abc",
  "Follow me back and I follow you",
  "@a @b @c @d",
  "Selling cheap at https://cardsale.example.shop",
];
for (const t of spam) assert.equal(classifyComment(t), "spam", `spam: ${t}`);

const questions = ["How accurate is the scan?", "Does this work for Japanese cards", "what set is this from", "Is cardflip.io free to try?", "Can it grade centering?"];
for (const t of questions) assert.equal(classifyComment(t), "question", `question: ${t}`);

const praise = ["Nice pull!", "🔥🔥🔥", "love this set", "Awesome, congrats", "sick card"];
for (const t of praise) assert.equal(classifyComment(t), "praise", `praise: ${t}`);

const other = ["I have three of these in my binder from 2007.", "Prices went up again this week.", "", "Just pulled one at the LGS", "Vaporeon is my favorite"];
for (const t of other) assert.equal(classifyComment(t), "other", `other: ${t}`);

// Our own link never makes spam; a platform link neither.
assert.equal(classifyComment("Scanned mine on cardflip.io and it matched"), "other");
assert.equal(classifyComment("see https://bsky.app/profile/x/post/1"), "other");

// Own-account detection.
assert.equal(isOwnComment("1314676718400499", null, ["1314676718400499"]), true);
assert.equal(isOwnComment(null, "@CardFlipIO", ["cardflipio"]), true);
assert.equal(isOwnComment("999", "someone", ["1314676718400499", "cardflipio"]), false);

// Reply fitting.
const long = "word ".repeat(100).trim();
assert.equal(fitReply("x", "Thanks!  So glad   you like it."), "Thanks! So glad you like it.");
assert.ok(fitReply("x", long).length <= REPLY_MAX.x);
assert.ok(fitReply("x", long).endsWith("…"));
assert.ok(!fitReply("x", long).includes("wor…"), "cuts on a word boundary");
assert.ok(fitReply("bluesky", long).length <= 300);
assert.equal(fitReply("facebook", long), long);

// Who gets a reply (Chris 09-28: only when necessary, occasional fun).
assert.equal(replyPlan("spam", "DM me for cheap PSA 10s", "x:1"), "skip");
assert.equal(replyPlan("question", "Does it read Japanese cards?", "x:2"), "reply");
assert.equal(replyPlan("other", "@cardflip you should add Lorcana", "x:3"), "reply", "named without a question mark");
assert.equal(replyPlan("other", "pulled this one last week", "x:4"), "skip", "plain remark says nothing");
assert.equal(replyPlan("question", "Is this a scam? Where is my refund", "x:5"), "hold", "heated waits for Chris");
assert.equal(replyPlan("praise", "this app is trash lol", "x:6"), "hold");
const praisePlans = Array.from({ length: 200 }, (_, i) => replyPlan("praise", "nice card", `bluesky:${i}`));
const replies = praisePlans.filter((p) => p === "reply").length;
assert.ok(replies >= 30 && replies <= 70, `praise about one in four, got ${replies}/200`);
assert.ok(praisePlans.every((p) => p === "reply" || p === "skip"));
assert.equal(replyPlan("praise", "nice card", "bluesky:7"), replyPlan("praise", "nice card", "bluesky:7"), "seeded, stable across runs");
// Pre-send check: nothing goes out that names a price we did not post, promises, links elsewhere, or shouts.
const post = "Umbreon ex jumped to $412 this week. cardflip.io";
assert.equal(replyProblem("It is at $412 in our data, scan yours at cardflip.io", post, "x"), null);
assert.match(replyProblem("Should fetch $500 easy", post, "x"), /\$500/);
assert.match(replyProblem("We guarantee the price", post, "x"), /guarantee/);
assert.match(replyProblem("Free shipping on us", post, "x"), /shipping/);
assert.match(replyProblem("see https://othersite.com/deal", post, "x"), /links to/);
assert.equal(replyProblem("Both scan fine at cardflip.io/help", post, "bluesky"), null);
assert.match(replyProblem("Nice pull!", post, "x"), /exclamation/);
assert.equal(replyProblem("", post, "x"), "empty");
assert.match(replyProblem("x".repeat(301), post, "bluesky"), /over 300/);
// Stale: two days and older is stored, never answered.
const nowMs = Date.UTC(2026, 8, 28, 12);
assert.equal(isStale(new Date(nowMs - STALE_MS + 60_000).toISOString(), nowMs), false);
assert.equal(isStale(new Date(nowMs - STALE_MS - 60_000).toISOString(), nowMs), true);
assert.equal(isStale("junk", nowMs), false);
console.log("social inbox: ok");
