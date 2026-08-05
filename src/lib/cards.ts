import { apiPath } from "@/lib/client/basePath";
import type { PokemonCard } from "@/lib/types";

export async function searchCards(
  name: string,
  number?: string | null,
): Promise<PokemonCard[]> {
  const params = new URLSearchParams({ name });
  if (number) params.set("number", number);

  const res = await fetch(apiPath(`/api/search-card?${params.toString()}`));
  if (!res.ok) throw new Error(`Search failed (${res.status})`);

  const data = await res.json();
  return data.cards ?? [];
}
