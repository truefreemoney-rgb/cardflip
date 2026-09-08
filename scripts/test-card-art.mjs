/**
 * Second-source card art (lib/cardArt.ts). Run: npm run test:cardart
 *
 * Pins: a TCGdex low/high URL maps to the pokemontcg.io small/hires PNG;
 * zero-padded numbers lose the padding, lettered numbers pass through;
 * the renamed sets go through SET_MAP; non-TCGdex sources (already the
 * fallback, a seller photo, empty) give null so callers stop retrying.
 */
const { fallbackArtUrl } = await import(new URL("../src/lib/cardArt.ts", import.meta.url).href);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

check("same-id set, low → small png", fallbackArtUrl("https://assets.tcgdex.net/en/base/base1/4/low.webp"), "https://images.pokemontcg.io/base1/4.png");
check("same-id set, high → hires png", fallbackArtUrl("https://assets.tcgdex.net/en/base/base1/4/high.webp"), "https://images.pokemontcg.io/base1/4_hires.png");
check("zero padding dropped", fallbackArtUrl("https://assets.tcgdex.net/en/sv/sv10/012/low.webp"), "https://images.pokemontcg.io/sv10/12.png");
check("renamed set (sv08.5 → sv8pt5)", fallbackArtUrl("https://assets.tcgdex.net/en/sv/sv08.5/086/high.webp"), "https://images.pokemontcg.io/sv8pt5/86_hires.png");
check("renamed set (sv10.5b → zsv10pt5)", fallbackArtUrl("https://assets.tcgdex.net/en/sv/sv10.5b/033/low.webp"), "https://images.pokemontcg.io/zsv10pt5/33.png");
check("lettered number passes through", fallbackArtUrl("https://assets.tcgdex.net/en/swsh/swshp/SWSH247/low.webp"), "https://images.pokemontcg.io/swshp/SWSH247.png");
check("gallery number passes through", fallbackArtUrl("https://assets.tcgdex.net/en/swsh/swsh12.5gg/GG01/low.webp"), "https://images.pokemontcg.io/swsh12pt5gg/GG01.png");
check("cache-bust query ignored", fallbackArtUrl("https://assets.tcgdex.net/en/base/base1/4/low.webp?r=2"), "https://images.pokemontcg.io/base1/4.png");
check("already pokemontcg.io → null", fallbackArtUrl("https://images.pokemontcg.io/base1/4.png"), null);
check("seller photo → null", fallbackArtUrl("/api/card-image/abc?v=1"), null);
check("empty → null", fallbackArtUrl(""), null);
check("set logo (not a card) → null", fallbackArtUrl("https://assets.tcgdex.net/en/base/base1/logo.webp"), null);

console.log(failures === 0 ? "\nAll card-art checks passed." : `\n${failures} card-art check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
