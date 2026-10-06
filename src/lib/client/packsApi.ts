"use client";

import { apiFetch } from "@/lib/client/basePath";
import type { PackTotals, Pull } from "@/lib/packs";
import type { GameId } from "@/lib/types";

/** Pack tracker calls (audit G8). Each resolves null/false on any failure, never throws. */
export interface PackSummary extends PackTotals {
  id: string;
  game: GameId;
  name: string;
  createdAt: number;
}

export type PackDetail = PackSummary & { pulls: Pull[] };

export interface PackLifetime {
  cost: number;
  value: number;
  profit: number;
  roiPct: number | null;
  packs: number;
  cards: number;
}

export async function fetchPacks(): Promise<{ packs: PackSummary[]; lifetime: PackLifetime } | null> {
  try {
    const res = await apiFetch("/api/packs", { cache: "no-store" });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function fetchPack(id: string): Promise<{ pack: PackDetail | null; missing: boolean } | null> {
  try {
    const res = await apiFetch(`/api/packs/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (res.status === 404) return { pack: null, missing: true };
    if (!res.ok) return null;
    return { pack: (await res.json()).pack as PackDetail, missing: false };
  } catch {
    return null;
  }
}

/** Resolves the new pack, or the server's message to show. */
export async function createPackRequest(input: { game: GameId; name: string; cost: number }): Promise<{ pack?: { id: string }; error?: string }> {
  try {
    const res = await apiFetch("/api/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const data = await res.json().catch(() => null);
    return res.ok ? { pack: data.pack } : { error: data?.error ?? "Couldn't open the pack. Try again." };
  } catch {
    return { error: "Couldn't open the pack. Try again." };
  }
}

export async function deletePackRequest(id: string): Promise<boolean> {
  try {
    return (await apiFetch(`/api/packs/${encodeURIComponent(id)}`, { method: "DELETE" })).ok;
  } catch {
    return false;
  }
}
