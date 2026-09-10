import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { GameId, ScanLanguage, VisionCardRead } from "@/lib/types";

export type { VisionCardRead };

/**
 * Reads a card photo with Claude's vision instead of OCR.
 *
 * Tesseract was the weak link in the scan pipeline, and measurably so on
 * Japanese and Chinese cards — "皮卡丘" came back as "反卡乒", one correct
 * character out of three, which is why CJK lookups need fuzzy matching at all.
 * A vision model reads the card the way a person does: it can use the artwork,
 * the set symbol, and the layout, not just the glyph shapes, and it can judge
 * condition from the same photo.
 *
 * Dormant without ANTHROPIC_API_KEY — the scanner falls back to OCR.
 */

export class VisionNotConfiguredError extends Error {
  constructor() {
    super("Anthropic API key is not configured");
    this.name = "VisionNotConfiguredError";
  }
}

export function isVisionConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * Nullable via `anyOf` rather than `type: ["string", "null"]` — the structured
 * outputs schema subset documents `anyOf` support explicitly, and the array
 * form of `type` isn't in it.
 */
function nullableString(description: string) {
  return {
    anyOf: [{ type: "string" }, { type: "null" }],
    description,
  } as const;
}

export const CARD_READ_SCHEMA = {
  type: "object",
  properties: {
    name: {
      type: "string",
      description:
        "The Pokémon/card name exactly as printed on the card, in the card's own script. Do not translate.",
    },
    englishName: nullableString(
      "The English species name when the card is Japanese or Chinese (e.g. ピカチュウ -> Pikachu). Null for English cards.",
    ),
    setName: nullableString(
      "The set or expansion name if identifiable, else null.",
    ),
    cardNumber: nullableString(
      "The collector number — the left half of the fraction at the bottom of the card, keeping any letter prefix. From '199/165' return '199'; from 'SV49/SV94' return 'SV49'; from 'TG12/TG30' return 'TG12'. Null if not visible.",
    ),
    setTotal: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description:
        "The right half of that fraction — the set's card count. From '199/165' return 165; a lettered denominator like 'SV94' or 'TG30' means 94 or 30. This identifies which expansion the card is from, so read it separately and carefully. Null if the card prints no denominator (promos often don't) or you cannot see it.",
    },
    setCode: nullableString(
      "The short expansion code printed near the collector number, e.g. 'SVI', 'PAF', 'BS'. This is NOT the language code ('EN'), the illustrator, or the regulation mark (a single letter in a black box). Null if not visible.",
    ),
    artStyle: {
      anyOf: [{ type: "string", enum: ["standard", "full-art"] }, { type: "null" }],
      description:
        "How the card is framed. 'standard': the illustration sits in a box in the upper half and the attacks/text sit on a plain panel below. 'full-art': the illustration covers the whole card and the text is printed over it (full art, illustration rare, special illustration rare, VMAX/VSTAR/ex full-art, gold/rainbow). Null if you can't tell.",
    },
    language: {
      type: "string",
      enum: ["en", "ja", "zh"],
      description: "The language the card is printed in.",
    },
    condition: {
      anyOf: [
        {
          type: "string",
          enum: [
            "Near Mint",
            "Lightly Played",
            "Moderately Played",
            "Heavily Played",
            "Damaged",
          ],
        },
        { type: "null" },
      ],
      description:
        "Condition judged from this photo. Null when the photo is too blurry, dark, or angled to judge.",
    },
    conditionNotes: nullableString(
      "One short sentence on what drove the condition call — visible edge whitening, off-centering, surface scratches, creases. Null when condition is null.",
    ),
    confidence: {
      type: "number",
      description:
        "0 to 1, how confident you are in the name and number specifically.",
    },
    kind: {
      anyOf: [{ type: "string", enum: ["card", "token", "art"] }, { type: "null" }],
      description:
        "What kind of object this is. 'token': the type line says Token (e.g. 'Token Creature — Hero'), or the number starts with T. 'art': an Art Series / art card — the illustration fills the whole card with only a name and artist credit along the bottom, no rules text, no mana cost or HP. 'card': a normal playable card. Null if unsure.",
    },
    firstEdition: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "Pokémon only. true when the card carries the '1st Edition' stamp: a small black circle containing a '1' with the word EDITION beneath it, printed just below-left of the artwork frame (Wizards of the Coast era, 1999–2002). false when the card is from that era and that spot is visible and clearly blank. Null for Magic cards, modern cards, or when that corner can't be seen.",
    },
  },
  required: [
    "name",
    "englishName",
    "setName",
    "cardNumber",
    "setTotal",
    "setCode",
    "artStyle",
    "language",
    "condition",
    "conditionNotes",
    "confidence",
    "kind",
    "firstEdition",
  ],
  additionalProperties: false,
} as const;

/**
 * The Magic read: everything in CARD_READ_SCHEMA plus the cues that pick a
 * PRINTING and a FINISH (docs/MTG-IDENTIFICATION.md, phase 1). A separate
 * schema so the Pokémon read is byte-for-byte what it was.
 */
export const MTG_READ_SCHEMA = {
  ...CARD_READ_SCHEMA,
  properties: {
    ...CARD_READ_SCHEMA.properties,
    finish: {
      anyOf: [{ type: "string", enum: ["nonfoil", "foil", "etched"] }, { type: "null" }],
      description:
        "The card's finish, read from the surface. 'foil': a rainbow / metallic sheen runs across the WHOLE face — art, text box and border alike — and shifts with the light. 'etched': the frame linework and art glitter like metallic paint while the face itself is matte. 'nonfoil': flat printed card. A single bright glare spot is reflection, not foil. The small oval holographic stamp at the bottom of rares is a security stamp on foils AND nonfoils — it says nothing about finish. Null when the photo cannot settle it; never default to nonfoil.",
    },
    treatment: {
      anyOf: [
        { type: "string", enum: ["standard", "showcase", "extended-art", "borderless", "retro", "full-art", "textless"] },
        { type: "null" },
      ],
      description:
        "The frame treatment. 'standard': the normal frame for its era, art in a window, black (or white) border. 'showcase': a set-specific decorative alternate frame (stylised borders, manga panels, scrolls, storybook, etc.). 'extended-art': normal frame but the art runs out to the card edges on the sides. 'borderless': art fills the whole card face with no frame around it. 'retro': the old 1990s-style frame (rounded inner bevel, old-style title bar) printed on a MODERN card that still carries a set code. 'full-art': a basic land or promo where the art fills the card and the text sits in a small strip. 'textless': no rules text. Null if unsure.",
    },
    marks: {
      type: "array",
      items: { type: "string", enum: ["list-icon", "promo-stamp", "date-stamp", "serialized"] },
      description:
        "Small printed marks that change which printing this is. 'list-icon': a small WHITE planeswalker symbol (a five-pointed flame shape) printed inside the black border at the very bottom-left corner of the card, to the left of / below the copyright line — the card otherwise looks exactly like its original printing (The List reprint). Look at that corner deliberately. 'promo-stamp': a planeswalker-symbol stamp in the bottom of the text box / art (Promo Pack). 'date-stamp': a small rectangular stamp with a date near the set symbol (prerelease). 'serialized': a large printed serial like '045/500' on the face. Empty array when none.",
    },
    artist: nullableString("The artist credit printed at the bottom-left (after the brush icon), exactly as printed. Null if unreadable."),
    copyrightYear: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description:
        "The LAST year in the copyright line along the bottom, e.g. '™ & © 1993–2023 Wizards of the Coast' → 2023; '© 2025 Wizards of the Coast' → 2025. This is the year the card was printed. Null if unreadable.",
    },
    borderColor: {
      anyOf: [{ type: "string", enum: ["black", "white", "silver", "gold", "borderless"] }, { type: "null" }],
      description:
        "The outer border colour. Modern cards are black; 1990s core sets and some 2000s cards are white; Un-sets are silver; a few promos gold; 'borderless' when the art runs to the edge with no border. Null if unsure.",
    },
    serialNumber: nullableString("The printed serial number when the card is serialized, e.g. '045/500'. Null otherwise."),
  },
  required: [...CARD_READ_SCHEMA.required, "finish", "treatment", "marks", "artist", "copyrightYear", "borderColor", "serialNumber"],
} as const;

export const SYSTEM = `You identify Pokémon trading cards from photos for a seller who is about to list them.

Read what is actually on the card. The name and the full collector fraction are
what the lookup keys on, so getting those exactly right matters more than
filling in every other field — return null rather than a guess for anything you
cannot actually see, and let confidence reflect that.

Both halves of the fraction matter, and they answer different questions. The
left half says which card this is; the right half says which set it came from,
and that is what separates an original from a reprint carrying the same name
and the same number — Charizard 4/102 is the 1999 Base Set card, Charizard
4/130 is the 2000 reprint worth roughly half. A number above the set total
(201/198) is a secret rare, which is normal and usually the valuable one. Read
the two halves independently rather than assuming a card is numbered within
its set.

Early Wizards of the Coast cards (Base Set through Neo Destiny, 1999–2002) may
carry a small black "1st Edition" stamp — a circled 1 with EDITION under it —
just below-left of the artwork. Report it in firstEdition: a stamped copy is a
separate product worth many times the unlimited print, so only say true when
you can actually see the stamp, and false when that spot is visible and blank.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a
sleeve. Judge condition only from what the photo can actually support. Glare is
not a scratch and a sleeve is not damage; when the photo cannot settle it, say
so with a null rather than defaulting to Near Mint.

If more than one card is visible (a binder page, a spread on a table), read the
largest or most central one, and cap confidence at 0.5. Read the name from the
printed name band, never from the artwork — two blue whale Pokémon are
different cards. When the name band is angled, blurry, or cut off, keep
confidence under 0.5.`;

export const SYSTEM_MTG = `You identify Magic: The Gathering cards from photos for a seller who is about to list them.

Read what is actually on the card. The lookup keys on three things printed on
every modern card: the name (top-left of the frame), the collector number and
the set code — both in the bottom-left corner in small type, e.g.
"0187/0281 R  LTR • EN" or on older cards "187/281" with the set code on the
next line, or just "187" on very old cards. Return the collector number as
printed without leading zeros ("187"; keep suffix letters like "187a" or the ★),
the denominator as setTotal when printed, and the 3–5 character set code
("LTR", "MH2", "2X2", "PLST") as setCode. The set code is NOT the language
code ("EN"), NOT the rarity letter (C/U/R/M) that sits between number and code,
and NOT the artist credit. Put the full name in "name" exactly as printed; for a
double-faced or adventure card use the front/main name. Leave englishName null.
setName is optional — the set code is what identifies the printing.

Two things that are not playable cards come out of the same packs and must
be called out in "kind": tokens (type line "Token Creature — …", collector
number starting with T) and Art Series cards (the illustration fills the
card, just a name and artist credit along the bottom, no rules text — the
set code printed on them starts with A, e.g. "AFIN"). Read the name and
number off those exactly as printed too.

artStyle: "standard" for the regular card frame (any era, old border included);
"full-art" only for special treatments — borderless, showcase, extended-art,
Mystical Archive-style alternate frames. Most cards are "standard".

The same name is printed in dozens of sets, so the seller's price depends on
the fields that tell printings apart. Read each one from the card itself:
- finish: foil shows as a rainbow / metallic sheen across the WHOLE face (art,
  text box, border). A single bright patch is glare from the lamp, not foil.
  Etched foil: metallic glitter in the frame linework, matte face. The oval
  holographic stamp at the bottom of rares is on foils and nonfoils alike — it
  is not a foil signal. Null when you cannot tell; do not default to nonfoil.
- treatment: standard / showcase / extended-art / borderless / retro /
  full-art / textless, as defined in the schema. Most cards are standard.
- marks: look at the very bottom-left corner of the black border: a small
  white planeswalker symbol there means The List (the card otherwise looks
  exactly like its original printing). Also: the Promo Pack planeswalker
  stamp in the text box; a prerelease date stamp near the set symbol; a
  printed serial number like 045/500.
- artist: the credit after the brush icon, bottom-left, exactly as printed.
- copyrightYear: the last year of the copyright line (© 1993–2023 → 2023).
- borderColor: black on modern cards; white on 1990s and some 2000s cards.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a
sleeve. Judge condition only from what the photo can actually support. Glare is
not a scratch and a sleeve is not damage; when the photo cannot settle it, say
so with a null rather than defaulting to Near Mint. Foil treatment is not a
condition issue.`;

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) throw new VisionNotConfiguredError();
  client ??= new Anthropic();
  return client;
}

type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

function normalizeMediaType(value: string): ImageMediaType {
  if (value === "image/png" || value === "image/webp" || value === "image/gif") {
    return value;
  }
  return "image/jpeg";
}

/**
 * `languageHint` is what the seller picked in the UI. It's a hint, not a
 * constraint — the photo is the authority, since sellers sort a stack wrong.
 */
/** The model every scan runs on — exported so the usage ledger prices by it. */
export const VISION_MODEL = "claude-sonnet-5";

/** Anthropic's token bill for one call, as the API reported it. */
export interface VisionUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export async function analyzeCardImage(
  base64Image: string,
  mediaType: string,
  languageHint: ScanLanguage,
  game: GameId = "pokemon",
): Promise<VisionCardRead> {
  return (await analyzeCardImageWithUsage(base64Image, mediaType, languageHint, game)).read;
}

const MTG_FINISHES = new Set(["nonfoil", "foil", "etched"]);
const MTG_TREATMENTS = new Set(["standard", "showcase", "extended-art", "borderless", "retro", "full-art", "textless"]);
const MTG_MARKS = new Set(["list-icon", "promo-stamp", "date-stamp", "serialized"]);
const MTG_BORDERS = new Set(["black", "white", "silver", "gold", "borderless"]);

/** Schema-constrained already; this only trims strings and drops anything
 * outside the enums so downstream never sees a surprise value. */
function normalizeMtgCues(parsed: VisionCardRead): Partial<VisionCardRead> {
  const year = typeof parsed.copyrightYear === "number" ? Math.trunc(parsed.copyrightYear) : null;
  const treatment = parsed.treatment && MTG_TREATMENTS.has(parsed.treatment) ? parsed.treatment : null;
  return {
    finish: parsed.finish && MTG_FINISHES.has(parsed.finish) ? parsed.finish : null,
    treatment,
    marks: Array.isArray(parsed.marks) ? parsed.marks.filter((m) => MTG_MARKS.has(m)) : [],
    artist: parsed.artist?.trim() || null,
    copyrightYear: year != null && year >= 1993 && year <= 2100 ? year : null,
    borderColor: parsed.borderColor && MTG_BORDERS.has(parsed.borderColor) ? parsed.borderColor : null,
    serialNumber: parsed.serialNumber?.trim() || null,
    // The older binary read is derived so every artStyle consumer keeps
    // working: any special frame is "full-art" to the ranker's special-set gate.
    artStyle:
      treatment === "standard"
        ? "standard"
        : treatment
          ? "full-art"
          : parsed.artStyle === "standard" || parsed.artStyle === "full-art"
            ? parsed.artStyle
            : null,
  };
}

/** Same read, plus the usage the scan route records to scan_usage. */
export async function analyzeCardImageWithUsage(
  base64Image: string,
  mediaType: string,
  languageHint: ScanLanguage,
  game: GameId = "pokemon",
): Promise<{ read: VisionCardRead; usage: VisionUsage }> {
  const response = await getClient().messages.create({
    // Sonnet 5, was Opus 5 (09-02 A/B, all 64 prod photos, ab-vision.mjs →
    // backups/ab-vision-0902.json): identification IDENTICAL (name 64/64,
    // number 59/64 on both) at 2.5x cheaper ($0.011 vs $0.028/scan) — the
    // difference between a maxed 500-scan subscriber losing money and ~47%
    // margin. Tradeoff: Sonnet abstains on photo-judged condition more often
    // (34/64 vs 60/64), so sellers pick condition manually more — fine, a
    // photo-guessed condition was always soft.
    model: VISION_MODEL,
    max_tokens: 2000,
    // Reading a card is perception, not deep reasoning, and this runs once per
    // photo in a batch — low effort keeps a stack of cards moving.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: game === "mtg" ? MTG_READ_SCHEMA : CARD_READ_SCHEMA },
    },
    system: game === "mtg" ? SYSTEM_MTG : SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: normalizeMediaType(mediaType),
              data: base64Image,
            },
          },
          {
            type: "text",
            text: `Identify this card. The seller believes it is ${
              languageHint === "en"
                ? "English"
                : languageHint === "ja"
                  ? "Japanese"
                  : "Chinese"
            }, but trust the photo over that if they disagree.`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("Vision request was declined");
  }

  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") {
    throw new Error("Vision response contained no readable result");
  }

  const parsed = JSON.parse(text.text) as VisionCardRead;
  const read: VisionCardRead = {
    ...parsed,
    // Schema-constrained, but the number still reaches a regex downstream.
    cardNumber: parsed.cardNumber?.trim() || null,
    setTotal: typeof parsed.setTotal === "number" ? parsed.setTotal : null,
    setCode: parsed.setCode?.trim().toUpperCase() || null,
    artStyle: parsed.artStyle === "standard" || parsed.artStyle === "full-art" ? parsed.artStyle : null,
    kind: parsed.kind === "token" || parsed.kind === "art" || parsed.kind === "card" ? parsed.kind : null,
    firstEdition: typeof parsed.firstEdition === "boolean" ? parsed.firstEdition : null,
    name: parsed.name.trim(),
    ...(game === "mtg" ? normalizeMtgCues(parsed) : {}),
  };
  const u = response.usage;
  return {
    read,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}
