"use client";

import { apiPath } from "@/lib/client/basePath";

export interface ServerCard {
  id: string;
  userId: string;
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  status: "ready" | "listed" | "sold";
  price: number;
  listedAt: number | null;
  soldPrice: number | null;
  soldAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CreateCardInput {
  cardName: string;
  setName: string;
  cardNumber: string;
  imageUrl: string;
  condition: string;
  price: number;
}

export interface UpdateCardInput {
  condition?: string;
  price?: number;
  status?: "ready" | "listed" | "sold";
  listedAt?: number | null;
  soldPrice?: number | null;
  soldAt?: number | null;
}

export async function createServerCard(
  input: CreateCardInput,
): Promise<ServerCard | null> {
  try {
    const res = await fetch(apiPath("/api/cards"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.card ?? null;
  } catch {
    return null;
  }
}

export async function updateServerCard(
  id: string,
  patch: UpdateCardInput,
): Promise<void> {
  try {
    await fetch(apiPath(`/api/cards/${id}`), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    // Best-effort sync — the local queue stays the source of truth for the UI.
  }
}

export async function deleteServerCard(id: string): Promise<void> {
  try {
    await fetch(apiPath(`/api/cards/${id}`), { method: "DELETE" });
  } catch {
    // Best-effort — local removal already happened.
  }
}
