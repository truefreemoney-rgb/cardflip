// The hand-posted Pinterest Pin text (scripts/lib/pin-text.mjs). Run: npm run test:pintext
// Fixtures = the real 10-21 captions (Downloads\CardFlip TikTok 10-21\captions.txt), whose pins kept 1, 2 and 2 of 5 cards.
import { pinFromCaption, PIN_MAX, PIN_TITLE_MAX } from "./lib/pin-text.mjs";

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const JUMPS = `What's your binder worth? Type cardflip.io in your browser, point the camera at a card

The biggest price jumps this week in Magic, and one card from Pokémon, Lorcana, One Piece and Yu-Gi-Oh at today's price, from CardFlip's own price history.

Magic: Astral Dragon (Commander Legends: Battle for Baldur's Gate #613): $36.81, +38% this week
Pokémon: Gengar (Fossil #20): $34.79 today
Lorcana: Kuzco (Challenge Promo #8): $51.42 today
One Piece: Monkey.D.Luffy (Premium Booster -The Best- P-055): $74.25 today
Yu-Gi-Oh: Blue-Eyes White Dragon (Quarter Century Stampede RA04-EN108): $46.94 today

Which game has your best card?

#PokemonTCG #MTG #DisneyLorcana #OPTCG #Yugioh #TCG #TradingCards`;

const TOP = `Check your own cards against these prices: type cardflip.io in your browser

Five of the most valuable Pokémon cards priced on CardFlip today, across every set.

Latias & Latios GX (Team Up #170, Holo): $4,500, +15% this week
Charizard (Base Set (1st Edition) #4, 1st Ed. Holo): $4,000
Umbreon VMAX (Evolving Skies #215, Holo): $2,325, +3% this week
Gengar & Mimikyu GX (Team Up #165, Holo): $2,156, +2% this week
Jolteon Star (Power Keepers #101, Holo): $1,750

Which one surprised you?

#PokemonTCG #PokemonCards #TCG #TradingCards #CardCollector #Pokemon #PokemonCommunity`;

const SET = `These prices are live on cardflip.io. Type it in your browser and scan a card of yours

Five of the most valuable Pokémon cards in 30th Classic Collection right now, market price from CardFlip's own price history.

Charizard #001 Holo: $163, +18% this week
Lugia #029 Holo: $203, +14% this week
Magikarp #030 Holo: $84.47, -3% this week
Gengar #018 Holo: $53.65, -9% this week
Pikachu & Zekrom GX #008 Holo: $29.70, +11% this week

Do you still have any 30th Classic Collection cards?

#PokemonTCG #PokemonCards #TCG #TradingCards #CardCollector #Pokemon #PokemonCommunity`;

// A TikTok caption as the pack reads it off the row: opener + "(link in bio)" sign-off on top.
const LEAD_FIRST = `Scan a card, see what it's worth: cardflip.io (link in bio)

${JUMPS}`;

const names = { JUMPS: ["Astral Dragon", "Gengar", "Kuzco", "Monkey.D.Luffy", "Blue-Eyes White Dragon"], TOP: ["Latias & Latios GX", "Charizard", "Umbreon VMAX", "Gengar & Mimikyu GX", "Jolteon Star"], SET: ["Charizard", "Lugia", "Magikarp", "Gengar", "Pikachu & Zekrom GX"] };
const prices = { JUMPS: ["$36.81", "$34.79", "$51.42", "$74.25", "$46.94"], TOP: ["$4,500", "$4,000", "$2,325", "$2,156", "$1,750"], SET: ["$163", "$203", "$84.47", "$53.65", "$29.70"] };

console.log("all five cards stay in, under 500");
for (const [k, cap] of [["JUMPS", JUMPS], ["TOP", TOP], ["SET", SET], ["LEAD_FIRST", LEAD_FIRST]]) {
  const key = k === "LEAD_FIRST" ? "JUMPS" : k;
  const { title, description } = pinFromCaption(cap);
  check(`${k}: description <= ${PIN_MAX} (${description.length})`, description.length <= PIN_MAX);
  check(`${k}: every card name in`, names[key].filter((n) => !description.includes(n)), []);
  check(`${k}: every price in`, prices[key].filter((p) => !description.includes(p)), []);
  check(`${k}: sign-off leads, no "(link in bio)"`, [description.startsWith("Scan a card, see what it's worth: cardflip.io."), description.includes("link in bio")], [true, false]);
  check(`${k}: the TikTok opener is gone`, /type (cardflip\.io|it) in your browser/i.test(description), false);
  check(`${k}: "#20" reads "No. 20" (Pinterest links #numbers)`, /#\d/.test(description), false);
  check(`${k}: hashtags stay (3+)`, (description.match(/#\w+/g) ?? []).length >= 3);
  check(`${k}: title <= ${PIN_TITLE_MAX}, from the intro, not the opener`, [title.length <= PIN_TITLE_MAX, /binder|Check your own|live on cardflip/i.test(title)], [true, false]);
}

console.log("what gives first");
{
  const { description } = pinFromCaption(SET);
  check("SET: the question goes, all 7 tags stay", [description.includes("Do you still have"), (description.match(/#\w+/g) ?? []).length], [false, 7]);
  const { description: t } = pinFromCaption(TOP);
  check("TOP: 'this week' goes before a hashtag does", [/this week/.test(t), (t.match(/#\w+/g) ?? []).length >= 3], [false, true]);
  const { description: j } = pinFromCaption(JUMPS);
  check("JUMPS (long intro) drops the question before any card", [j.includes("Which game has your best card?"), j.includes("Blue-Eyes White Dragon")], [false, true]);
  const { title } = pinFromCaption(JUMPS);
  check("JUMPS title is the intro cut at a clause", title, "The biggest price jumps this week in Magic");
}

console.log("odd captions");
{
  const only = pinFromCaption("Pikachu #25: $12.00\nCharizard #4: $300");
  check("cards only: title falls back to the first card", [only.title, only.description.includes("Pikachu No. 25")], ["Pikachu No. 25: $12.00", true]);
  const empty = pinFromCaption("");
  check("empty caption: still a title and the sign-off", [empty.title.length > 0, empty.description.startsWith("Scan a card")], [true, true]);
}

if (failures) {
  console.log(`\n${failures} check(s) FAILED.`);
  process.exit(1);
}
console.log("\nall green");
