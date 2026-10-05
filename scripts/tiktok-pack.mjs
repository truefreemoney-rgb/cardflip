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
// The file name says what the video is (10-04: the optimizer rotates the 7am and 7pm kinds, so the name follows the row's kind).
const slots = [["morning", "1 - 7am"], ["midday", "2 - 1pm"], ["evening", "3 - 7pm"]];
const KIND_LABEL = { set: "Set Spotlight", movers: "Biggest Movers", games: "Biggest Jumps", dips: "Price Drops", guess: "Guess the Price", thennow: "Then vs Now", versus: "Head to Head", sleepers: "Sleepers Under $5", top: "Most Valuable" };
const ANGLES = ["guess", "thennow", "versus", "sleepers", "top"];

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
    // An angle caption (head to head, then vs now, …) names the cards in one sentence and the prices in another.
    const line = ANGLES.includes(v.kind) ? (cap.includes(c.name) ? cap : null) : cap.split("\n").find((l) => l.includes(c.name) && l.includes(money(now)));
    if (!line || !want.every((w) => line.includes(w))) bad.push(`${c.name} ${want.join(" -> ")}`);
  }
  if (bad.length) throw new Error(`${label}: caption prices do not match the frozen video:\n  ${bad.join("\n  ")}`);
  console.log(label, "prices ok:", rows.length, "cards");
}

let captions = "";
const caps = [];
let missing = 0;
for (const [slot, time] of slots) {
  const r = await db.execute({ sql: "SELECT value FROM settings WHERE key = ?", args: [`social_tiktok:${slot}:${day}`] });
  if (!r.rows[0]) { console.log(slot, "MISSING"); missing++; continue; }
  const v = JSON.parse(r.rows[0].value);
  const label = `${time} ${KIND_LABEL[v.kind] ?? v.kind}`;
  if (!/^https:\/\/mlwovvakovcpakbr\.public\.blob\.vercel-storage\.com\//.test(v.url)) throw new Error("not our Blob store: " + slot);
  const buf = Buffer.from(await (await fetch(v.url)).arrayBuffer());
  if (buf.length !== v.bytes) throw new Error(`${label}: downloaded ${buf.length} bytes, row says ${v.bytes}`);
  // No music in the pack (10-05): from 10-04 every TikTok carrying our uploaded track sat at 0-2 views while the same
  // video with no audio got views, so the pack's MP4 is video only and Chris adds a sound from TikTok's library at post time.
  // Only TikTok goes silent (Chris 10-05): Pinterest gets the same video WITH our rotating music, so the pack keeps both.
  const withMusic = path.join(dir, `${label} - Pinterest (music).mp4`);
  fs.writeFileSync(withMusic, buf);
  {
    const { spawnSync } = await import("node:child_process");
    const ffmpeg = (await import("ffmpeg-static")).default;
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-i", withMusic, "-an", "-c:v", "copy", path.join(dir, `${label} - TikTok (no music).mp4`)]);
    if (r.status !== 0) throw new Error(`${label}: could not strip the music: ${r.stderr.toString().slice(-300)}`);
  }
  let cap = v.caption ?? v.text ?? "";
  // Chris 10-03: every TikTok carries seven tags. A caption rendered before 64e8015 (five tags) gets the reach tags here.
  // A non-Pokémon video rendered before the per-game reach tags (10-04) carries #Pokemon #PokemonCommunity: dropped here.
  const vg = v.game ?? "pokemon";
  if (vg !== "pokemon" && !/#PokemonTCG/.test(cap)) cap = cap.replace(/\s#Pokemon(Community)?(?=\s|$)/g, "").trimEnd();
  const have = (cap.match(/(?:^|\s)#[A-Za-z]\w*/g) ?? []).map((t) => t.trim());
  // Same order as tiktokTags: the general tags first, then the reach tags OF THE VIDEO'S GAME (10-04: a Yu-Gi-Oh head
  // to head once got #Pokemon topped on). Reach tags are confirmed from TikTok's own suggestion list at post time.
  const REACH = { pokemon: ["#Pokemon", "#PokemonCommunity"], yugioh: ["#YuGiOhCards", "#YugiohCommunity"], mtg: ["#MagicTheGathering", "#MTGCommunity"], lorcana: ["#Lorcana", "#LorcanaTCG"], onepiece: ["#OnePieceCardGame", "#OnePieceTCG"] };
  const game = v.game ?? (/#PokemonTCG/.test(cap) ? "pokemon" : /#Yugioh/i.test(cap) ? "yugioh" : /#MTG\b/.test(cap) ? "mtg" : "mixed");
  for (const t of ["#TCG", "#TradingCards", "#CardCollector", ...(REACH[game] ?? ["#CardCollecting", "#TCGCommunity"])]) if (have.length < 7 && !have.includes(t)) { cap = cap.trimEnd() + " " + t; have.push(t); }
  assertPrices(label, v, cap);
  captions += `===== ${label} =====\n${cap}\n\n`;
  caps.push([label, cap]);
  console.log(slot, "ok", buf.length, "bytes");
}
if (missing) throw new Error(`${missing} slot(s) not registered for ${day}; the night render has not run`);

// Cover photos (Chris 10-04: "cover photos always need to be the best you can make it", TikTok, Pinterest, any site with
// one): the videos open from black, so the default cover is a black square. For each MP4 the brightest frame of the
// first 14 s (sampled every half second: a card with its price on screen, never a fade) is written as "<label> cover.png";
// TikTok's Edit cover → Upload cover and Pinterest's Pick a cover take it.
// Only STILL frames qualify (10-04: the brightest frame of the 7pm head to head was mid price count-up, $38.97 / $25.17
// against a caption saying $43.52 / $39.14): a frame counts as still when no pixel of a 90x160 gray sample moves by more
// than 40 levels 0.4 s later, i.e. the screen is holding with its final numbers. No still frame = the brightest one.
{
  const { spawnSync } = await import("node:child_process");
  const ffmpeg = (await import("ffmpeg-static")).default;
  for (const [label] of caps) {
    const mp4 = path.join(dir, `${label}.mp4`);
    const grab = (t) => {
      const r = spawnSync(ffmpeg, ["-v", "error", "-ss", String(t), "-i", mp4, "-frames:v", "1", "-vf", "scale=90:160", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"]);
      return r.status === 0 && r.stdout.length ? r.stdout : null;
    };
    let best = { t: 0, lum: -1, still: false };
    for (let t = 1; t <= 14; t += 0.5) {
      const a = grab(t);
      if (!a) continue;
      const b = grab(t + 0.4);
      const still = !!b && a.every((x, i) => Math.abs(x - b[i]) <= 40);
      const lum = a.reduce((s, x) => s + x, 0) / a.length;
      if ((still && !best.still) || (still === best.still && lum > best.lum)) best = { t, lum, still };
    }
    const png = path.join(dir, `${label} cover.png`);
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", String(best.t), "-i", mp4, "-frames:v", "1", png]);
    if (r.status !== 0) throw new Error(`${label}: cover frame failed: ${r.stderr.toString().slice(-300)}`);
    console.log(label, `cover at ${best.t}s (brightness ${Math.round(best.lum)}${best.still ? ", still" : ", NO STILL FRAME, check it"})`);
  }
}
fs.writeFileSync(path.join(dir, "captions.txt"), "TikTok: post the \"TikTok (no music)\" MP4 and add a sound from TikTok's library (Sounds). Pinterest: post the \"Pinterest (music)\" MP4.\n\n" + captions, "utf8");

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
