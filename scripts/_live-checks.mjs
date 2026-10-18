// Read-only live page checks on cardflip.io (GET/HEAD + one bad-input POST that must be refused). 10-18 sweep.
const B = "https://cardflip.io";
const UA = { "user-agent": "Mozilla/5.0 (cardflip-check)" };
const text = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");
async function page(path) {
  const t0 = Date.now();
  const r = await fetch(B + path, { headers: UA, redirect: "manual" });
  const body = await r.text();
  return { status: r.status, ms: Date.now() - t0, html: body, txt: text(body), headers: r.headers };
}
const near = (txt, re, n = 90) => {
  const m = txt.match(re);
  if (!m) return "(none)";
  const i = m.index ?? 0;
  return txt.slice(Math.max(0, i - n), i + m[0].length + n);
};
const cards = {
  "Pikachu 1st": "/cards/pokemon/base-set-1st-edition/pikachu--base1-58-1st",
  Shinx: "/cards/pokemon/arceus/shinx--pl4-SH12",
  "Volcanic Eruption": "/cards/magic/limited-edition-beta/volcanic-eruption--leb-89",
  "Blaze of Glory": "/cards/magic/limited-edition-alpha/blaze-of-glory--lea-6",
  Snorlax: "/cards/pokemon/kalos-starter-set/snorlax--xy0-26",
  Ninetales: "/cards/pokemon/gym-challenge-1st-edition/brocks-ninetales--gym2-3-1st",
  Minun: "/cards/pokemon/hgss-black-star-promos/minun--hgssp-HGSS17",
  "Rare Candy": "/cards/pokemon/plasma-blast/rare-candy--bw10-105",
  "Charizard base": "/cards/pokemon/base-set/charizard--base1-4",
  Rayquaza: "/cards/pokemon/ascended-heroes/rayquaza--me02.5-153",
  "Ancient Mew": "/cards/pokemon/miscellaneous-promos/ancient-mew--miscp-001",
};
for (const [name, path] of Object.entries(cards)) {
  const p = await page(path);
  const price = p.txt.match(/\$[\d,]+\.\d\d/)?.[0];
  const flags = ["Few sales", "looks off", "Checked against", "Down 33.6%", "Down 36.9%", "1st Edition", "Energy Symbol", "Friend Ball"].filter((f) => p.txt.includes(f));
  console.log(`${name}: ${p.status} ${p.ms}ms first price ${price} | ${flags.join(", ")}`);
  if (/Checked against|Few sales|looks off/.test(p.txt)) console.log("   ", near(p.txt, /Checked against|Few sales|looks off/));
}
console.log("\n# hubs: Most valuable sets");
for (const g of ["pokemon", "magic", "yugioh", "lorcana", "one-piece"]) {
  const p = await page(`/cards/${g}`);
  console.log(g, p.status, p.txt.includes("Most valuable sets") ? "YES " + near(p.txt, /Most valuable sets/, 160).slice(80) : "MISSING");
}
console.log("\n# headers / small pages");
const home = await page("/");
console.log("home", home.status, home.ms + "ms", "X-Frame-Options:", home.headers.get("x-frame-options"), "| (Worldwide English):", home.txt.includes("(Worldwide English)"));
const robots = await page("/robots.txt");
console.log("robots _rsc:", robots.html.includes("Disallow: /*?_rsc="));
const priv = await page("/privacy");
console.log("privacy:", near(priv.txt, /Effective|Last updated/i, 40));
for (const bad of ["/cards/pokemon/base-set/notacard--zz9-999", "/cards/pokemon/not-a-set", "/cards/notagame"]) console.log("404?", bad, (await page(bad)).status);
const login = await page("/login");
console.log("/login 'Log In as Admin':", login.txt.includes("Log In as Admin"));
for (let i = 0; i < 2; i++) {
  const t0 = Date.now();
  const r = await fetch(B + "/api/sets?game=pokemon", { headers: UA });
  await r.arrayBuffer();
  console.log("/api/sets pokemon", r.status, Date.now() - t0, "ms");
}
const v = await fetch(B + "/api/vision/trial", { method: "POST", headers: { ...UA, "content-type": "application/json" }, body: JSON.stringify({ image: "hello" }) });
console.log("vision trial bad image:", v.status);
