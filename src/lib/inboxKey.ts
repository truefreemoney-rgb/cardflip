import { createHash } from "node:crypto";

/**
 * One inbox, however it is spelled (Chris 10-01): Gmail delivers
 * john.smith@, johnsmith@ and johnsmith+anything@ (and @googlemail.com) to the
 * same person, so they are one key here and share one free trial. Every other
 * address is its own key as typed (lower-cased). Stored hashed in
 * signup_log.inbox_key, like the IP: the row outlives a deleted account (so
 * delete-and-sign-up-again stays a repeat) without keeping its address.
 *
 * Its own file with no app imports: scripts/backfill-inbox-key.mjs loads it too.
 */
export function inboxKey(email: string): string | null {
  const clean = email.trim().toLowerCase();
  const at = clean.lastIndexOf("@");
  if (at < 1 || at === clean.length - 1) return null;
  let local = clean.slice(0, at);
  let domain = clean.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    domain = "gmail.com";
    local = local.split("+")[0].replaceAll(".", "");
    if (!local) return null;
  }
  return createHash("sha256").update(`cardflip-inbox:${local}@${domain}`).digest("hex").slice(0, 32);
}
