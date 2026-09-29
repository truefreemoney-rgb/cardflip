// Shows which eBay listings a graded price is built from (09-29: Base Set
// Charizard PSA 10 averaged $629, below PSA 9 and raw). One Browse call per grade.
//   npm run ebay:graded -- base1-4 PSA 10
import fs from "node:fs";

for (const f of [".env.local", ".env.vercel.local"]) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = /^(EBAY_[A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}
const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { fetchEbayComps } = await import(at("lib/server/ebay.ts"));
const { englishCardById } = await import(at("lib/server/enCards.ts"));
const { isComparable } = await import(at("lib/ebayComps.ts"));

const [id = "base1-4", company = "PSA", grade = "10"] = process.argv.slice(2);
const card = (await englishCardById(id)).cards[0];
if (!card) throw new Error(`no card ${id}`);
console.log(`${card.name} ${card.number}/${card.setTotal} ${card.setName}`);
const comps = await fetchEbayComps(card, { company, grade }, false);
console.log(comps ? `avg ${comps.average} median ${comps.median} n=${comps.count}/${comps.sampled}` : "no comps");
for (const l of comps?.listings ?? []) console.log(`$${l.price}  ${l.title}`);
