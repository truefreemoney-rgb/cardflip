import { referrerHost } from "@/lib/visit";

/**
 * Signup attribution (Chris 09-30: "which posts bring people"). Pure helpers,
 * no DB and no DOM, shared by the proxy (short links), the browser
 * (AttributionCapture keeps the first touch), the visit ping and signup
 * routes (they sanitize what the browser sends) and the social publisher
 * (what each site's post links to).
 *
 * How a post is tracked (docs/SOCIAL-AUTOPILOT.md). Captions are never changed: every
 * one still ends on the plain cardflip.io.
 *  - Bluesky: the link facet's hidden uri is the full utm URL.
 *  - Pinterest: the pin's link field carries the utm URL.
 *  - X, Facebook, Threads: no tag is possible, so their visits are told apart by referrer
 *    (t.co, l.facebook.com, threads.net; see classifySource).
 *  - Instagram, TikTok: the owner sets the profile link to cardflip.io/i or cardflip.io/tt.
 * Those short paths (and /b /x /f /th) are answered by the proxy with a 302 to /?utm_source=...
 * The campaign is the draft id with the day cut to MMDD ("mtg-movers-0930").
 *
 * Privacy: the touch lives in this browser's localStorage and is sent once,
 * at signup. No cookie, nothing third-party, no personal detail in it.
 */

export const SITE_ORIGIN = "https://cardflip.io";

/** Short-link segment per site: cardflip.io/<code>/<campaign>. */
const SITE_CODES = { bluesky: "b", x: "x", facebook: "f", threads: "th", instagram: "i", tiktok: "tt" } as const;
export type TrackedSite = keyof typeof SITE_CODES;
/** Sites a link can be tagged for: the short-link ones, plus Pinterest's link field. */
export type UtmSite = TrackedSite | "pinterest";

const CODE_SITES: Record<string, TrackedSite> = Object.fromEntries(Object.entries(SITE_CODES).map(([site, code]) => [code, site])) as Record<string, TrackedSite>;

/** The proxy matches this: ^/(b|x|f|th|i|tt)(/campaign)?$ (a trailing slash is tolerated). */
export const SHORT_LINK = /^\/(b|x|f|th|i|tt)(?:\/([a-z0-9-]+))?\/?$/;

/** The profile links the owner sets in the Instagram and TikTok bios. */
export const BIO_URLS: Record<"instagram" | "tiktok", string> = {
  instagram: `${SITE_ORIGIN}/${SITE_CODES.instagram}`,
  tiktok: `${SITE_ORIGIN}/${SITE_CODES.tiktok}`,
};

/** A field as it is stored: lowercase, [a-z0-9._-] only, capped. Anything else is dropped. */
export function clean(v: unknown, max = 40): string {
  return typeof v === "string" ? v.toLowerCase().replace(/[^a-z0-9._-]/g, "").slice(0, max) : "";
}

/** The campaign a draft belongs to: "mtg-movers-2026-09-30" -> "mtg-movers-0930". */
export function draftCampaign(draftId: string): string {
  const m = /^(.*)-\d{4}-(\d{2})-(\d{2})$/.exec(draftId);
  return clean(m ? `${m[1]}-${m[2]}${m[3]}` : draftId);
}

/** The full tagged link (Bluesky's facet, Pinterest's link field). */
export function trackedUrl(site: UtmSite, campaign: string, origin = SITE_ORIGIN): string {
  const params = new URLSearchParams({ utm_source: site, utm_medium: "social", utm_campaign: clean(campaign) || "post" });
  return `${origin}/?${params.toString()}`;
}

/**
 * Where a short link goes, as a path + query for a 302 (the proxy), or null
 * when the path is not a short link. No campaign = the profile link ("bio").
 */
export function shortLinkTarget(pathname: string): string | null {
  const m = SHORT_LINK.exec(pathname);
  if (!m) return null;
  const site = CODE_SITES[m[1]];
  const params = new URLSearchParams({ utm_source: site, utm_medium: "social", utm_campaign: clean(m[2]) || "bio" });
  return `/?${params.toString()}`;
}

const UTM_ALIASES: Record<string, string> = {
  bluesky: "bluesky", bsky: "bluesky",
  x: "x", twitter: "x",
  facebook: "facebook", fb: "facebook",
  instagram: "instagram", ig: "instagram",
  threads: "threads",
  tiktok: "tiktok",
  pinterest: "pinterest", pin: "pinterest",
  // Google Ads (10-06): the tracking template tags utm_source=googleads; an untagged ad click still carries gclid.
  googleads: "googleads", "google-ads": "googleads", adwords: "googleads",
  google: "search", bing: "search", duckduckgo: "search", yahoo: "search", ecosia: "search", brave: "search",
};

/** Referrer hosts by registrable domain (subdomains like l.facebook.com match). */
const HOST_SOURCES: [RegExp, string][] = [
  [/(^|\.)(bsky\.app|bsky\.social)$/, "bluesky"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me|messenger\.com)$/, "facebook"],
  [/(^|\.)instagram\.com$/, "instagram"],
  [/(^|\.)(threads\.net|threads\.com)$/, "threads"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(pinterest\.[a-z.]{2,6}|pin\.it)$/, "pinterest"],
  [/(^|\.)google\.[a-z.]{2,6}$/, "search"],
  [/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|baidu\.com|startpage\.com|qwant\.com)$/, "search"],
  [/(^|\.)yandex\.[a-z.]{2,6}$/, "search"],
];

/**
 * The apps' own in-app browsers name themselves in the user agent and usually send no
 * referrer (10-01: every social visit was landing as "direct"). Instagram is tested
 * before Facebook because its browser carries FB tokens too. Only the matched source
 * is kept, never the user agent.
 */
const IN_APP_SOURCES: [RegExp, string][] = [
  [/\bBarcelona\b/, "threads"],
  [/\bInstagram\b/, "instagram"],
  [/\b(FBAN|FBAV|FB_IAB|FBIOS)\b/, "facebook"],
  [/musical_ly|BytedanceWebview|\bTikTok\b|\btrill_/, "tiktok"],
  [/\bPinterest\b/, "pinterest"],
  [/\bTwitter(Android|\b)/, "x"],
];

/** The social app whose in-app browser this user agent is, or "". */
export function inAppSource(userAgent: unknown): string {
  if (typeof userAgent !== "string" || !userAgent) return "";
  for (const [re, source] of IN_APP_SOURCES) if (re.test(userAgent)) return source;
  return "";
}

/**
 * The source of a visit: bluesky | x | facebook | instagram | threads | tiktok
 * | pinterest | search | other:<host> | direct. A tagged link (utm_source)
 * wins over the referrer; with neither, a social app's in-app browser (by its
 * user agent) names the source; no tag, no external referrer and no app is direct.
 */
export function classifySource(utmSource: unknown, refHost: unknown, userAgent?: unknown): string {
  const utm = clean(utmSource, 40);
  if (utm) return UTM_ALIASES[utm] ?? `other:${utm}`;
  const host = clean(refHost, 80);
  if (!host) return inAppSource(userAgent) || "direct";
  for (const [re, source] of HOST_SOURCES) if (re.test(host)) return source;
  return `other:${host}`;
}

const SOURCE_OK = /^(direct|search|googleads|bluesky|x|facebook|instagram|threads|tiktok|pinterest|other:[a-z0-9._-]{1,80})$/;

/** A stored/sent source, or "" when it is not one we classify to. */
export function cleanSource(v: unknown): string {
  const s = typeof v === "string" ? v.toLowerCase().trim() : "";
  return SOURCE_OK.test(s) ? s : "";
}

/** Plain label for a stored source (admin analytics). */
export function sourceLabel(src: string): string {
  const fixed: Record<string, string> = {
    bluesky: "Bluesky", x: "X", facebook: "Facebook", instagram: "Instagram", threads: "Threads", tiktok: "TikTok",
    pinterest: "Pinterest", search: "Search engines", googleads: "Google Ads", direct: "Direct", unknown: "Not recorded",
  };
  if (fixed[src]) return fixed[src];
  return src.startsWith("other:") ? src.slice(6) : src || fixed.unknown;
}

/** First touch as the browser keeps it (localStorage "cardflip.touch") and sends it at signup. */
export interface Touch {
  /** classifySource result. */
  s: string;
  /** utm_medium ("social" on our links), "" otherwise. */
  m: string;
  /** utm_campaign, "" otherwise. */
  c: string;
  /** External referrer host, "" for none or our own pages. */
  refHost: string;
  /** Path of the first page seen (no query), so a signup knows what it landed on. */
  landing: string;
  /** When it was captured (ms). */
  t: number;
}

export const TOUCH_TTL_MS = 30 * 86_400_000;

/** A path with no query or odd characters, capped; "" when it is not a path. */
export function cleanPath(v: unknown): string {
  if (typeof v !== "string" || !v.startsWith("/")) return "";
  const p = v.split(/[?#]/)[0].replace(/[^A-Za-z0-9/_.~%-]/g, "").replace(/\/{2,}/g, "/").slice(0, 120).replace(/(.)\/+$/, "$1");
  return p || "/";
}

/**
 * Whatever arrives as a touch (localStorage, a request body) made safe, or
 * null when it is not one. Malformed fields are dropped, never trusted.
 */
export function parseTouch(raw: unknown): Touch | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const s = cleanSource(o.s);
  if (!s) return null;
  const t = typeof o.t === "number" && Number.isFinite(o.t) && o.t > 0 ? Math.floor(o.t) : 0;
  return { s, m: clean(o.m, 20), c: clean(o.c), refHost: clean(o.refHost, 80), landing: cleanPath(o.landing), t };
}

/** utm_source, or the ad network an untagged ad click names by its click id (gclid/gbraid/wbraid = Google Ads, ttclid = TikTok). */
export function sourceParam(q: URLSearchParams): string | null {
  const utm = q.get("utm_source");
  if (utm) return utm;
  if (q.has("gclid") || q.has("gbraid") || q.has("wbraid")) return "googleads";
  if (q.has("ttclid")) return "tiktok";
  return null;
}

/** The touch this page load is: its tag and referrer, now. */
export function touchFromPage(page: { search: string; referrer: string; pathname: string; userAgent?: string }, now = Date.now()): Touch {
  const q = new URLSearchParams(page.search);
  const refHost = referrerHost(page.referrer);
  return {
    s: classifySource(sourceParam(q), refHost, page.userAgent),
    m: clean(q.get("utm_medium"), 20),
    c: clean(q.get("utm_campaign")),
    refHost: clean(refHost, 80),
    landing: cleanPath(page.pathname) || "/",
    t: now,
  };
}

/**
 * First touch wins for 30 days. A stored "direct" (someone typed the address
 * first) gives way to a real source, because that is what brought them
 * back; a stored real source is never replaced.
 */
export function chooseTouch(stored: Touch | null, fresh: Touch, now = Date.now()): Touch {
  if (!stored || stored.t <= 0 || now - stored.t > TOUCH_TTL_MS || stored.t > now + 86_400_000) return fresh;
  return stored.s === "direct" && fresh.s !== "direct" ? fresh : stored;
}
