// A hand-posted Pinterest Pin's title + description from a TikTok caption (scripts/tiktok-pack.mjs writes pinterest.txt
// from it). Pure, so scripts/test-pin-text.mjs can pin it down.
//
// Pinterest flattens line breaks and links every "#103" (10-03 7am pin: "its a mess"), so the description is ONE
// flowing paragraph: the sign-off FIRST (Chris 10-03), the lead sentence, the cards separated by " · " with "No. 103"
// instead of "#103", the question, then the hashtags.
//
// 10-21 (TASKS B): the pin kept only 1-2 of the 5 cards three days running, because the TikTok opener ("Type cardflip.io
// in your browser...") and the long intro ate the 500 characters and the cards were the first thing cut. Pinterest has a
// link field and the sign-off already leads, so the opener goes; the cards are the LAST thing to go: question first, then
// the card lines lose "this week" / "today", then the intro shrinks to its first clause, then hashtags down to three
// (Chris 09-30: tags on every post), and only then a card.
export const PIN_MAX = 500;
export const PIN_TITLE_MAX = 100;
const SIGNOFF = "Scan a card, see what it's worth: cardflip.io";
/** The TikTok openers (lib/server/socialTiktok.ts TIKTOK_LEADS) all tell the viewer to type the address: not for a Pin. */
const OPENER = /type (cardflip\.io|it) in your browser/i;

const dot = (s) => (s && !/[.!?]$/.test(s) ? s + "." : s);
const flat = (s) => s.replace(/\s+/g, " ").trim();

/** Cut a line to `max` at a clause boundary past 40 chars (a comma, sentence end or " and "), else a word. */
export function cutClause(text, max = PIN_TITLE_MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  // First clause boundary past 40 chars, not the last: the last one left "..., and one card from Lorcana" dangling (10-03 7pm pin).
  const comma = cut.indexOf(", ", 40);
  const clause = comma > 40 ? comma : Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" and "));
  const sp = cut.lastIndexOf(" ");
  return (clause > 40 ? cut.slice(0, clause) : sp > 40 ? cut.slice(0, sp) + "…" : cut + "…").trimEnd();
}

/** The intro's first clause: up to its first sentence end, or its first comma past 40 chars. */
function firstClause(intro) {
  const m = /^(.{40,}?[.!?])(\s|$)/.exec(intro);
  if (m && m[1].length < intro.length) return m[1];
  const comma = intro.indexOf(", ", 40);
  return comma > 40 ? intro.slice(0, comma) + "." : intro;
}

export function pinFromCaption(cap0) {
  const paras = cap0.trim().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  let signoff = SIGNOFF;
  if (/^Scan a card/i.test(paras[0] ?? "")) signoff = paras.shift().replace(/\s*\(link in bio\)/i, "").trim();
  const tagsAll = paras.filter((x) => /^#/.test(x)).join(" ").split(/\s+/).filter(Boolean);
  // The opener is dropped (see the header); so is a bare second sign-off.
  const body = paras.filter((x) => !/^#/.test(x) && !OPENER.test(x) && !/^Scan a card/i.test(x));
  const li = body.map((x, i) => [i, (x.match(/\$/g) || []).length]).sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1;
  // The intro is the first paragraph that is not the card list; a caption that is only cards has none.
  const ii = body.findIndex((_, i) => i !== li);
  const intro = ii >= 0 ? flat(body[ii]) : "";
  const cardsFull = li >= 0 ? body[li].split("\n").map((l) => l.replace(/#(\d+)/g, "No. $1").trim()).filter(Boolean) : [];
  const cardsTight = cardsFull.map((l) => l.replace(/,? this week\b/g, "").replace(/ today\b/g, ""));
  const rest = body.filter((_, i) => i !== ii && i !== li).map(flat);
  const title = cutClause(intro.split("\n")[0] || cardsFull[0] || signoff) || "CardFlip";

  const build = ({ cards, n = cards.length, question = true, tags = tagsAll.length, lead = intro }) =>
    [dot(signoff), dot(lead), dot(cards.slice(0, n).join(" · ")), ...(question ? rest.map(dot) : []), tagsAll.slice(0, tags).join(" ")].filter(Boolean).join(" ");
  const steps = [
    { cards: cardsFull },
    { cards: cardsFull, question: false },
    { cards: cardsTight, question: false },
    { cards: cardsTight, question: false, lead: firstClause(intro) },
    { cards: cardsTight, question: false, tags: 3, lead: firstClause(intro) },
  ];
  for (let n = cardsTight.length; n >= 1; n--) steps.push({ cards: cardsTight, n, question: false, tags: 2, lead: firstClause(intro) });
  let description = build(steps[0]);
  for (const s of steps) {
    description = build(s);
    if (description.length <= PIN_MAX) break;
  }
  if (description.length > PIN_MAX) description = description.slice(0, PIN_MAX - 1).trimEnd() + "…";
  return { title, description, cards: cardsFull.length };
}
