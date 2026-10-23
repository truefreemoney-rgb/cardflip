// Register a HAND-MADE 1pm video for the automatic sites (10-23, the Blender "Guess the Price" clip): writes the
// shared row the publisher reads (videoKey(game, kind, day)) with VideoSpec.hand = the exact text to post.
// The MP4 is served from public/social/hand/ (Blob's token is sensitive, not readable by hand), so the push must land
// before the 1:05pm ET publish ping. Writes ONE settings row on prod; nothing else.
//   node --import ./scripts/lib/register-next-stubs.mjs scripts/_register-hand-video.mjs [--dry]
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl; process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
const dry = process.argv.includes("--dry");
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { videoKey, handKey, parseVideoSpec } = await import(at("lib/socialVideo.ts"));
const { getSetting, setSetting } = await import(at("lib/server/settings.ts"));
const { handPostFor } = await import(at("lib/server/socialPublish.ts"));

const day = "2026-10-23", game = "pokemon", kind = "guess", slot = "midday";
const file = "public/social/hand/guess-2026-10-23.mp4";
const SIGN_OFF = "Scan a card, see what it's worth. cardflip.io";
const spec = {
  url: `https://cardflip.io/social/hand/guess-2026-10-23.mp4`,
  bytes: fs.statSync(file).size,
  mime: "video/mp4",
  width: 1080, height: 1920, seconds: 7,
  renderedAt: Date.now(),
  kind,
  cards: [{ cardId: "30th-c-001", name: "Charizard", number: "001", setName: "30th Classic Collection", variant: "holofoil", from: 163, to: 167.47, pct: 2.7 }],
  hand: {
    title: "Guess the price: Charizard, 30th Anniversary Classic Collection",
    caption: [
      "Guess what this Charizard is worth today. Drop your number below.",
      "",
      "It's the 30th Anniversary Classic Collection print, so no, it isn't $10,000. The real market price comes from CardFlip's own price history.",
      "",
      SIGN_OFF,
    ].join("\n"),
    shortCaption: ["Guess what this Charizard is worth today. Drop your number below.", "30th Anniversary Classic Collection print, not the 1999 Base Set.", "", SIGN_OFF].join("\n"),
    hashtags: ["PokemonTCG", "PokemonCards", "TCG", "TradingCards", "CardCollector", "Pokemon", "PokemonCommunity"],
  },
};
const key = videoKey(game, kind, day), pointer = handKey(slot, day);
const before = parseVideoSpec(await getSetting(key));
console.log("key", key, "\npointer", pointer, "=", await getSetting(pointer), "\nbefore", before ? before.url : "(none)");
if (!parseVideoSpec(JSON.stringify(spec))?.hand) throw new Error("the row would not parse back with hand text");
if (dry) { console.log("DRY, would write:\n" + JSON.stringify(spec, null, 1)); process.exit(0); }
await setSetting(key, JSON.stringify(spec));
await setSetting(pointer, key);
const post = await handPostFor(slot, day);
console.log("written; the publisher would post:", JSON.stringify({ kind: post?.kind, game: post?.game, title: post?.title, tags: post?.hashtags?.length }));
