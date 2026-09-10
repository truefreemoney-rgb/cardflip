import type { MtgBorder, MtgCues, MtgFinish, MtgMark, MtgTreatment, VisionCardRead } from "@/lib/types";

/**
 * The Magic printing cues travel scan → search as query params
 * (lib/cards.ts → /api/search-card → lib/server/mtgCards.ts). Shared here so
 * both ends agree on the names; every param is optional and a missing one
 * never costs a candidate anything (docs/MTG-IDENTIFICATION.md, phase 1).
 */

const FINISHES = new Set<string>(["nonfoil", "foil", "etched"]);
const TREATMENTS = new Set<string>(["standard", "showcase", "extended-art", "borderless", "retro", "full-art", "textless"]);
const MARKS = new Set<string>(["list-icon", "promo-stamp", "date-stamp", "serialized"]);
const BORDERS = new Set<string>(["black", "white", "silver", "gold", "borderless"]);

/** What the vision read carries, as cues. Null when it read none of them. */
export function mtgCuesOf(read: VisionCardRead): MtgCues | null {
  const cues: MtgCues = {
    finish: read.finish ?? null,
    treatment: read.treatment ?? null,
    marks: read.marks ?? [],
    artist: read.artist ?? null,
    copyrightYear: read.copyrightYear ?? null,
    border: read.borderColor ?? null,
    noYearLine: read.noYearLine === true,
    bevel: typeof read.bevel === "boolean" ? read.bevel : null,
  };
  const any =
    cues.finish || cues.treatment || (cues.marks?.length ?? 0) > 0 || cues.artist || cues.copyrightYear || cues.border || cues.noYearLine || cues.bevel !== null;
  return any ? cues : null;
}

export function mtgCuesToParams(cues: MtgCues): Record<string, string> {
  const out: Record<string, string> = {};
  if (cues.finish) out.finish = cues.finish;
  if (cues.treatment) out.treatment = cues.treatment;
  if (cues.marks && cues.marks.length) out.marks = cues.marks.join(",");
  if (cues.artist) out.artist = cues.artist.slice(0, 80);
  if (cues.copyrightYear) out.year = String(cues.copyrightYear);
  if (cues.border) out.border = cues.border;
  if (cues.noYearLine) out.noyear = "1";
  if (typeof cues.bevel === "boolean") out.bevel = cues.bevel ? "1" : "0";
  return out;
}

export function parseMtgCuesParams(params: URLSearchParams): MtgCues | null {
  const finish = params.get("finish");
  const treatment = params.get("treatment");
  const marks = (params.get("marks") ?? "").split(",").map((m) => m.trim()).filter((m) => MARKS.has(m)) as MtgMark[];
  const artist = (params.get("artist") ?? "").trim().slice(0, 80);
  const year = Number(params.get("year"));
  const border = params.get("border");
  const cues: MtgCues = {
    finish: finish && FINISHES.has(finish) ? (finish as MtgFinish) : null,
    treatment: treatment && TREATMENTS.has(treatment) ? (treatment as MtgTreatment) : null,
    marks: params.has("marks") ? marks : undefined,
    artist: artist || null,
    copyrightYear: Number.isInteger(year) && year >= 1993 && year <= 2100 ? year : null,
    border: border && BORDERS.has(border) ? (border as MtgBorder) : null,
    noYearLine: params.get("noyear") === "1",
    bevel: params.get("bevel") === "1" ? true : params.get("bevel") === "0" ? false : null,
  };
  const any =
    cues.finish || cues.treatment || cues.marks !== undefined || cues.artist || cues.copyrightYear || cues.border || cues.noYearLine || cues.bevel !== null;
  return any ? cues : null;
}
