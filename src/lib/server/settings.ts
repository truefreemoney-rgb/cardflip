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

/** Magic for this viewer: admins always, everyone else only when public. */
export async function magicVisibleFor(user: Pick<User, "role"> | null | undefined): Promise<boolean> {
  if (user?.role === "admin") return true;
  return magicPublic();
}
