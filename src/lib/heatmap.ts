/**
 * Heat map (10-18, Chris: "where users fall off and where they click and go
 * the most"). Shared by the tap recorder (components/HeatPing.tsx), its
 * beacon route (/api/heat) and the admin page (/admin/heatmap).
 *
 * Pages are grouped by template, not by address: every card page is one
 * "Card page" map, so a few hundred card visits make one readable picture
 * instead of a few hundred one-visit dots.
 */

export type HeatDevice = "phone" | "desktop";

/** Narrower than this is a phone layout (Tailwind's md breakpoint, where the site switches). */
export const PHONE_MAX_WIDTH = 768;
/** The width the admin page draws each layout at: an iPhone 14/15, a laptop. */
export const SAMPLE_VIEWPORT: Record<HeatDevice, { w: number; h: number }> = {
  phone: { w: 390, h: 844 },
  desktop: { w: 1280, h: 800 },
};
/** Taps kept per page view: enough for the map, never a stream from one stuck finger or script. */
export const TAPS_PER_VIEW = 60;
/** Events per beacon (the recorder flushes long before this). */
export const MAX_EVENTS = 80;
/** Rows older than this are deleted (logCleanup); the admin page's longest preset is 90 days. */
export const HEAT_KEEP_DAYS = 90;

export function heatDevice(width: number): HeatDevice {
  return width > 0 && width < PHONE_MAX_WIDTH ? "phone" : "desktop";
}

/** Same shape the visit counter accepts (/api/visit). */
export const PATH_SHAPE = /^\/[A-Za-z0-9\-._~%/]{0,159}$/;

const TEMPLATES: [RegExp, string][] = [
  [/^\/cards\/[^/]+\/[^/]+\/page\/\d+$/, "/cards/[game]/[set]/page/[n]"],
  [/^\/cards\/[^/]+\/(most-valuable|movers)$/, "/cards/[game]/$1"],
  [/^\/cards\/[^/]+\/[^/]+\/[^/]+$/, "/cards/[game]/[set]/[card]"],
  [/^\/cards\/[^/]+\/[^/]+$/, "/cards/[game]/[set]"],
  [/^\/cards\/[^/]+$/, "/cards/[game]"],
  [/^\/app\/packs\/[^/]+$/, "/app/packs/[id]"],
  [/^\/help\/[^/]+$/, "/help/[slug]"],
  [/^\/pokemon\/[^/]+$/, "/pokemon/[slug]"],
  [/^\/u\/[^/]+$/, "/u/[handle]"],
];

/** Fixed pages, recorded under their own address. */
const STATIC_PAGES = new Set([
  "/", "/app", "/app/account", "/app/account/welcome", "/app/collection", "/app/collection/insights",
  "/app/collection/report", "/app/collection/sets", "/app/help", "/app/packs", "/app/price-check",
  "/app/rewards", "/app/wishlist", "/cards", "/confirm-email", "/connect-ebay", "/features",
  "/forgot-password", "/help", "/login", "/pricing", "/privacy", "/reset-password", "/scan",
  "/signup", "/terms", "/unavailable",
]);

/** The map a path belongs to, or null when it is not recorded at all (admin, api, unknown pages). */
export function pageKey(path: string): string | null {
  const p = path.split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  if (!PATH_SHAPE.test(p) || /^\/(admin|api)(\/|$)/.test(p)) return null;
  if (STATIC_PAGES.has(p)) return p;
  for (const [re, key] of TEMPLATES) if (re.test(p)) return p.replace(re, key);
  return null;
}

const LABELS: Record<string, string> = {
  "/": "Home",
  "/app": "Scanner",
  "/app/account": "Account",
  "/app/account/welcome": "Welcome",
  "/app/collection": "Inventory",
  "/app/collection/insights": "Inventory insights",
  "/app/collection/report": "Sales report",
  "/app/collection/sets": "Set progress",
  "/app/help": "Help (app)",
  "/app/packs": "Packs",
  "/app/packs/[id]": "One pack",
  "/app/price-check": "Price check",
  "/app/rewards": "Rewards",
  "/app/wishlist": "Watchlist",
  "/cards": "Card catalog",
  "/cards/[game]": "Game page",
  "/cards/[game]/[set]": "Set page",
  "/cards/[game]/[set]/page/[n]": "Set page (page 2+)",
  "/cards/[game]/[set]/[card]": "Card page",
  "/cards/[game]/most-valuable": "Most valuable",
  "/cards/[game]/movers": "Movers",
  "/scan": "Free scan",
  "/pricing": "Pricing",
  "/features": "Features",
  "/login": "Log in",
  "/signup": "Sign up",
  "/help": "Help",
  "/help/[slug]": "Help article",
  "/pokemon/[slug]": "Pokémon guide",
  "/u/[handle]": "Seller profile",
};

/** "Card page", "Scanner", … for the admin page; the address itself for anything unnamed. */
export function pageLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** Tap labels never carry what someone typed or who they are: no emails, no long numbers. */
export function cleanLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const s = raw.replace(/\s+/g, " ").trim().slice(0, 48);
  if (/@|\d{6,}/.test(s)) return "(hidden)";
  return s;
}
