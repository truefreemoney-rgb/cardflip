/**
 * Profile-bio helpers (lib/socialBio.ts). Run: npm run test:socialbio
 *
 * Pins: bios over a site's cap are refused, at-the-cap bios pass, sites with
 * no write API have no cap; the Bluesky profile merge keeps avatar, banner
 * and every other field, swaps only the description, and fills displayName
 * only when it is empty.
 */
import assert from "node:assert/strict";
import { BIO_MAX, bioProblem, mergeBlueskyProfile } from "../src/lib/socialBio.ts";

assert.deepEqual(BIO_MAX, { bluesky: 256, x: 160, facebook: 255 });

for (const [site, max] of Object.entries(BIO_MAX)) {
  assert.equal(bioProblem(site, "a".repeat(max)), null, `${site} at cap passes`);
  assert.match(bioProblem(site, "a".repeat(max + 1)) ?? "", new RegExp(`${site}: bio is ${max + 1} characters, the limit is ${max}`), `${site} over cap refused`);
}
assert.ok(bioProblem("x", 12), "non-string refused");
assert.equal(bioProblem("instagram", "a".repeat(500)), null, "no cap where we cannot write");
// Bluesky counts graphemes: 256 family emoji is 256, not 256 * 11 units.
assert.equal(bioProblem("bluesky", "👨‍👩‍👧".repeat(256)), null);
assert.ok(bioProblem("bluesky", "👨‍👩‍👧".repeat(257)));

const avatar = { $type: "blob", ref: { $link: "bafyavatar" }, mimeType: "image/jpeg", size: 1234 };
const banner = { $type: "blob", ref: { $link: "bafybanner" }, mimeType: "image/jpeg", size: 4321 };
const existing = { $type: "app.bsky.actor.profile", displayName: "Card Flip IO", description: "old", avatar, banner, pinnedPost: { uri: "at://x/app.bsky.feed.post/1", cid: "c" } };
const merged = mergeBlueskyProfile(existing, "new bio");
assert.deepEqual(merged.avatar, avatar);
assert.deepEqual(merged.banner, banner);
assert.deepEqual(merged.pinnedPost, existing.pinnedPost);
assert.equal(merged.description, "new bio");
assert.equal(merged.displayName, "Card Flip IO", "existing name kept");
assert.equal(merged.$type, "app.bsky.actor.profile");
assert.equal(existing.description, "old", "input not mutated");

assert.equal(mergeBlueskyProfile({ avatar, displayName: "  " }, "b").displayName, "CardFlip", "blank name filled");
assert.equal(mergeBlueskyProfile({ avatar }, "b").displayName, "CardFlip", "missing name filled");
assert.deepEqual(mergeBlueskyProfile(null, "b"), { $type: "app.bsky.actor.profile", description: "b", displayName: "CardFlip" });

console.log("social bio: all checks passed");
