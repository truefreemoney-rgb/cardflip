/**
 * Accuracy scripts read ONLY Chris's own scan photos (10-17, Chris: "yes limit
 * it to my account and delete them"). card_photos holds every user's seller
 * photo; the phone harnesses had no owner filter and pulled 67 customer photos
 * into backups/ and through the testing key. Every script that reads
 * card_photos joins through this clause.
 *
 *   FROM card_photos p JOIN cards c ON c.id = p.card_id ${OWNER_JOIN}
 *   ... args: [...OWNER_ARGS, ...]
 */

/** Same value as src/lib/server/users.ts OWNER_EMAIL (that module is server-only, so not imported here). */
export const OWNER_EMAIL = "truefreemoney@gmail.com";

/** Join `cards c` to its owner and keep the owner's rows only. Bind OWNER_ARGS first. */
export const OWNER_JOIN = "JOIN users owner ON owner.id = c.user_id AND lower(owner.email) = ?";
export const OWNER_ARGS = [OWNER_EMAIL];
