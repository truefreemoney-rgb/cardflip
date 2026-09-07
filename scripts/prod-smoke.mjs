/**
 * Production heartbeat — the checks that would have caught 2026-09-06.
 * Run: node scripts/prod-smoke.mjs [https://cardflip.io]
 *
 * No secrets, no writes, no accounts: every call is one a stranger could
 * make. Each check states what a healthy site returns; anything else fails
 * the run, and GitHub emails the repo owner (.github/workflows/prod-smoke.yml
 * runs this every 15 minutes and after every deploy).
 *
 * What it catches: the database host refusing reads (Turso quota block →
 * every DB route 500s), a deploy that broke a route, catalog search returning
 * nothing for a card that exists, the mail-reset endpoint erroring, and
 * pages that stopped rendering. What it deliberately does not do: log in,
 * scan, publish, or touch eBay/Stripe — those need real accounts and leave
 * traces.
 */
const base = (process.argv[2] ?? "https://cardflip.io").replace(/\/$/, "");
const TIMEOUT_MS = 15_000;

const results = [];
async function check(label, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ label, ok: true, ms: Date.now() - t0 });
  } catch (err) {
    results.push({ label, ok: false, ms: Date.now() - t0, detail: err instanceof Error ? err.message : String(err) });
  }
}

async function call(path, init = {}) {
  const res = await fetch(base + path, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "cardflip-smoke", ...(init.headers ?? {}) } });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* html or empty */ }
  return { status: res.status, json, text };
}
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

// --- database-backed API routes (all 500 together when the DB host is down) ----
await check("login route answers (bad password → 401, not 500)", async () => {
  const r = await call("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "smoke-probe@example.com", password: "not-a-real-password" }) });
  expect(r.status === 401, `status ${r.status}: ${r.text.slice(0, 200)}`);
});
await check("password reset route answers (unknown email → 200)", async () => {
  const r = await call("/api/auth/forgot", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "smoke-probe@example.com" }) });
  expect(r.status === 200, `status ${r.status}: ${r.text.slice(0, 200)}`);
});
await check("session route answers for a stranger (200, no user)", async () => {
  const r = await call("/api/auth/me");
  expect(r.status === 200 && r.json && r.json.user === null, `status ${r.status}: ${r.text.slice(0, 200)}`);
});

// --- catalog: a card that exists must resolve, both games ---------------------------
await check("Pokémon search resolves Charizard (Base Set 4)", async () => {
  const r = await call("/api/search-card?name=Charizard&game=pokemon");
  expect(r.status === 200, `status ${r.status}: ${r.text.slice(0, 200)}`);
  expect(r.json?.cards?.some((c) => c.name === "Charizard"), `no Charizard in ${r.json?.cards?.length ?? 0} cards`);
});
await check("Magic search resolves The One Ring (LTR 246)", async () => {
  const r = await call("/api/search-card?name=The%20One%20Ring&number=246&setCode=ltr&game=mtg");
  expect(r.status === 200, `status ${r.status}: ${r.text.slice(0, 200)}`);
  expect(r.json?.cards?.[0]?.name === "The One Ring", `top result ${r.json?.cards?.[0]?.name ?? "none"}`);
});
await check("set lists load (Pokémon and Magic)", async () => {
  const p = await call("/api/sets");
  expect(p.status === 200 && Array.isArray(p.json?.sets) && p.json.sets.length > 50, `pokemon sets: status ${p.status}, ${p.json?.sets?.length ?? 0}`);
  const m = await call("/api/sets?game=mtg");
  expect(m.status === 200 && Array.isArray(m.json?.sets) && m.json.sets.length > 50, `mtg sets: status ${m.status}, ${m.json?.sets?.length ?? 0}`);
});
await check("featured stage cards load", async () => {
  const r = await call("/api/cards/featured");
  expect(r.status === 200 && Array.isArray(r.json?.cards) && r.json.cards.length > 0, `status ${r.status}: ${r.text.slice(0, 200)}`);
});

// --- stock card art (assets.tcgdex.net, third party) ---------------------------------
// 09-07: every card image on the site went blank for a few minutes — tcgdex,
// not us — and it read as "stock images broke completely". A red here says
// "image host down" so the next blip is not chased through our own code.
await check("stock card art host serves an image (tcgdex)", async () => {
  const url = "https://assets.tcgdex.net/en/base/base1/4/low.webp";
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "cardflip-smoke" } });
  expect(res.status === 200, `status ${res.status}`);
  expect((res.headers.get("content-type") ?? "").startsWith("image/"), `content-type ${res.headers.get("content-type")}`);
});

// --- pages render --------------------------------------------------------------------
for (const path of ["/", "/pricing", "/help", "/login", "/signup", "/forgot-password"]) {
  await check(`page ${path} renders`, async () => {
    const r = await call(path);
    expect(r.status === 200, `status ${r.status}`);
    expect(/<title>[^<]*CardFlip/i.test(r.text), "no CardFlip <title>");
    expect(!/Application error|Internal Server Error/i.test(r.text), "error page text in body");
  });
}
await check("admin console is gated (redirects to its login)", async () => {
  const res = await fetch(base + "/admin", { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) });
  expect(res.status >= 300 && res.status < 400, `status ${res.status}`);
});

// --- report ---------------------------------------------------------------------------
let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label} (${r.ms}ms)${r.ok ? "" : `\n         ${r.detail}`}`);
}
console.log(failed ? `\n${failed} of ${results.length} production checks FAILED — ${base}` : `\nproduction healthy: ${results.length} checks — ${base}`);
process.exitCode = failed ? 1 : 0;
