/**
 * One builder for the catalog search request (10-30, scanner #B "one trip").
 *
 * The phone (lib/cards.ts) and the scan route (lib/server/scanPrefetch.ts) build the SAME query string from a
 * read, so the server can run the search inside the scan request and the phone can trust the answer only when
 * the string it would have sent is byte-for-byte the one the server used. No client-only imports here: the
 * server imports this too.
 */
import type { PrintedNumber } from "@/lib/cardNumber";
import { isSecretRareNumber, readHasPrintedKey } from "@/lib/cardNumber";
import { mtgCuesToParams } from "@/lib/mtgCues";
import type { ArtStyle, GameId, MtgCues, ScanLanguage, VisionCardRead } from "@/lib/types";

export function buildSearchParams(
  name: string,
  printed: PrintedNumber | string | null | undefined,
  lang: ScanLanguage = "en",
  limit?: number,
  game: GameId = "pokemon",
  art: ArtStyle = null,
  artOnly = false,
  firstEdition: boolean | null = null,
  cues: MtgCues | null = null,
  typed = false,
): URLSearchParams {
  const params = new URLSearchParams({ name, lang });
  if (game !== "pokemon") params.set("game", game);
  if (typed) params.set("typed", "1");
  if (art) params.set("art", art);
  if (cues) for (const [k, v] of Object.entries(mtgCuesToParams(cues))) params.set(k, v);
  if (artOnly) params.set("art_series", "1");
  if (firstEdition === true) params.set("first", "1");
  else if (firstEdition === false) params.set("first", "0");
  if (limit) params.set("limit", String(limit));

  if (typeof printed === "string") {
    if (printed) params.set("number", printed);
  } else if (printed) {
    if (printed.number) params.set("number", printed.number);
    if (printed.setTotal) params.set("setTotal", String(printed.setTotal));
    if (printed.setCode) params.set("setCode", printed.setCode);
    if (printed.setName) params.set("setName", printed.setName);
    if (printed.copyrightYear) params.set("year", String(printed.copyrightYear));
    if (printed.subtitle) params.set("sub", printed.subtitle);
    if (printed.variant) params.set("variant", printed.variant);
    if (printed.shaky) params.set("shaky", "1");
    // Pokémon big-print clues (10-30): only worth sending without a number, which is when the ranker uses them.
    if (!printed.number) {
      if (printed.hp) params.set("hp", String(printed.hp));
      if (printed.attacks?.length) params.set("atk", printed.attacks.slice(0, 4).join("|"));
      if (printed.dexNumber) params.set("dex", String(printed.dexNumber));
      if (printed.regulationMark) params.set("reg", printed.regulationMark);
    }
  }
  return params;
}

/** The printed key a scan read carries into the search (number, fraction, set clues, big-print clues); null when it has none. */
export function printedKeyFromRead(read: VisionCardRead, game: GameId): PrintedNumber | null {
  if (!readHasPrintedKey(read, game)) return null;
  return {
    number: read.cardNumber ?? "",
    setTotal: read.setTotal,
    setCode: read.setCode,
    isSecretRare: isSecretRareNumber(read.cardNumber ?? "", read.setTotal),
    setName: read.setName,
    copyrightYear: read.copyrightYear ?? null,
    subtitle: read.subtitle ?? null,
    variant: read.variant ?? null,
    // One Piece: the read stayed unsure after its close-up; the number may be a guess (lib/cardNumber.ts).
    shaky: read.secondLook === "low-confidence",
    hp: read.hp ?? null,
    attacks: read.attackNames ?? null,
    dexNumber: read.dexNumber ?? null,
    regulationMark: read.regulationMark ?? null,
  };
}
