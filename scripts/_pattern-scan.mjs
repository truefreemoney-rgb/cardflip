// Read-only: TCGplayer Pokemon (tcgcsv cat 3) cards that share set + number + name but are separate products (patterns, art variants).
const H = { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" };
const get = async (u) => (await (await fetch(u, { headers: H })).json()).results ?? [];
const groups = await get("https://tcgcsv.com/tcgplayer/3/groups");
const suffix = {}; const sets = [];
let n = 0;
for (const g of groups) {
  const prods = await get(`https://tcgcsv.com/tcgplayer/3/${g.groupId}/products`);
  const byNum = new Map();
  for (const p of prods) {
    const num = (p.extendedData || []).find((e) => e.name === "Number")?.value;
    if (!num) continue;
    const base = p.name.replace(/\s*\([^)]*\)/g, "").replace(/\s*-\s*\d+\/\d+$/, "").trim().toLowerCase();
    const k = `${num}|${base}`;
    byNum.set(k, [...(byNum.get(k) ?? []), p.name]);
  }
  for (const [k, names] of byNum) {
    if (names.length < 2) continue;
    for (const nm of names) for (const m of nm.matchAll(/\(([^)]*)\)/g)) suffix[m[1]] = (suffix[m[1]] ?? 0) + 1;
    sets.push(`${g.name} #${k.split("|")[0]}: ${names.join(" ; ")}`);
  }
  if (++n % 40 === 0) await new Promise((r) => setTimeout(r, 1000));
}
const fs = await import("node:fs");
fs.writeFileSync(process.argv[2], sets.join("\n"));
console.log(`groups ${groups.length}, same-number name clashes ${sets.length}`);
console.log(Object.entries(suffix).sort((a, b) => b[1] - a[1]).slice(0, 60).map(([s, c]) => `${c} ${s}`).join(" | "));
