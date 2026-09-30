/**
 * Social posts page helpers (lib/socialPosts.ts). Run: npm run test:socialposts
 *
 * Pins: totals sum nulls as zero and leave views null until a site reports
 * them; comments group under "<site>:<post id>" in input order; counts
 * print exact with separators and a dash for unknown; the one-line preview
 * collapses whitespace and cuts on the limit; site labels cover every site
 * the autopilot posts to.
 */
import assert from "node:assert/strict";
import { count, groupByPost, oneLine, postKey, SITE_ORDER, siteLabel, tally, whenET } from "../src/lib/socialPosts.ts";

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

console.log("test-social-posts: ok");
