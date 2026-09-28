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
import { classifyComment, fitReply, isOwnComment, REPLY_MAX } from "../src/lib/socialModeration.ts";

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

console.log("social inbox: ok");
