// Scratch, read-only: why a card's price is flagged on prod.  node scripts/.flag-probe-tmp.mjs bw8-136
const id = process.argv[2];
const r = await fetch(`https://cardflip.io/api/price-history?cardId=${encodeURIComponent(id)}`);
const body = await r.json();
for (const s of body.series ?? []) {
  const p = s.points ?? [];
  const tail = p.slice(-12).map((x) => `${x.day.slice(5)}:${x.price}`).join(" ");
  const uniq = [...new Set(p.map((x) => x.price))];
  console.log(JSON.stringify({ variant: s.variant, source: s.source, cur: s.currency, n: p.length, first: p[0]?.day, last: p[p.length - 1]?.day, distinctPrices: uniq.length, min: Math.min(...uniq), max: Math.max(...uniq), untrusted: s.untrusted ?? null, stale: s.stale ?? null }));
  console.log("  tail:", tail);
}
if (!body.series) console.log(r.status, JSON.stringify(body).slice(0, 300));
