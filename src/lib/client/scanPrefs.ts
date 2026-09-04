"use client";

import { CONDITIONS } from "@/lib/listing";
import type { Condition, PriceStrategy } from "@/lib/types";

/**
 * The seller's last-used condition and pricing strategy, remembered per
 * browser (same pattern as the game toggle in lib/games.ts). A seller
 * grading a whole box as Lightly Played, or one who always holds out for
 * market, shouldn't re-pick it on every card — new queue items are born
 * with these instead of hardcoded Near Mint / quick. Vision still wins:
 * a condition read off the photo overwrites the default.
 */

const CONDITION_KEY = "cardflip.condition";
const STRATEGY_KEY = "cardflip.strategy";

export function readSavedCondition(): Condition {
  if (typeof window === "undefined") return "Near Mint";
  try {
    const raw = window.localStorage.getItem(CONDITION_KEY);
    return raw && (CONDITIONS as string[]).includes(raw) ? (raw as Condition) : "Near Mint";
  } catch {
    return "Near Mint";
  }
}

export function saveCondition(condition: Condition): void {
  try {
    window.localStorage.setItem(CONDITION_KEY, condition);
  } catch {
    // Private mode / quota — the choice just doesn't persist.
  }
}

export function readSavedStrategy(): PriceStrategy {
  if (typeof window === "undefined") return "quick";
  try {
    const raw = window.localStorage.getItem(STRATEGY_KEY);
    return raw === "market" || raw === "quick" ? raw : "quick";
  } catch {
    return "quick";
  }
}

/** Last category new scans were filed under; null = uncategorized. */
const CATEGORY_KEY = "cardflip.category";

export function readSavedCategory(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CATEGORY_KEY);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function saveCategory(category: string | null): void {
  try {
    if (category) window.localStorage.setItem(CATEGORY_KEY, category);
    else window.localStorage.removeItem(CATEGORY_KEY);
  } catch {
    // Private mode / quota — the choice just doesn't persist.
  }
}

export function saveStrategy(strategy: PriceStrategy): void {
  try {
    window.localStorage.setItem(STRATEGY_KEY, strategy);
  } catch {
    // Private mode / quota — the choice just doesn't persist.
  }
}
