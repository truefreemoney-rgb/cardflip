// Big-print read + no-number ranking test (10-30): on Chris's own Pokémon scans, (a) does the first read get HP /
// attack names / Pokédex / regulation mark right vs the catalog text row, and how much slower is it; (b) with the
// collector number HIDDEN from the ranker, does the right printing still come first with the big-print clues vs
// without? Owner photos only, TESTING key, local catalog (en_card_text from sync-ptcg-text.mjs). Writes nothing.
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_bigprint-owner.mjs [--limit 40] [--cap 0.60]
import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@libsql/client";
import { DatabaseSync } from "node:sqlite";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_ARGS, OWNER_JOIN } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const limit = Number(arg("--limit", 40)), cap = Number(arg("--cap", 0.6));
const MODEL = "claude-sonnet-5", RATE = { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 };
const prod = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
const localDb = new DatabaseSync("data/cardflip.db", { readOnly: true });
const anthropic = new Anthropic({ apiKey: devAnthropicKey() });
const V = await import("../src/lib/server/vision.ts");
const E = await import("../src/lib/server/enCards.ts");
const rows = (await prod.execute({ sql: `SELECT p.card_id id, p.bytes, c.card_name, c.card_number, c.set_name, c.catalog_card_id cat FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN} WHERE c.game='pokemon' ORDER BY c.created_at DESC LIMIT ?`, args: [...OWNER_ARGS, limit] })).rows;
const textRow = localDb.prepare("SELECT hp, dex, regulation, attacks FROM en_card_text WHERE id = ?");
const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
let spent = 0, n = 0, ms = 0, outTok = 0;
const acc = { hp: [0, 0], atk: [0, 0], dex: [0, 0], reg: [0, 0] };
const rank = { plain: [0, 0], clues: [0, 0], plainTie: 0, cluesTie: 0 };
const lines = [];
const cacheFile = "data/bigprint-reads-2026-10-30.json";
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
for (const r of rows) {
  if (spent >= cap) break;
  const bytes = Buffer.isBuffer(r.bytes) ? r.bytes : Buffer.from(r.bytes);
  const key = String(r.id);
  let dt = 0, u = { input_tokens: 0, output_tokens: 0 }, raw;
  if (cache[key]) { raw = cache[key].raw; dt = cache[key].ms; u.output_tokens = cache[key].out; } else {
  const content = await V.firstReadContent(bytes.toString("base64"), "image/jpeg", "en", "pokemon", false, 0);
  const t0 = Date.now();
  const res = await anthropic.messages.create({
    model: MODEL, max_tokens: 2000,
    output_config: { effort: "low", format: { type: "json_schema", schema: V.POKEMON_READ_SCHEMA } },
    system: [{ type: "text", text: V.SYSTEM, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  });
  dt = Date.now() - t0;
  u = res.usage;
  spent += (u.input_tokens * RATE.in + u.output_tokens * RATE.out + (u.cache_read_input_tokens ?? 0) * RATE.cacheRead + (u.cache_creation_input_tokens ?? 0) * RATE.cacheWrite) / 1e6;
  raw = JSON.parse(res.content.find((x) => x.type === "text").text);
  cache[key] = { raw, ms: dt, out: u.output_tokens }; fs.writeFileSync(cacheFile, JSON.stringify(cache));
  }
  ms += dt; n++; outTok += u.output_tokens;
  const g = { ...raw, hp: raw.hp > 0 ? raw.hp : null, dexNumber: raw.dexNumber > 0 ? raw.dexNumber : null, regulationMark: raw.regulationMark || null, attackNames: (raw.attackNames ?? []).filter(Boolean) };
  const t = r.cat ? textRow.get(r.cat) : null;
  const tAtk = t ? JSON.parse(t.attacks).map(fold) : [];
  const mark = (k, ok, known) => { if (!known) return "·"; acc[k][1]++; if (ok) acc[k][0]++; return ok ? "✓" : "✗"; };
  const hpM = mark("hp", g.hp === t?.hp, t?.hp != null && g.hp != null);
  const atkM = mark("atk", (g.attackNames ?? []).length > 0 && (g.attackNames ?? []).every((a) => tAtk.some((p) => p === fold(a) || p.includes(fold(a)) || fold(a).includes(p))), tAtk.length > 0 && (g.attackNames ?? []).length > 0);
  const dexM = mark("dex", g.dexNumber === t?.dex, t?.dex != null && g.dexNumber != null);
  const regM = mark("reg", String(g.regulationMark ?? "").toUpperCase() === String(t?.regulation ?? "").toUpperCase(), Boolean(t?.regulation) && Boolean(g.regulationMark));
  // Ranking with the number hidden.
  const base = { number: "", setTotal: null, setCode: g.setCode ?? null, isSecretRare: false, setName: g.setName ?? null, copyrightYear: g.copyrightYear ?? null };
  const plain = await E.searchEnglishCardsLocal(g.name, base, 24, g.artStyle ?? null, g.firstEdition ?? null);
  const clues = await E.searchEnglishCardsLocal(g.name, { ...base, hp: g.hp ?? null, attacks: g.attackNames ?? null, dexNumber: g.dexNumber ?? null, regulationMark: g.regulationMark ?? null }, 24, g.artStyle ?? null, g.firstEdition ?? null);
  const topOk = (res) => res.cards[0]?.id === r.cat;
  const tie = (res) => res.cards.length > 1 && res.cards[1].rankScore - res.cards[0].rankScore <= 1;
  if (r.cat) { rank.plain[1]++; rank.clues[1]++; if (topOk(plain)) rank.plain[0]++; if (topOk(clues)) rank.clues[0]++; if (tie(plain)) rank.plainTie++; if (tie(clues)) rank.cluesTie++; }
  const line = `${r.card_name} #${r.card_number} (${r.set_name}) | hp ${g.hp ?? "-"}${hpM} atk [${(g.attackNames ?? []).join(", ")}]${atkM} dex ${g.dexNumber ?? "-"}${dexM} reg ${g.regulationMark ?? "-"}${regM} | ${dt}ms ${u.output_tokens}out | no-number rank: plain ${topOk(plain) ? "✓" : "✗ " + (plain.cards[0]?.setName ?? "-") + " #" + (plain.cards[0]?.number ?? "-")}${tie(plain) ? " (tie)" : ""} → clues ${topOk(clues) ? "✓" : "✗ " + (clues.cards[0]?.setName ?? "-") + " #" + (clues.cards[0]?.number ?? "-")}${tie(clues) ? ` (tie: #2 ${clues.cards[1].setName} #${clues.cards[1].number} ${clues.cards[0].rankScore}→${clues.cards[1].rankScore})` : ""}`;
  console.log(line); lines.push(line);
}
console.log(`\n=== ${n} photos, spent $${spent.toFixed(3)}, avg ${Math.round(ms / n)} ms, avg ${Math.round(outTok / n)} output tokens ===`);
for (const k of Object.keys(acc)) console.log(`${k}: ${acc[k][0]}/${acc[k][1]} right where both the read and the catalog have it`);
console.log(`no-number ranking: plain ${rank.plain[0]}/${rank.plain[1]} top-1 right (${rank.plainTie} near-ties) → with big-print clues ${rank.clues[0]}/${rank.clues[1]} (${rank.cluesTie} near-ties)`);
fs.writeFileSync("data/bigprint-owner-2026-10-30.txt", lines.join("\n"));
