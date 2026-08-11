import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ScanLanguage, VisionCardRead } from "@/lib/types";

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
      "The collector number as printed, without the set total. From '199/165' return '199'. Null if not visible.",
    ),
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
    "language",
    "condition",
    "conditionNotes",
    "confidence",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You identify Pokémon trading cards from photos for a seller who is about to list them.

Read what is actually on the card. The name and collector number are what the
lookup keys on, so getting those exactly right matters more than filling in
every other field — return null rather than a guess for anything you cannot
actually see, and let confidence reflect that.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a
sleeve. Judge condition only from what the photo can actually support. Glare is
not a scratch and a sleeve is not damage; when the photo cannot settle it, say
so with a null rather than defaulting to Near Mint.`;

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
): Promise<VisionCardRead> {
  const response = await getClient().messages.create({
    model: "claude-opus-5",
    max_tokens: 2000,
    // Reading a card is perception, not deep reasoning, and this runs once per
    // photo in a batch — low effort keeps a stack of cards moving.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: CARD_READ_SCHEMA },
    },
    system: SYSTEM,
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
    name: parsed.name.trim(),
  };
}
