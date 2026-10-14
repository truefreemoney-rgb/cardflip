// LOCAL: what the site's price guard says about a few cards now that ebay_asks has rows (eBay referee check). 10-13.
delete process.env.TURSO_DATABASE_URL;
delete process.env.TURSO_AUTH_TOKEN;
const { siteTrust, trustKey } = await import("../src/lib/server/priceTrustSite.ts");
const qs = [
  { cardId: "ex13-103", game: "pokemon", variant: "holofoil" },
  { cardId: "ygo-38633", game: "yugioh", variant: "normal" },
  { cardId: "xy2-108", game: "pokemon", variant: "holofoil" },
];
const flags = await siteTrust(qs);
for (const q of qs) console.log(q.cardId, q.variant, "->", JSON.stringify(flags.get(trustKey(q.cardId, q.variant)) ?? "shown"));
process.exit(0);
