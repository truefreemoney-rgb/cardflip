/**
 * PriceCharting price guide (built 10-18, before the subscription: docs/PRICE-FALLBACK-PLAN.md,
 * memory "PriceCharting FINALE"). Their nightly CSV (Legendary plan, one download per category,
 * regenerated every 24 h, at most one CSV call per 10 minutes) has one row per product; column
 * names = the Prices API keys (pricecharting.com/api-documentation):
 *   id, console-name ("Pokemon Base Set"), product-name ("Charizard [1st Edition] #4"),
 *   loose-price (cards: UNGRADED, USD with two decimals in the CSV), graded-price (grade 9),
 *   manual-only-price (PSA 10), sales-volume (units sold in a year), tcg-id (TCGplayer product id),
 *   release-date.
 * The API returns prices as integer pennies instead; both are handled.
 * Pure: parsing only. Licence: internal use + Chris's display permission until $1,000/month
 * revenue; attribution = a text link to https://www.pricecharting.com/game/<id>. All stored data
 * must be purged if the subscription ends.
 */

export interface PcProduct {
  id: string;
  console: string;
  name: string;
  /** Ungraded price in USD, or null when PriceCharting has none. */
  loose: number | null;
  /** Grade 9 and PSA 10 prices in USD (null when absent). */
  graded9: number | null;
  psa10: number | null;
  /** Units sold in the last year (PriceCharting's "sales-volume"), 0 when absent. */
  salesVolume: number;
  /** TCGplayer product id, or null. */
  tcgId: string | null;
  releaseDate: string | null;
}

/** RFC 4180 CSV: commas, double-quoted fields with "" escapes, CRLF or LF rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

/** A CSV price cell ("$1,234.56", "1234.56", "") in USD, or null. */
export function csvUsd(cell: string | undefined): number | null {
  if (cell == null) return null;
  const v = Number(cell.replace(/[$,\s]/g, ""));
  return cell.trim() !== "" && Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

/** An API price (integer pennies) in USD, or null. */
export const apiUsd = (pennies: unknown): number | null => (typeof pennies === "number" && pennies > 0 ? Math.round(pennies) / 100 : null);

/** Every product of a price-guide CSV. Throws when the header lacks the columns we need. */
export function readPriceGuide(text: string): PcProduct[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const col = new Map(header.map((h, i) => [h.trim().toLowerCase(), i]));
  for (const need of ["id", "product-name", "loose-price"]) if (!col.has(need)) throw new Error(`PriceCharting CSV: no "${need}" column (got ${header.join(", ")})`);
  const get = (r: string[], k: string) => {
    const i = col.get(k);
    return i == null ? "" : (r[i] ?? "").trim();
  };
  const out: PcProduct[] = [];
  for (const r of rows) {
    const id = get(r, "id");
    if (!id) continue;
    const tcg = get(r, "tcg-id");
    out.push({
      id,
      console: get(r, "console-name"),
      name: get(r, "product-name"),
      loose: csvUsd(get(r, "loose-price")),
      graded9: csvUsd(get(r, "graded-price")),
      psa10: csvUsd(get(r, "manual-only-price")),
      salesVolume: Math.max(0, Math.round(Number(get(r, "sales-volume").replace(/,/g, "")) || 0)),
      tcgId: /^\d+$/.test(tcg) ? tcg : null,
      releaseDate: /^\d{4}-\d{2}-\d{2}$/.test(get(r, "release-date")) ? get(r, "release-date") : null,
    });
  }
  return out;
}

/** One /api/product response as a PcProduct (prices in pennies there). */
export function fromApi(j: Record<string, unknown>): PcProduct | null {
  if (j.status !== "success" || j.id == null) return null;
  const tcg = j["tcg-id"] == null ? "" : String(j["tcg-id"]);
  return {
    id: String(j.id),
    console: String(j["console-name"] ?? ""),
    name: String(j["product-name"] ?? ""),
    loose: apiUsd(j["loose-price"]),
    graded9: apiUsd(j["graded-price"]),
    psa10: apiUsd(j["manual-only-price"]),
    salesVolume: Math.max(0, Math.round(Number(j["sales-volume"]) || 0)),
    tcgId: /^\d+$/.test(tcg) ? tcg : null,
    releaseDate: typeof j["release-date"] === "string" ? (j["release-date"] as string) : null,
  };
}

export interface PcName {
  /** The card name without brackets or number ("Charizard"). */
  base: string;
  /** Bracketed tags, as written ("1st Edition", "Reverse Holo", "Poke Ball"). */
  tags: string[];
  /** The collector number after "#", or null. */
  number: string | null;
}

/** "Charizard [1st Edition] #4" -> { base: "Charizard", tags: ["1st Edition"], number: "4" }. */
export function parseProductName(name: string): PcName {
  const tags = [...name.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  const num = name.match(/#\s*([A-Za-z0-9-]+)\s*$/);
  const base = name
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/#\s*[A-Za-z0-9-]+\s*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  return { base, tags, number: num ? num[1] : null };
}

/** The product page PriceCharting asks us to link to (attribution). */
export const pcProductUrl = (id: string) => `https://www.pricecharting.com/game/${encodeURIComponent(id)}`;

/** Lower-case tags with spaces/dashes folded, for matching ("Reverse Holo" -> "reverseholo"). */
export const tagKey = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
