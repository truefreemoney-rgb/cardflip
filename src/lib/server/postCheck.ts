import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";
import { activeChecks, checkKey } from "@/lib/server/checkedPrices";
import { SLOTS, type Slot } from "@/lib/server/socialPublish";
import { TIKTOK_SLOTS, tiktokKey } from "@/lib/socialTiktok";
import { RAW_ONLY_TERMS } from "@/lib/listing";
import { addDays } from "@/lib/priceSeries";
import { etDay, etDayStart } from "@/lib/time";
import type { GameId } from "@/lib/types";

/**
 * "Post cards" on /admin/prices (10-18, step 3). No automatic rule tells a
 * right post price from a wrong one (docs/research/post-price-catch-2026-10-18.md:
 * eBay asks, jumps and frozen prices all fail), so every card of the day's
 * three videos is checked by hand against eBay SOLD. "Looks right" marks it;
 * "Fix" records the sold price (checkedPrices.ts: fixed everywhere, the card
 * sits out of posts) and remakes that video if it has not gone out yet.
 */

export interface PostCard {
  game: GameId;
  cardId: string;
  variant: string;
  label: string;
  price: number;
  soldUrl: string;
  status: "fixed" | "ok" | "unchecked";
  /** The checked eBay sold price when fixed. */
  fixedUsd?: number;
}

export interface PostSlot {
  day: string;
  slot: Slot;
  label: string;
  /** The slot's posts have gone out (its hour has passed): a fix still fixes the price, the video is not remade. */
  past: boolean;
  title: string;
  cards: PostCard[];
}

/** settings key with the "Looks right" marks of a day: { "game|card|variant": true }. */
const marksKey = (day: string) => `post_check:${day}`;

async function readMarks(day: string): Promise<Record<string, boolean>> {
  try {
    const v = JSON.parse((await getSetting(marksKey(day))) || "{}");
    return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export async function setMark(day: string, game: GameId, cardId: string, variant: string, ok: boolean): Promise<void> {
  const marks = await readMarks(day);
  const k = checkKey(game, cardId, variant);
  if (ok) marks[k] = true;
  else delete marks[k];
  await setSetting(marksKey(day), JSON.stringify(marks));
}

/** The instant a slot posts (its Eastern hour on that day). */
export function slotAt(slot: Slot, day: string): number {
  return etDayStart(Date.parse(`${day}T12:00:00Z`)) + SLOTS[slot].hour * 3_600_000;
}

const FINISH: Record<string, string> = { reverseHolofoil: " reverse holo", "1stEditionHolofoil": " 1st edition", "1stEditionNormal": " 1st edition", foil: " foil" };

/** eBay sold, raw copies only, newest first: the card's name, number and set (and its finish when that is not the plain one). */
export function postSoldUrl(c: { name: string; number: string; setName: string; variant: string }): string {
  const q = `${c.name} ${c.number} ${c.setName.replace(/\s*\(1st Edition\)/i, "")}${FINISH[c.variant] ?? ""} ${RAW_ONLY_TERMS}`;
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q.replace(/\s+/g, " ").trim())}&LH_Sold=1&LH_Complete=1&_sop=13`;
}

interface StoredCard {
  cardId?: string;
  name?: string;
  number?: string;
  setName?: string;
  variant?: string;
  to?: number;
  game?: GameId;
}

/** Today's and tomorrow's (Eastern) three videos, each card with its check status. */
export async function postSlots(now = Date.now()): Promise<PostSlot[]> {
  const today = etDay(now);
  const days = [today, addDays(today, 1)];
  const checks = await activeChecks({ fresh: true });
  const out: PostSlot[] = [];
  for (const day of days) {
    const marks = await readMarks(day);
    for (const slot of TIKTOK_SLOTS) {
      let row: { title?: string; game?: GameId; cards?: StoredCard[] } | null = null;
      try {
        row = JSON.parse((await getSetting(tiktokKey(slot, day))) || "null");
      } catch {
        row = null;
      }
      const cards: PostCard[] = [];
      for (const c of row?.cards ?? []) {
        if (!c.cardId || !c.name || typeof c.to !== "number") continue;
        const game: GameId = c.game ?? row?.game ?? "pokemon";
        const variant = c.variant ?? "normal";
        const k = checkKey(game, c.cardId, variant);
        const fix = checks.get(k);
        cards.push({
          game,
          cardId: c.cardId,
          variant,
          label: `${c.name} · ${c.setName ?? ""} ${c.number ?? ""}`.trim(),
          price: c.to,
          soldUrl: postSoldUrl({ name: c.name, number: c.number ?? "", setName: c.setName ?? "", variant }),
          status: fix ? "fixed" : marks[k] ? "ok" : "unchecked",
          ...(fix ? { fixedUsd: fix.usd } : {}),
        });
      }
      out.push({ day, slot, label: `${day === today ? "Today" : "Tomorrow"} ${SLOTS[slot].hour > 12 ? SLOTS[slot].hour - 12 : SLOTS[slot].hour}${SLOTS[slot].hour >= 12 ? "pm" : "am"}`, past: slotAt(slot, day) <= now, title: row?.title ?? "", cards });
    }
  }
  return out;
}
