import { db } from "@/lib/db";
import type { User } from "@/lib/server/users";

/**
 * Site-wide switches an admin flips from the console (settings table, one
 * row per key). First one: whether Magic: The Gathering is public. Off =
 * Magic exists only for admins, so Chris can keep building it on the live
 * site without sellers seeing a half-finished game (09-04).
 */

export const MAGIC_PUBLIC_KEY = "magic_public";

export async function getSetting(key: string): Promise<string | null> {
  const row = (await db.prepare("SELECT value FROM settings WHERE key = ?").get(key)) as { value: string } | undefined;
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value, Date.now());
}

/** Is Magic switched on for everyone? Default off until Chris says so. */
export async function magicPublic(): Promise<boolean> {
  return (await getSetting(MAGIC_PUBLIC_KEY)) === "1";
}

/**
 * Every game after Pokémon is admin-only until its switch is flipped
 * (docs/BACKLOG.md NEXT VERTICALS: one at a time, gated first). Magic keeps
 * its original key; the newer games use "<game>_public".
 */
export const GATED_GAMES = ["mtg", "lorcana", "onepiece"] as const;
export type GatedGame = (typeof GATED_GAMES)[number];

export function gamePublicKey(game: GatedGame): string {
  return game === "mtg" ? MAGIC_PUBLIC_KEY : `${game}_public`;
}

export async function gamePublic(game: GatedGame): Promise<boolean> {
  return (await getSetting(gamePublicKey(game))) === "1";
}

export async function gameVisibleFor(user: Pick<User, "role"> | null | undefined, game: GatedGame): Promise<boolean> {
  if (user?.role === "admin") return true;
  return gamePublic(game);
}

/** The per-game visibility map the session hands the client. */
export async function gameFeaturesFor(user: Pick<User, "role"> | null | undefined): Promise<Record<GatedGame, boolean>> {
  const out = {} as Record<GatedGame, boolean>;
  for (const g of GATED_GAMES) out[g] = await gameVisibleFor(user, g);
  return out;
}

/** Magic for this viewer: admins always, everyone else only when public. */
export async function magicVisibleFor(user: Pick<User, "role"> | null | undefined): Promise<boolean> {
  if (user?.role === "admin") return true;
  return magicPublic();
}
