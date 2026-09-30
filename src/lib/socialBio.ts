/**
 * Pure helpers for the profile-bio ops route (api/ops/social-bio). No server
 * imports, so scripts/test-social-bio.mjs can run them directly.
 */

/** Bio length caps we enforce before any write. Only sites with a write API are listed. */
export const BIO_MAX: Record<string, number> = { bluesky: 256, x: 160, facebook: 255 };

/** Bluesky counts graphemes; X and Facebook count UTF-16 units closely enough (X counts most emoji as 2, same as .length). */
export function bioLength(site: string, text: string): number {
  if (site === "bluesky") {
    const seg = new Intl.Segmenter("en", { granularity: "grapheme" });
    return [...seg.segment(text)].length;
  }
  return text.length;
}

/** A reason this bio must be refused (route answers 400), or null when it fits / the site has no cap. */
export function bioProblem(site: string, text: unknown): string | null {
  if (typeof text !== "string") return `${site}: bio must be a string`;
  const max = BIO_MAX[site];
  if (max === undefined) return null;
  const len = bioLength(site, text);
  return len > max ? `${site}: bio is ${len} characters, the limit is ${max}` : null;
}

export interface BlueskyProfileRecord {
  $type?: string;
  displayName?: string;
  description?: string;
  avatar?: unknown;
  banner?: unknown;
  [k: string]: unknown;
}

/**
 * The app.bsky.actor.profile/self record to put back: everything already on
 * the record (avatar, banner, labels, pinnedPost, ...) stays; description is
 * replaced; displayName is only filled in when it is empty.
 */
export function mergeBlueskyProfile(existing: BlueskyProfileRecord | null | undefined, description: string, defaultName = "CardFlip"): BlueskyProfileRecord {
  const base = existing ?? {};
  return {
    ...base,
    $type: "app.bsky.actor.profile",
    description,
    displayName: typeof base.displayName === "string" && base.displayName.trim() ? base.displayName : defaultName,
  };
}
