// Prints the public card page path for game:cardId pairs (local catalog). Usage: node ... _card-urls.mjs pokemon:base1-58-1st mtg:lea-6
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { loadCardRecord } = await import(at("lib/server/cardPages.ts"));
const { cardPath } = await import(at("lib/cardPages.ts"));
for (const arg of process.argv.slice(2)) {
  const [game, id] = arg.split(":");
  const rec = await loadCardRecord(game, id);
  console.log(arg, rec ? cardPath(game, rec.facts.setSlug, rec.facts.name, rec.facts.key) : "NOT FOUND");
}
process.exit(0);
