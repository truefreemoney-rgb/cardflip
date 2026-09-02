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

const CARD_READ_SCHEMA = {
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
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You identify Pokémon trading cards from photos for a seller who is about to list them.

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

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a
sleeve. Judge condition only from what the photo can actually support. Glare is
not a scratch and a sleeve is not damage; when the photo cannot settle it, say
so with a null rather than defaulting to Near Mint.`;

const SYSTEM_MTG = `You identify Magic: The Gathering cards from photos for a seller who is about to list them.

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
export async function analyzeCardImage(
  base64Image: string,
  mediaType: string,
  languageHint: ScanLanguage,
  game: GameId = "pokemon",
): Promise<VisionCardRead> {
  const response = await getClient().messages.create({
    // Sonnet 5, was Opus 5 (09-02 A/B, all 64 prod photos, ab-vision.mjs →
    // backups/ab-vision-0902.json): identification IDENTICAL (name 64/64,
    // number 59/64 on both) at 2.5x cheaper ($0.011 vs $0.028/scan) — the
    // difference between a maxed 500-scan subscriber losing money and ~47%
    // margin. Tradeoff: Sonnet abstains on photo-judged condition more often
    // (34/64 vs 60/64), so sellers pick condition manually more — fine, a
    // photo-guessed condition was always soft.
    model: "claude-sonnet-5",
    max_tokens: 2000,
    // Reading a card is perception, not deep reasoning, and this runs once per
    // photo in a batch — low effort keeps a stack of cards moving.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: CARD_READ_SCHEMA },
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
  return {
    ...parsed,
    // Schema-constrained, but the number still reaches a regex downstream.
    cardNumber: parsed.cardNumber?.trim() || null,
    setTotal: typeof parsed.setTotal === "number" ? parsed.setTotal : null,
    setCode: parsed.setCode?.trim().toUpperCase() || null,
    artStyle: parsed.artStyle === "standard" || parsed.artStyle === "full-art" ? parsed.artStyle : null,
    name: parsed.name.trim(),
  };
}
