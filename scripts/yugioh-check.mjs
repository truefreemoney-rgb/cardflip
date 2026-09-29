// One-off (09-29): Yu-Gi-Oh! end to end on three TCGplayer pictures — read
// under the Pokémon switch (should switch itself), then the mirror lookup.
// Testing key, ~2¢ a card.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/yugioh-check.mjs [id ...]
import { devAnthropicKey } from "./lib/dev-key.mjs";

process.env.ANTHROPIC_API_KEY = devAnthropicKey();
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { analyzeCardImageWithUsage } = await import(at("lib/server/vision.ts"));
const { searchTcgCardsLocal, tcgCardById } = await import(at("lib/server/tcgCards.ts"));

const ids = process.argv.slice(2).length ? process.argv.slice(2) : ["ygo-21876", "ygo-22612", "ygo-80297"];
for (const id of ids) {
  const [want] = await tcgCardById(id);
  if (!want) { console.log(`${id}: not in the mirror`); continue; }
  const res = await fetch(want.imageLarge, { headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" } });
  const b64 = Buffer.from(await res.arrayBuffer()).toString("base64");
  const r = await analyzeCardImageWithUsage(b64, res.headers.get("content-type").split(";")[0], "en", "pokemon", false, () => true);
  const read = r.read;
  const printed = read.cardNumber ? { number: read.cardNumber, setTotal: null, setCode: read.setCode, isSecretRare: false } : null;
  const found = await searchTcgCardsLocal("yugioh", read.name, printed, 3, null, read.variant ?? null, read.firstEdition ?? null);
  const ok = found[0]?.id.replace(/-1st$/, "") === id.replace(/-1st$/, "");
  console.log(`${ok ? "PASS" : "MISS"} ${id} ${want.name} ${want.number} ${want.rarity}
     read: game=${read.game} from=${read.switchedFrom ?? "-"} name=${read.name} num=${read.cardNumber} rarity=${read.variant} 1st=${read.firstEdition} conf=${read.confidence}
     top: ${found.map((c) => `${c.id} ${c.number} ${c.rarity} ${c.rankScore}`).join(" | ")}
     tokens in=${r.usage.inputTokens} cacheRead=${r.usage.cacheReadTokens ?? 0} out=${r.usage.outputTokens}`);
}
