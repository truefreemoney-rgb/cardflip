// LOCAL dev DB only (data/cardflip.db, no TURSO_DATABASE_URL in .env.local): a clean account for the App Store
// screenshots, with verified cards, a couple of sales and a watchlist. Never run against production.
const SITE = "http://localhost:3000";
const EMAIL = "shots@cardflip.dev", PASSWORD = "Shots-Screens-2026!";
const H = { "content-type": "application/json", "x-cardflip-app": "web/1.0.0", "x-cardflip-device": "appstore-shots" };
let token = null;
const call = async (path, method = "GET", body) => {
  const r = await fetch(`${SITE}${path}`, { method, headers: { ...H, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};
let j;
try { j = await call("/api/auth/login", "POST", { email: EMAIL, password: PASSWORD }); }
catch { j = await call("/api/auth/signup", "POST", { name: "Alex", email: EMAIL, password: PASSWORD }); }
token = j.session?.token;
if (!token) throw new Error("no token " + JSON.stringify(j).slice(0, 300));
const me = await call("/api/auth/me");
console.log("user", me.user.email, "scans", JSON.stringify(me.user.scans), "trial", me.user.trialScansLeft);
const existing = (await call("/api/cards")).cards;
if (process.argv.includes("--reset")) { for (const c of existing) await call(`/api/cards/${c.id}`, "DELETE").catch((e) => console.log("del", e.message)); existing.length = 0; console.log("wiped"); }
if (existing.length) { console.log("already seeded:", existing.length, "cards"); }
const WANT = ["swsh7-215", "30th-c-001", "swsh11tg-TG17", "ecard3-149", "sv10.5w-095", "sm7-10", "sv03-130", "swsh10.5-010", "sv10-020", "sv3pt5-199", "sv4pt5-234", "sv8pt5-161", "base1-4", "swsh7-218", "sv3-125", "sv2-245", "swsh12pt5gg-GG70", "sv7-130", "sv10-250"];
const found = [];
for (const id of WANT) {
  const r = await fetch(`${SITE}/api/search-card?id=${encodeURIComponent(id)}`);
  const c = (await r.json()).cards?.[0];
  if (!c) continue;
  const usd = c.prices.filter((p) => p.currency === "USD" && p.market > 0);
  if (!usd.length || !c.imageSmall || usd[0].market < 1.25) continue;
  found.push({ c, usd });
  console.log("catalog", id, c.name, c.setName, usd[0].market);
}
if (!existing.some((c) => c.status !== "sold")) {
  const sold = new Set(["sv03-130", "sm7-10"]);
  const keep = new Set((await call("/api/cards")).cards.map((c) => c.catalogCardId));
  for (const { c, usd } of found.slice(0, 9).reverse()) {
    if (keep.has(c.id)) { console.log("kept", c.name); continue; }
    const price = usd[0].market;
    const card = (await call("/api/cards", "POST", { game: "pokemon", cardName: c.name, setName: c.setName, cardNumber: c.number, imageUrl: c.imageSmall, condition: "Near Mint", price: Math.round(price * 100) / 100, scanPrice: price, scanMarket: price, catalogCardId: c.id, rarity: c.rarity, variant: usd[0].variant })).card;
    const patch = { verifiedAt: Date.now() - 86400e3 * 3 };
    if (sold.has(c.id)) Object.assign(patch, { status: "sold", soldPrice: Math.round(price * 1.1 * 100) / 100, soldAt: Date.now() - 86400e3, verifiedAt: Date.now() - 86400e3 * 5 });
    await call(`/api/cards/${card.id}`, "PATCH", patch);
    console.log("saved", c.name, price, sold.has(c.id) ? "SOLD" : "");
  }
}
const wish = (await call("/api/wishlist")).items ?? [];
if (!wish.length) {
  for (const { c, usd } of found.slice(0, 6)) {
    await call("/api/wishlist", "POST", { card: c, price: usd[0].market, variant: usd[0].variant }).catch((e) => console.log("wish", e.message));
  }
  console.log("wishlist seeded");
}
console.log("TOKEN", token);
