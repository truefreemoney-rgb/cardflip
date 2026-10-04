/**
 * Social inbox classifier (pure, no server imports): sorts a comment on one
 * of our posts into spam / question / praise / other. Spam is hidden on
 * sight where the site allows it (Facebook, Instagram, Threads, X) and
 * flagged where it does not (Bluesky); everything else waits for Chris on
 * /admin/social/inbox with a drafted reply. Errs toward "other" — a real
 * collector wrongly hidden costs more than one spam comment Chris dismisses.
 */

export type CommentKind = "spam" | "question" | "praise" | "other";

/** Links we never treat as spam: our own site and the platforms themselves. */
const OWN_HOSTS = /(^|\.)(cardflip\.io|bsky\.app|x\.com|twitter\.com|facebook\.com|instagram\.com|threads\.net|tiktok\.com)$/i;

const SPAM_PHRASES: RegExp[] = [
  /\bdm\s+(me|us)\b/i,
  /\b(whats?app|telegram)\b/i,
  // "signal" is an everyday word ("a better signal than 3 at a high ask", 10-04 Bluesky question marked spam): the app only with contact words.
  /\b(add|message|text|contact|reach|find|hit)\s+(me|us)\s+(on|via)\s+signal\b|\bsignal\s+(me|app|number|chat)\b/i,
  /\b(crypto|bitcoin|forex|binary options|nft drop|airdrop)\b/i,
  /\bcheck\s+(out\s+)?my\s+(page|profile|bio|link|shop|store)\b/i,
  /\b(link|shop|store)\s+in\s+(my\s+)?bio\b/i,
  /\bfollow\s+(me|back|for\s+follow)\b/i,
  /\bbuy\s+(followers|likes|views)\b/i,
  /\bpromo\s*code\b/i,
  /\bearn\s+\$?\d/i,
  /\b(make|made)\s+\$\d[\d,]*\s+(a|per)\s+(day|week|month)\b/i,
  /\bwork\s+from\s+home\b/i,
  /\b(cheap|discount|wholesale)\s+(cards?|boxes?|packs?)\s+(here|available|for sale)\b/i,
  /\bi\s+(sell|have)\s+.*\b(psa|cgc|bgs)\b.*\b(message|dm|inbox)\b/i,
  /\bmessage\s+me\s+(for|to)\b/i,
  /\b(hmu|hit me up)\b/i,
];

const QUESTION_STARTS = /^(how|what|where|when|why|which|who|is|are|does|do|can|could|would|should|will|did|any|anyone)\b/i;

const PRAISE_WORDS = /\b(nice|cool|awesome|love|great|sick|fire|amazing|beautiful|clean|dope|wow|sweet|legit|impressive|congrats|good stuff|well done)\b|🔥|❤️|😍|👏|💯/i;

function foreignLinks(text: string): number {
  let n = 0;
  for (const m of text.matchAll(/https?:\/\/([^\s/]+)|(?<![\w@.])((?:[a-z0-9-]+\.)+(?:com|net|org|io|co|shop|store|xyz|info|biz|me|link|app|gg|tv))(?![\w])/gi)) {
    const host = (m[1] ?? m[2] ?? "").replace(/^www\./i, "");
    if (host && !OWN_HOSTS.test(host)) n++;
  }
  return n;
}

export function classifyComment(text: string): CommentKind {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "other";
  if (SPAM_PHRASES.some((re) => re.test(t))) return "spam";
  const links = foreignLinks(t);
  if (links >= 2) return "spam";
  // One outside link with a sales pitch or a bare link and nothing else.
  if (links === 1 && (/\b(sale|selling|buy|cheap|free|win|giveaway|bonus|offer)\b/i.test(t) || t.replace(/https?:\/\/\S+/g, "").trim().length < 12)) return "spam";
  // Mass emoji / mention dumps with nothing to say.
  const mentions = (t.match(/(?<![\w])@[\w.]+/g) ?? []).length;
  if (mentions >= 3 && t.replace(/@[\w.]+/g, "").trim().length < 8) return "spam";
  if (t.includes("?") || QUESTION_STARTS.test(t)) return "question";
  if (PRAISE_WORDS.test(t) && t.length <= 160) return "praise";
  return "other";
}

/** True when a comment is one of ours (the page / account replying to itself). */
export function isOwnComment(authorId: string | null | undefined, authorHandle: string | null | undefined, ownIds: string[]): boolean {
  const ids = ownIds.filter(Boolean).map((s) => s.toLowerCase().replace(/^@/, ""));
  if (authorId && ids.includes(authorId.toLowerCase())) return true;
  if (authorHandle && ids.includes(authorHandle.toLowerCase().replace(/^@/, ""))) return true;
  return false;
}

/** Reply length per site, so a draft never gets refused on send. */
export const REPLY_MAX: Record<string, number> = { bluesky: 300, x: 280, facebook: 8000, instagram: 2200, threads: 500, tiktok: 150 };

/** Trim a reply to the site's limit on a word boundary. */
export function fitReply(site: string, text: string): string {
  const max = REPLY_MAX[site] ?? 280;
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim() + "…";
}

/* ---------- who gets a reply (Chris, 09-28: "only when necessary and occasional fun/playful engagement") ---------- */

export type ReplyPlan = "reply" | "hold" | "skip";

/** Complaints, disputes and anything heated: no robot reply, Chris answers in his own words. */
const TOUCHY = /\b(scam(mer|my)?|fraud|refund|rip[- ]?off|fake|lawsuit|sue|stole|stolen|overpriced|wrong price|garbage|trash|worst|terrible|awful|hate|disgusting|liar|lying|bs|bullshit|clickbait|misleading)\b/i;

/** Aimed at us by name — answered even without a question mark. */
const AIMED_AT_US = /@?card\s?flip\b/i;

function tinyHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * reply = draft and send; hold = show it to Chris with no draft (touchy);
 * skip = store it, say nothing. Questions and anything naming CardFlip get
 * a reply; praise gets one about one time in four (seeded on the comment
 * id, so a re-run picks the same ones); plain remarks get nothing.
 */
export function replyPlan(kind: CommentKind, text: string, id: string): ReplyPlan {
  if (kind === "spam") return "skip";
  const t = text.replace(/\s+/g, " ").trim();
  if (TOUCHY.test(t)) return "hold";
  if (kind === "question" || AIMED_AT_US.test(t)) return "reply";
  if (kind === "praise") return tinyHash(id) % 4 === 0 ? "reply" : "skip";
  return "skip";
}

/* ---------- guard rails for replies nobody reads first (Chris 09-28: "do them all") ---------- */

/** Comments older than this are stored, never answered — a late reply reads as a bot. */
export const STALE_MS = 2 * 24 * 60 * 60 * 1000;
/** Robot replies per day across every site. */
export const DAILY_REPLY_CAP = 10;
/** Robot replies to one person per day. */
export const PER_AUTHOR_DAILY_CAP = 1;
/** Robot replies to one person under one post, ever (their answer to our answer gets one more, then Chris). */
export const PER_THREAD_CAP = 2;

export function isStale(at: string, now = Date.now()): boolean {
  const t = new Date(at).getTime();
  return Number.isFinite(t) && now - t > STALE_MS;
}

const PROMISE_WORDS = /\b(guarantee[sd]?|always|never fails?|refund(s|ed)?|shipping|ship(s|ped)?|discount(s|ed)?|deal(s)?|coupon(s)?|promo(s|tion)?|free money|100%)\b/i;
const OWN_LINK = /^(https?:\/\/)?(www\.)?cardflip\.io(\/\S*)?$/i;

/**
 * Why a reply must NOT go out on its own, or null when it may. Dollar
 * figures are allowed only when our own post carries the same figure;
 * promises and sales words never; links only to cardflip.io; length
 * inside the site's limit.
 */
export function replyProblem(reply: string, postText: string, site: string): string | null {
  const r = reply.replace(/\s+/g, " ").trim();
  if (!r) return "empty";
  const max = REPLY_MAX[site] ?? 280;
  if (r.length > max) return `over ${max} characters`;
  const money = r.match(/\$\s?\d[\d,]*(\.\d+)?/g) ?? [];
  for (const m of money) {
    const plain = m.replace(/\s/g, "");
    if (!postText.replace(/\s/g, "").includes(plain)) return `names a price (${plain}) that is not in our post`;
  }
  for (const link of r.match(/https?:\/\/\S+|\b[\w-]+\.(com|io|net|org|app|gg|shop)\b\S*/gi) ?? []) {
    if (!OWN_LINK.test(link.replace(/[).,!?]+$/, ""))) return `links to ${link}`;
  }
  const promise = r.match(PROMISE_WORDS);
  if (promise) return `says "${promise[0]}"`;
  if (/[!]{1}/.test(r)) return "exclamation mark";
  return null;
}