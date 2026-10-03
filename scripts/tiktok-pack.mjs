// Today's three TikTok videos + captions from prod settings (read-only) into Downloads\CardFlip TikTok <MM-DD>,
// plus pinterest.txt for the hand-posted video Pins. Chris posts from that folder (memory cardflip-tiktok-post-in-pane).
//   node scripts/tiktok-pack.mjs [YYYY-MM-DD]   (default: today, Eastern)
// Every caption price is checked against the frozen video cards/leads (10-03: checked by eye until now);
// a mismatch is a hard stop so a wrong number never reaches the post.
import { createClient } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const day = process.argv[2] ?? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
const j = JSON.parse(fs.readFileSync(new URL("../.env.migration.json", import.meta.url), "utf8"));
const db = createClient({ url: j.dbUrl, authToken: j.dbToken });
const dir = path.join(os.homedir(), "Downloads", `CardFlip TikTok ${day.slice(5)}`);
fs.mkdirSync(dir, { recursive: true });
const slots = [["morning", "1 - 7am Set Spotlight"], ["midday", "2 - 1pm Biggest Movers"], ["evening", "3 - 7pm Biggest Jumps"]];

// The caption prints a price as $12.34 under $100 and $123 (rounded) from $100 up.
const money = (n) => (n >= 100 ? "$" + Math.round(n).toLocaleString("en-US") : "$" + n.toFixed(2));
/** Throws when any frozen card's name or price is missing from the caption. */
function assertPrices(label, v, cap) {
  const rows = v.kind === "games" ? v.leads ?? [] : v.cards ?? [];
  if (!rows.length) throw new Error(`${label}: no frozen cards/leads on the row`);
  const bad = [];
  for (const c of rows) {
    const now = c.price ?? c.to; // leads carry price, set/movers cards carry from -> to
    const want = [now, v.kind === "movers" ? c.from : null].filter((x) => typeof x === "number").map(money);
    const line = cap.split("\n").find((l) => l.includes(c.name) && l.includes(money(now)));
    if (!line || !want.every((w) => line.includes(w))) bad.push(`${c.name} ${want.join(" -> ")}`);
  }
  if (bad.length) throw new Error(`${label}: caption prices do not match the frozen video:\n  ${bad.join("\n  ")}`);
  console.log(label, "prices ok:", rows.length, "cards");
}

let captions = "";
const caps = [];
let missing = 0;
for (const [slot, label] of slots) {
  const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [`social_tiktok:${slot}:${day}`] });
  if (!r.rows[0]) { console.log(slot, "MISSING"); missing++; continue; }
  const v = JSON.parse(r.rows[0].value);
  if (!/^https:\/\/mlwovvakovcpakbr\.public\.blob\.vercel-storage\.com\//.test(v.url)) throw new Error("not our Blob store: " + slot);
  const buf = Buffer.from(await (await fetch(v.url)).arrayBuffer());
  if (buf.length !== v.bytes) throw new Error(`${label}: downloaded ${buf.length} bytes, row says ${v.bytes}`);
  fs.writeFileSync(path.join(dir, `${label}.mp4`), buf);
  let cap = v.caption ?? v.text ?? "";
  // Chris 10-03: every TikTok carries seven tags. A caption rendered before 64e8015 (five tags) gets the reach tags here.
  const have = (cap.match(/(?:^|\s)#[A-Za-z]\w*/g) ?? []).map((t) => t.trim());
  // Same order as tiktokTags: the general tags first, then the reach tags.
  for (const t of ["#TCG", "#TradingCards", "#CardCollector", "#Pokemon", "#PokemonCommunity"]) if (have.length < 7 && !have.includes(t)) { cap = cap.trimEnd() + " " + t; have.push(t); }
  assertPrices(label, v, cap);
  captions += `===== ${label} =====\n${cap}\n\n`;
  caps.push([label, cap]);
  console.log(slot, "ok", buf.length, "bytes");
}
if (missing) throw new Error(`${missing} slot(s) not registered for ${day}; the night render has not run`);
fs.writeFileSync(path.join(dir, "captions.txt"), captions, "utf8");

// Pinterest by hand (Chris 10-03: the app review is taking forever). Same
// three MP4s as video Pins; a Pin = title (first caption line, <=100) +
// description (whole caption, <=500) + link + board. Hashtags stay in the
// description; Pinterest reads them there.
let pins = "Board: Pokémon Card Prices\nLink: https://cardflip.io\n\n";
for (const [label, cap0] of caps) {
  // Pinterest flattens line breaks and links every "#103" (10-03 7am pin: "its a mess"), so its description is ONE
  // flowing paragraph: the sign-off FIRST (Chris 10-03, no "(link in bio)": Pinterest has a link field), the lead
  // sentence, the cards separated by " · " with "No. 103" instead of "#103", the question, then the hashtags.
  const paras = cap0.trim().split(/\n{2,}/);
  let signoff = "Scan a card, see what it's worth: cardflip.io";
  if (/^Scan a card/i.test(paras[0])) signoff = paras.shift().replace(/\s*\(link in bio\)/i, "").trim();
  const tags = paras.filter((x) => /^#/.test(x)).join(" ").replace(/\s+/g, " ").trim();
  const body = paras.filter((x) => !/^#/.test(x));
  const li = body.map((x, i) => [i, (x.match(/\$/g) || []).length]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  const lead = body[0] ?? "";
  const cards = li >= 0 ? body[li].split("\n").map((l) => l.replace(/#(\d+)/g, "No. $1").trim()).filter(Boolean) : [];
  const rest = body.filter((_, i) => i !== 0 && i !== li).map((x) => x.replace(/\s+/g, " ").trim());
  let title = lead.split("\n")[0].trim();
  if (title.length > 100) {
    const cut = title.slice(0, 99);
    // First clause boundary past 40 chars, not the last: the last one left
    // "..., and one card from Lorcana" dangling (10-03 7pm pin).
    const comma = cut.indexOf(", ", 40);
    const clause = comma > 40 ? comma : Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" and "));
    const sp = cut.lastIndexOf(" ");
    title = (clause > 40 ? cut.slice(0, clause) : sp > 40 ? cut.slice(0, sp) + "…" : cut + "…").trimEnd();
  }
  const dot = (s) => (s && !/[.!?]$/.test(s) ? s + "." : s);
  const build = (n) => [dot(signoff), dot(lead.replace(/\s+/g, " ").trim()), dot(cards.slice(0, n).join(" · ")), ...rest.map(dot), tags].filter(Boolean).join(" ");
  let n = cards.length;
  let description = build(n);
  while (description.length > 500 && n > 1) description = build(--n);
  if (description.length > 500) description = description.slice(0, 499).trimEnd() + "…";
  pins += "===== " + label + " =====\nTitle: " + title + "\nDescription:\n" + description + "\n\n";
}
fs.writeFileSync(path.join(dir, "pinterest.txt"), pins, "utf8");
console.log(dir);
