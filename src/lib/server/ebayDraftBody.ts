import "server-only";
import type { DraftInput } from "@/lib/ebayInventory";

/** The DraftInput the editor sends, re-typed field by field; null if malformed. */
export function draftInputFromBody(body: unknown): Omit<DraftInput, "hasPhoto"> | null {
  const b = body as Partial<DraftInput> | null;
  if (!b || typeof b.cardId !== "string" || !b.listing || !b.card) return null;
  return {
    cardId: b.cardId,
    listing: {
      title: String(b.listing.title ?? ""),
      description: String(b.listing.description ?? ""),
      price: Number(b.listing.price),
      categoryId: String(b.listing.categoryId ?? ""),
      categoryName: String(b.listing.categoryName ?? ""),
    },
    card: {
      name: String(b.card.name ?? ""),
      englishName: b.card.englishName ? String(b.card.englishName) : null,
      setName: String(b.card.setName ?? ""),
      number: String(b.card.number ?? ""),
      rarity: b.card.rarity ? String(b.card.rarity) : null,
      imageLarge: String(b.card.imageLarge ?? ""),
      imageSmall: String(b.card.imageSmall ?? ""),
      typeLine: b.card.typeLine ? String(b.card.typeLine) : null,
    },
    game: b.game === "mtg" ? "mtg" : "pokemon",
    finish: b.finish === "foil" || b.finish === "etched" || b.finish === "nonfoil" ? b.finish : null,
    kind: b.kind === "sealed" ? "sealed" : "card",
    condition: b.condition ?? "Near Mint",
    grading:
      b.grading && (b.grading.company === "PSA" || b.grading.company === "CGC")
        ? { company: b.grading.company, grade: String(b.grading.grade ?? "") }
        : null,
    firstEdition: Boolean(b.firstEdition),
    quantity: Number.isFinite(Number(b.quantity)) ? Math.min(99, Math.max(1, Math.floor(Number(b.quantity)))) : 1,
    productType: b.productType ? String(b.productType) : null,
    language: b.language === "ja" || b.language === "zh" ? b.language : "en",
  };
}
