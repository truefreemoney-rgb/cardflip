/**
 * Import from other apps (Tier 2 #12, 09-27): the pure half.
 *
 * Collectr, TCGplayer's collection manager, TCG Collector and the rest all
 * export a CSV of "what I own", each with its own header names. Rather than
 * three hard-coded formats, every column we care about has a list of the
 * names the apps use for it, and a file is readable when it carries at
 * least a card name (or a TCGplayer product id). Rows come back as one
 * normalised ImportRow each; the server half (lib/server/collectionImport.ts)
 * matches them to the catalog and prices them.
 *
 * Quantity is honoured by REPEATING the row: cards sell one per listing
 * (Chris, 09-27 — no quantity field), so "Charizard x3" is three cards.
 */

import { CONDITIONS } from "@/lib/listing";

export interface ImportRow {
  /** 1-based line in the file the row came from (for the review list). */
  line: number;
  name: string;
  setName: string | null;
  /** Collector number as written ("025/198", "TG03", "4"). */
  number: string | null;
  /** Our condition label; null = not given (treated as Near Mint). */
  condition: string | null;
  /** Printing words from the file ("Reverse Holofoil", "1st Edition Holofoil"), lowercased. */
  printing: string | null;
  firstEdition: boolean;
  quantity: number;
  /** TCGplayer product id when the file carries one. */
  tcgplayerId: number | null;
  /** What the seller paid, when the file says. */
  paid: number | null;
  /** The file's game/product line column, lowercased; null = not given. */
  game: string | null;
  language: string | null;
}

export interface ParsedImport {
  headers: string[];
  /** Which file column feeds each field (for the "we read these columns" line). */
  columns: Partial<Record<Field, string>>;
  rows: ImportRow[];
  /** Lines skipped and why (blank name, zero quantity). */
  skipped: { line: number; reason: string }[];
}

export type Field = "name" | "set" | "number" | "condition" | "printing" | "quantity" | "tcgplayerId" | "paid" | "game" | "language" | "rarity";

/**
 * Header aliases, lowercased and stripped of everything but letters/digits.
 * First match in the file wins per field; a header claimed by one field is
 * not offered to the next (TCGplayer's "Set Name" must not also be "Name").
 */
const ALIASES: Record<Field, string[]> = {
  tcgplayerId: ["tcgplayerid", "tcgplayerproductid", "productid", "tcgproductid", "tcgplayer", "tcgid"],
  set: ["setname", "set", "expansion", "expansionname", "group", "groupname", "setcode"],
  number: ["number", "cardnumber", "collectornumber", "collectorno", "no", "num", "cardno", "setnumber"],
  condition: ["condition", "cond", "grade"],
  printing: ["printing", "variant", "finish", "foil", "variance", "edition", "version", "holo"],
  quantity: ["quantity", "qty", "count", "owned", "amount", "copies", "total", "quantityowned", "normalqty", "qtyowned"],
  paid: ["purchaseprice", "paid", "pricepaid", "cost", "buyprice", "costbasis", "purchasecost", "boughtfor"],
  game: ["productline", "game", "category", "tcg", "gamename"],
  language: ["language", "lang"],
  rarity: ["rarity"],
  name: ["productname", "cardname", "name", "card", "title", "product", "simplename"],
};

const fold = (s: string) => s.toLowerCase().replace(/^﻿/, "").replace(/[^a-z0-9]/g, "");

/**
 * RFC 4180 with the field separator sniffed from the header line — Excel on
 * some locales writes semicolons, a "CSV" pasted from a sheet is tabs.
 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const sep = [",", "\t", ";"].map((c) => ({ c, n: firstLine.split(c).length })).sort((a, b) => b.n - a.n)[0].c;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Header → field map. Null when no name column can be found. */
export function detectColumns(headers: string[]): Record<Field, number | null> {
  const folded = headers.map(fold);
  const taken = new Set<number>();
  const out = {} as Record<Field, number | null>;
  for (const field of Object.keys(ALIASES) as Field[]) {
    let hit: number | null = null;
    for (const alias of ALIASES[field]) {
      const at = folded.findIndex((h, i) => h === alias && !taken.has(i));
      if (at >= 0) {
        hit = at;
        break;
      }
    }
    if (hit != null) taken.add(hit);
    out[field] = hit;
  }
  return out;
}

const CONDITION_ALIASES: Record<string, string> = {
  nm: "Near Mint",
  nearmint: "Near Mint",
  mint: "Near Mint",
  m: "Near Mint",
  nmm: "Near Mint",
  lp: "Lightly Played",
  lightlyplayed: "Lightly Played",
  lightplayed: "Lightly Played",
  slightlyplayed: "Lightly Played",
  excellent: "Lightly Played",
  ex: "Lightly Played",
  mp: "Moderately Played",
  moderatelyplayed: "Moderately Played",
  played: "Moderately Played",
  good: "Moderately Played",
  gd: "Moderately Played",
  hp: "Heavily Played",
  heavilyplayed: "Heavily Played",
  poor: "Heavily Played",
  dmg: "Damaged",
  damaged: "Damaged",
  d: "Damaged",
};

const PRINTING_WORDS = /\b(1st edition|first edition|unlimited|reverse holo(?:foil)?|holo(?:foil)?|non[- ]?holo|normal|foil|shadowless|pok[eé] ball pattern|master ball pattern|cosmos holo|illustration rare|full art)\b/gi;

/**
 * TCGplayer writes "Lightly Played Holofoil" in one column; Collectr splits
 * them. Either way: the condition words map to ours, the printing words go
 * to `printing`, and "1st Edition" anywhere sets the flag.
 */
export function splitCondition(raw: string | null | undefined): { condition: string | null; printing: string | null; firstEdition: boolean } {
  const text = (raw ?? "").trim();
  if (!text) return { condition: null, printing: null, firstEdition: false };
  const printings = (text.match(PRINTING_WORDS) ?? []).map((w) => w.toLowerCase());
  const rest = text.replace(PRINTING_WORDS, " ").replace(/\s+/g, " ").trim();
  const key = fold(rest);
  let condition: string | null = null;
  if (key) {
    condition = CONDITION_ALIASES[key] ?? (CONDITIONS as string[]).find((c) => fold(c) === key) ?? null;
  }
  const firstEdition = printings.some((p) => /^(1st|first) edition$/.test(p));
  const printing = printings.filter((p) => !/^(1st|first) edition$/.test(p)).join(" ") || null;
  return { condition, printing, firstEdition };
}

function num(v: string | undefined): number | null {
  if (!v) return null;
  const n = Number(v.replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export const MAX_QUANTITY = 50;

/** The whole file → normalised rows. Throws on a file with no usable columns. */
export function parseImport(text: string): ParsedImport {
  const table = parseCsv(text).filter((r) => r.some((c) => c !== ""));
  if (table.length === 0) throw new Error("The file is empty.");
  const headers = table[0];
  const cols = detectColumns(headers);
  if (cols.name == null && cols.tcgplayerId == null) {
    throw new Error("Couldn't find a card name column. The first line should be headers like Product Name, Set Name, Number, Condition, Quantity.");
  }
  const get = (r: string[], f: Field): string => (cols[f] == null ? "" : (r[cols[f] as number] ?? "").trim());
  const columns: Partial<Record<Field, string>> = {};
  for (const f of Object.keys(cols) as Field[]) if (cols[f] != null) columns[f] = headers[cols[f] as number];

  const rows: ImportRow[] = [];
  const skipped: ParsedImport["skipped"] = [];
  for (let i = 1; i < table.length; i++) {
    const r = table[i];
    const line = i + 1;
    const name = get(r, "name");
    const tcgplayerId = num(get(r, "tcgplayerId"));
    if (!name && tcgplayerId == null) {
      skipped.push({ line, reason: "No card name" });
      continue;
    }
    const qtyRaw = get(r, "quantity");
    const quantity = qtyRaw === "" ? 1 : Math.floor(num(qtyRaw) ?? 0);
    if (quantity <= 0) {
      skipped.push({ line, reason: "Quantity is 0" });
      continue;
    }
    const cond = splitCondition(get(r, "condition"));
    const print = splitCondition(get(r, "printing"));
    const printing = [cond.printing, print.printing].filter(Boolean).join(" ") || null;
    const lower = name.toLowerCase();
    rows.push({
      line,
      name,
      setName: get(r, "set") || null,
      number: get(r, "number") || null,
      condition: cond.condition ?? print.condition,
      printing,
      firstEdition: cond.firstEdition || print.firstEdition || /\b(1st|first) edition\b/i.test(lower),
      quantity: Math.min(quantity, MAX_QUANTITY),
      tcgplayerId: tcgplayerId != null && tcgplayerId > 0 ? Math.floor(tcgplayerId) : null,
      paid: num(get(r, "paid")),
      game: get(r, "game").toLowerCase() || null,
      language: get(r, "language").toLowerCase() || null,
    });
  }
  return { headers, columns, rows, skipped };
}

/**
 * Names carry the printing/number in some exports ("Charizard ex - 199/165",
 * "Pikachu (Reverse Holo)", "Charizard - Base Set (Shadowless)"): pull the
 * fraction out into the number when the file gave none, and drop bracketed
 * printing notes so the catalog name search sees the card's name only.
 */
export function cleanName(name: string, number: string | null): { name: string; number: string | null } {
  let n = name.replace(/\s+/g, " ").trim();
  let num = number;
  const frac = n.match(/\b(\d{1,3})\s*\/\s*(\d{1,3})\b/);
  if (frac) {
    if (!num) num = `${frac[1]}/${frac[2]}`;
    n = n.replace(frac[0], " ");
  } else if (!num) {
    const trailing = n.match(/\s[-#]\s*(\d{1,3}|[A-Z]{2,5}\d{1,3})$/);
    if (trailing) {
      num = trailing[1];
      n = n.slice(0, trailing.index);
    }
  }
  n = n
    .replace(/\((?:[^)]*(?:holo|foil|edition|shadowless|pattern|reverse|promo|normal|unlimited|cosmos|stamped)[^)]*)\)/gi, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\s*[-–—]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return { name: n, number: num };
}
