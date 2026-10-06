import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { parseGame } from "@/lib/games";
import type { GameId } from "@/lib/types";
import { packTotals, toPulls, type PackTotals, type Pull, type PullRow } from "@/lib/packs";

/** Packs a user can keep; a script cannot grow the table without bound. */
const PACK_CAP = 1000;

export interface Pack {
  id: string;
  game: GameId;
  name: string;
  cost: number;
  createdAt: number;
}

export type PackSummary = Pack & PackTotals;
export type PackDetail = PackSummary & { pulls: Pull[] };

interface PackRow {
  id: string;
  game: string;
  name: string;
  cost: number;
  created_at: number;
}

interface PullDbRow {
  id: string;
  pack_id: string;
  card_name: string;
  set_name: string;
  image_url: string;
  status: string;
  price: number;
  scan_price: number | null;
  sold_price: number | null;
  quantity: number | null;
}

const PACK_COLS = "id, game, name, cost, created_at";
const PULL_COLS = "id, pack_id, card_name, set_name, image_url, status, price, scan_price, sold_price, quantity";

const toPack = (r: PackRow): Pack => ({ id: r.id, game: parseGame(r.game), name: r.name, cost: r.cost, createdAt: r.created_at });

const toPullRow = (r: PullDbRow): PullRow => ({
  id: r.id,
  cardName: r.card_name,
  setName: r.set_name,
  imageUrl: r.image_url,
  status: r.status,
  price: r.price,
  scanPrice: r.scan_price,
  soldPrice: r.sold_price,
  quantity: r.quantity ?? 1,
});

/** Null = this user already has the most packs allowed. */
export async function createPack(userId: string, input: { game: GameId; name: string; cost: number }): Promise<Pack | null> {
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM packs WHERE user_id = ?").get(userId)) as { n: number };
  if (n.n >= PACK_CAP) return null;
  const pack: Pack = { id: randomUUID(), game: input.game, name: input.name, cost: input.cost, createdAt: Date.now() };
  await db
    .prepare("INSERT INTO packs (id, user_id, game, name, cost, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(pack.id, userId, pack.game, pack.name, pack.cost, pack.createdAt);
  return pack;
}

/** True when the pack exists and is this user's: the check before a card is tied to it. */
export async function ownsPack(userId: string, packId: string): Promise<boolean> {
  return Boolean(await db.prepare("SELECT 1 FROM packs WHERE id = ? AND user_id = ?").get(packId, userId));
}

/** Newest first, each with its totals. One query for the packs, one for all their pulls. */
export async function listPacks(userId: string): Promise<PackSummary[]> {
  const packs = (await db
    .prepare(`SELECT ${PACK_COLS} FROM packs WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId)) as unknown as PackRow[];
  if (packs.length === 0) return [];
  const pulls = (await db
    .prepare(`SELECT ${PULL_COLS} FROM cards WHERE user_id = ? AND pack_id IS NOT NULL`)
    .all(userId)) as unknown as PullDbRow[];
  const byPack = new Map<string, PullRow[]>();
  for (const r of pulls) byPack.set(r.pack_id, [...(byPack.get(r.pack_id) ?? []), toPullRow(r)]);
  return packs.map((p) => ({ ...toPack(p), ...packTotals(p.cost, toPulls(byPack.get(p.id) ?? [])) }));
}

export async function getPack(userId: string, packId: string): Promise<PackDetail | null> {
  const row = (await db
    .prepare(`SELECT ${PACK_COLS} FROM packs WHERE id = ? AND user_id = ?`)
    .get(packId, userId)) as unknown as PackRow | undefined;
  if (!row) return null;
  const rows = (await db
    .prepare(`SELECT ${PULL_COLS} FROM cards WHERE user_id = ? AND pack_id = ? ORDER BY created_at ASC`)
    .all(userId, packId)) as unknown as PullDbRow[];
  const pulls = toPulls(rows.map(toPullRow));
  return { ...toPack(row), ...packTotals(row.cost, pulls), pulls };
}

/** Rename and/or re-price a pack. Null = not found. */
export async function updatePack(userId: string, packId: string, patch: { name?: string; cost?: number }): Promise<Pack | null> {
  const cur = (await db
    .prepare(`SELECT ${PACK_COLS} FROM packs WHERE id = ? AND user_id = ?`)
    .get(packId, userId)) as unknown as PackRow | undefined;
  if (!cur) return null;
  const next = { ...cur, name: patch.name || cur.name, cost: patch.cost ?? cur.cost };
  await db.prepare("UPDATE packs SET name = ?, cost = ? WHERE id = ? AND user_id = ?").run(next.name, next.cost, packId, userId);
  return toPack(next);
}

/** Delete the pack and keep its cards: they just stop belonging to it. Returns false when it was not the user's. */
export async function deletePack(userId: string, packId: string): Promise<boolean> {
  if (!(await ownsPack(userId, packId))) return false;
  await db.prepare("UPDATE cards SET pack_id = NULL WHERE user_id = ? AND pack_id = ?").run(userId, packId);
  await db.prepare("DELETE FROM packs WHERE id = ? AND user_id = ?").run(packId, userId);
  return true;
}
