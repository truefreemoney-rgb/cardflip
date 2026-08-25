"use client";

import type { GradedInfo, PriceStrategy, ScanItem } from "@/lib/types";

/**
 * Refresh survival for the scanner queue. Only items that reached the ledger
 * (have a serverId) can come back — the photo and its object URL die with the
 * page. The server row already owns status, price, condition, listedAt and
 * the sold fields, so this stores just the state that lives nowhere else:
 * the row ids plus the client-only pricing choices made in the editor.
 */

const KEY = "cardflip.queue.v1";

export interface SavedQueueEntry {
  /** Ledger row backing this item — the anchor everything is rebuilt from. */
  serverId: string;
  id: string;
  /** Editor choices the server never sees. */
  variant: string | null;
  firstEdition: boolean;
  priceOverride: number | null;
  strategy: PriceStrategy;
  grading: GradedInfo | null;
  /** Absent in payloads saved before listing copy became editable. */
  titleOverride?: string | null;
  descriptionOverride?: string | null;
}

export interface SavedQueue {
  /** Items that had a server row — the only ones that can be rebuilt. */
  entries: SavedQueueEntry[];
  /** Queue length at save time, so a restore can say how many didn't make it. */
  total: number;
}

export function saveQueue(items: ScanItem[]): void {
  const payload: SavedQueue = {
    entries: items
      .filter((item) => item.serverId)
      .map((item) => ({
        serverId: item.serverId!,
        id: item.id,
        variant: item.variant,
        firstEdition: item.firstEdition,
        priceOverride: item.priceOverride,
        strategy: item.strategy,
        grading: item.grading,
        titleOverride: item.titleOverride,
        descriptionOverride: item.descriptionOverride,
      })),
    total: items.length,
  };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(payload));
  } catch {
    // Storage unavailable (Safari private mode) or full — persistence is
    // best-effort; scanning must not break over it.
  }
}

export function loadQueue(): SavedQueue | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedQueue;
    if (!Array.isArray(parsed.entries) || typeof parsed.total !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearQueue(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Same best-effort stance as saveQueue.
  }
}
