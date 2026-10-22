// Scan-cost test (Chris 10-21): can Sonnet 5 or Haiku 5.5 make the SAME picture-tiebreak picks as Opus? Replays only
// Chris's own real tiebreak calls (scan_usage rows with read.tiebreak, his account only) against his saved scan photo
// (card_photos, owner join), on the TESTING key. --dry maps the pairs and prints the estimate without paying.
// Run: node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/_tiebreak-ab-owner.mjs [--dry] [--models claude-sonnet-5,claude-haiku-5-5]
import fs from "node:fs";
import { devAnthropicKey } from "./lib/dev-key.mjs";
import { OWNER_EMAIL } from "./lib/owner-photos.mjs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL = cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN = cfg.dbToken;
process.env.ANTHROPIC_API_KEY = devAnthropicKey();
const args = process.argv.slice(2);
const dry = args.includes("--dry");
const mi = args.indexOf("--models");
const models = (mi > -1 ? args[mi + 1] : "claude-sonnet-5,claude-haiku-5-5").split(",");
// $ per million tokens in/out (claude-api skill, 10-21): Opus 5 / 25, Sonnet 2 / 10, Haiku 5.5 ~1 / 5.
const RATES = { "claude-opus-5": [5, 25], "claude-sonnet-5": [2, 10], "claude-sonnet-5-5": [2, 10], "claude-haiku-5-5": [1, 5], "claude-haiku-4-5": [1, 5] };
const cost = (m, u) => ((u.inputTokens + (u.cacheReadTokens ?? 0)) * (RATES[m]?.[0] ?? 5) + u.outputTokens * (RATES[m]?.[1] ?? 25)) / 1e6;

const { db } = await import("../src/lib/db.ts");
const { tiebreakByPicture } = await import("../src/lib/server/vision.ts");
const owner = await db.prepare("SELECT id FROM users WHERE lower(email) = ?").get(OWNER_EMAIL.toLowerCase());
const rows = await db.prepare("SELECT at, model, input_tokens, output_tokens, read FROM scan_usage WHERE user_id = ? AND read LIKE '%\"tiebreak\"%' AND at > ? ORDER BY at").all(owner.id, Date.now() - 30 * 86400000);
const pairs = [];
for (const r of rows) {
  const read = JSON.parse(r.read);
  // The scan's saved card: the owner's card created within 5 minutes after the tiebreak, with its photo kept.
  const card = await db.prepare("SELECT c.id, c.card_name, c.catalog_card_id, c.created_at FROM cards c JOIN card_photos p ON p.card_id = c.id WHERE c.user_id = ? AND c.created_at BETWEEN ? AND ? ORDER BY c.created_at LIMIT 1").get(owner.id, r.at - 60000, r.at + 5 * 60000);
  pairs.push({ at: r.at, game: read.game, ids: read.tiebreak, opus: read.pick, conf: read.conf, opusCost: cost("claude-opus-5", { inputTokens: r.input_tokens, outputTokens: r.output_tokens }), card });
}
console.log(`owner tiebreak calls (30d): ${rows.length}, with a saved photo: ${pairs.filter((p) => p.card).length}`);
for (const p of pairs) console.log(new Date(p.at).toISOString(), p.game, p.ids.join(","), "opus", p.opus, p.conf, "card:", p.card ? `${p.card.card_name} -> ${p.card.catalog_card_id}` : "NO PHOTO");
const usable = pairs.filter((p) => p.card);
const est = usable.length * models.reduce((s, m) => s + 3000 * (RATES[m]?.[0] ?? 2) / 1e6 + 80 * (RATES[m]?.[1] ?? 10) / 1e6, 0);
console.log(`estimate: ${usable.length} pairs x ${models.join("+")} ≈ $${est.toFixed(3)} (Opus paid for these: $${usable.reduce((s, p) => s + p.opusCost, 0).toFixed(3)})`);
if (dry) process.exit(0);

let spent = 0;
const tally = {};
for (const p of usable) {
  const photo = await db.prepare("SELECT bytes FROM card_photos WHERE card_id = ?").get(p.card.id);
  const buf = Buffer.from(photo.bytes);
  const mediaType = buf[0] === 0xff ? "image/jpeg" : buf[0] === 0x89 ? "image/png" : "image/webp";
  for (const m of models) {
    const r = await tiebreakByPicture(buf.toString("base64"), mediaType, p.game, p.ids, m);
    const c = cost(m, r.usage);
    spent += c;
    // Truth = the card Chris kept (catalog_card_id), as a letter in this call's id list; "?" when he kept another card.
    const ti = p.ids.indexOf(p.card.catalog_card_id);
    const truth = ti >= 0 ? "ABCDEF"[ti] : "?";
    const same = r.pick === p.opus;
    const right = truth !== "?" ? r.pick === truth : null;
    tally[m] ??= { sameAsOpus: 0, differs: 0, right: 0, wrong: 0, cost: 0 };
    tally[m][same ? "sameAsOpus" : "differs"]++;
    if (right != null) tally[m][right ? "right" : "wrong"]++;
    console.log(`${m} | ${p.card.card_name} | ${p.ids.join(",")} | truth ${truth} | opus ${p.opus} (${p.conf}) vs ${r.pick} (${r.confidence}) ${same ? "SAME" : "DIFFERENT"}${right == null ? "" : right ? " RIGHT" : " WRONG"} | $${c.toFixed(4)} | ${r.reason.slice(0, 120)}`);
    tally[m].cost += c;
  }
  const oi = p.ids.indexOf(p.card.catalog_card_id);
  tally.opus ??= { right: 0, wrong: 0 };
  if (oi >= 0) tally.opus[p.opus === "ABCDEF"[oi] ? "right" : "wrong"]++;
}
console.log("\nresult:", JSON.stringify(tally), `spent $${spent.toFixed(3)}`);
process.exit(0);
