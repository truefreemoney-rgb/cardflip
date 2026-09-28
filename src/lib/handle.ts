/**
 * Public collection handles (Tier 2 #10): the slug in cardflip.io/u/<handle>.
 * Pure — shared by the account form (instant feedback) and the API (the
 * truth). 3–24 characters, lowercase letters, digits and hyphens, no
 * leading/trailing/double hyphen, and never a word that reads as ours.
 */

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 24;

const RESERVED = new Set([
  "admin", "administrator", "cardflip", "support", "help", "api", "app", "www", "mail", "root", "system", "staff",
  "official", "team", "null", "undefined", "me", "you", "user", "users", "login", "signup", "account", "settings",
  "pricing", "about", "terms", "privacy", "u", "card", "cards", "pokemon", "ebay", "tcgplayer", "collectr",
]);

/** Lowercase, spaces and underscores to hyphens, everything else dropped. */
export function normalizeHandle(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, HANDLE_MAX);
}

/** Why a handle is not allowed, or null when it is. Expects normalized input. */
export function handleProblem(handle: string): string | null {
  if (handle.length < HANDLE_MIN) return `At least ${HANDLE_MIN} characters`;
  if (handle.length > HANDLE_MAX) return `At most ${HANDLE_MAX} characters`;
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(handle)) return "Letters, numbers and hyphens only";
  if (RESERVED.has(handle)) return "That one is taken";
  return null;
}

export function publicCollectionPath(handle: string): string {
  return `/u/${handle}`;
}
