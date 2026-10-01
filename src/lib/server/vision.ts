import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { GameId, ScanLanguage, VisionCardRead, WearLevel } from "@/lib/types";
import { parseAttractionLights } from "@/lib/mtgCues";
import { isGameId } from "@/lib/games";

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

/** What the read can say the card is: every scannable game, plus the ones we don't scan yet. */
export const DETECTED_GAMES = ["pokemon", "mtg", "lorcana", "onepiece", "yugioh", "other"] as const;

export const CARD_READ_SCHEMA = {
  type: "object",
  properties: {
    // 09-29 (Chris: beta testers scanned Magic with the switch on Pokémon):
    // the read names the game it sees, and a mismatch re-reads as that game.
    cardGame: {
      type: "string",
      enum: [...DETECTED_GAMES],
      description:
        "Which trading card game this card is from, judged from the card itself: 'pokemon' (Pokémon TCG), 'mtg' (Magic: The Gathering), 'lorcana' (Disney Lorcana), 'onepiece' (One Piece Card Game), 'yugioh' (Yu-Gi-Oh!), 'other' for any other game or no card at all.",
    },
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
      "One short plain sentence, for the seller, on what drove the condition call — e.g. 'Light whitening on the bottom edge, corners sharp, surface clean.' Name the spot when you can see it. Null when condition is null.",
    ),
    corners: {
      anyOf: [{ type: "string", enum: ["clean", "light wear", "worn"] }, { type: "null" }],
      description:
        "The four corners. 'clean': sharp, no whitening. 'light wear': a touch of whitening or softening on one or two corners. 'worn': visible rounding, fraying or whitening on several corners. Null when the corners can't be seen.",
    },
    edges: {
      anyOf: [{ type: "string", enum: ["clean", "light wear", "worn"] }, { type: "null" }],
      description:
        "The four edges. 'clean': no whitening or chipping. 'light wear': a few small white flecks or a short whitened stretch. 'worn': whitening or chipping along a whole edge or more. Null when the edges can't be seen.",
    },
    surface: {
      anyOf: [{ type: "string", enum: ["clean", "light wear", "worn"] }, { type: "null" }],
      description:
        "The face of the card. 'clean': no scratches, dents, creases or print lines. 'light wear': faint scratches or scuffs visible only in the light. 'worn': obvious scratches, dents, creases, stains or peeling. A glare spot or reflection is not wear. Null when glare or blur hides the surface.",
    },
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
    slab: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "true when the card is sealed inside a graded slab: a rigid clear plastic holder with a printed grading label across the top (PSA, CGC, BGS, SGC, ACE and the like, showing a company name, a grade number and a cert number). Only true when you can actually see that printed grading label. false for a raw card, sleeved or not, and for a card in a toploader, card saver, or one-touch magnetic holder (rigid plastic with NO grading label). false or null when the photo is too blurry or cropped to see a label.",
    },
    firstEdition: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "Pokémon only. true when the card carries the '1st Edition' stamp: a small black circle containing a '1' with the word EDITION beneath it, printed just below-left of the artwork frame (Wizards of the Coast era, 1999–2002). false when the card is from that era and that spot is visible and clearly blank. Null for Magic cards, modern cards, or when that corner can't be seen.",
    },
    copyrightYear: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description:
        "The LAST year in the copyright line printed along the bottom edge of the card, e.g. '©2016 Pokémon' → 2016; '©1995, 96, 98, 99 Nintendo' → 1999; '™ & © 1993–2023 Wizards of the Coast' → 2023. This is the year the card was printed and it separates a card from its later reprint with the same name and number. Null if unreadable.",
    },
  },
  required: [
    "cardGame",
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
    "corners",
    "edges",
    "surface",
    "confidence",
    "kind",
    "slab",
    "firstEdition",
    "copyrightYear",
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
    // 09-29: the API caps a schema at 16 nullable / union-typed fields; the
    // base read already uses 15, so every Magic-only field below is a plain
    // string or an enum with an explicit "unknown" value, never anyOf-null.
    // normalizeMtgCues maps "" and "unknown" to null, so nothing downstream
    // changes. Pinned by test:vision-schema.
    finish: {
      type: "string",
      enum: ["nonfoil", "foil", "etched", "unknown"],
      description:
        "The card's finish, read from the surface. 'foil': a rainbow / metallic sheen runs across the WHOLE face — art, text box and border alike — and shifts with the light. 'etched': the frame linework and art glitter like metallic paint while the face itself is matte. 'nonfoil': flat printed card. A single bright glare spot is reflection, not foil. The small oval holographic stamp at the bottom of rares is a security stamp on foils AND nonfoils — it says nothing about finish. 'unknown' when the photo cannot settle it; never default to nonfoil.",
    },
    treatment: {
      type: "string",
      enum: ["standard", "showcase", "extended-art", "borderless", "retro", "full-art", "textless", "unknown"],
      description:
        "The frame treatment. 'standard': the normal frame for its era, art in a window, black (or white) border. 'showcase': a set-specific decorative alternate frame (stylised borders, manga panels, scrolls, storybook, etc.). 'extended-art': normal frame but the art runs out to the card edges on the sides. 'borderless': art fills the whole card face with no frame around it. 'retro': the old 1990s-style frame (rounded inner bevel, old-style title bar) printed on a MODERN card that still carries a set code. 'full-art': a basic land or promo where the art fills the card and the text sits in a small strip. 'textless': no rules text. 'unknown' if unsure.",
    },
    marks: {
      type: "array",
      items: { type: "string", enum: ["list-icon", "promo-stamp", "date-stamp", "serialized", "embossed"] },
      description:
        "Small printed marks that change which printing this is. 'list-icon': a small WHITE planeswalker symbol (a five-pointed flame shape) printed inside the black border at the very bottom-left corner of the card, to the left of / below the copyright line — the card otherwise looks exactly like its original printing (The List reprint). Look at that corner deliberately. 'promo-stamp': a planeswalker-symbol stamp in the bottom of the text box / art (Promo Pack). 'date-stamp': a small rectangular stamp with a date near the set symbol (prerelease). 'serialized': a large printed serial like '045/500' on the face. 'embossed': a large faint raised/embossed symbol (e.g. the D&D ampersand '&') pressed across the whole card face, over art and text box alike — an in-store promo; not the small set symbol. Empty array when none.",
    },
    artist: {
      type: "string",
      description: "The artist credit printed at the bottom-left (after the brush icon), exactly as printed. An empty string if unreadable.",
    },
    borderColor: {
      type: "string",
      enum: ["black", "white", "silver", "gold", "borderless", "unknown"],
      description:
        "The outer border colour. Modern cards are black; 1990s core sets and some 2000s cards are white; Un-sets are silver; a few promos gold; 'borderless' when the art runs to the edge with no border. 'unknown' if unsure.",
    },
    serialNumber: {
      type: "string",
      description: "The printed serial number when the card is serialized, e.g. '045/500'. An empty string otherwise.",
    },
    attractionLights: {
      type: "array",
      items: { type: "integer" },
      description:
        "Unfinity 'Attraction' cards only (type line says Attraction): the column of numbers 1-6 down the right edge — list ONLY the numbers that are lit / highlighted, e.g. [2, 5, 6]. Empty array on every other card.",
    },
  },
  required: [...CARD_READ_SCHEMA.required, "finish", "treatment", "marks", "artist", "borderColor", "serialNumber", "attractionLights"],
} as const;

/**
 * The Lorcana / One Piece read (09-10, docs/NEW-GAMES.md): everything in
 * CARD_READ_SCHEMA plus the version line under a Lorcana name and the
 * printing variant that picks the price line in both games.
 */
export const TCG_VARIANTS = new Set(["standard", "parallel", "enchanted", "alt-art", "manga", "box-topper", "full-art", "special", "reprint"]);

export const TCG_READ_SCHEMA = {
  ...CARD_READ_SCHEMA,
  properties: {
    ...CARD_READ_SCHEMA.properties,
    // Plain string / "unknown" enum for the same 16-union API cap as the
    // Magic schema above; the parse maps "" and "unknown" to null.
    subtitle: {
      type: "string",
      description:
        "Disney Lorcana only: the version line printed in smaller type directly under the character name (e.g. 'On Human Legs', 'Spectacular Singer'). An empty string for One Piece and when there is none.",
    },
    variant: {
      type: "string",
      enum: ["standard", "parallel", "enchanted", "alt-art", "manga", "box-topper", "full-art", "special", "unknown"],
      description:
        "The printing. 'standard': the normal card frame with the art in its box. Lorcana: 'enchanted' when the illustration fills the whole card with a shimmering border-to-border treatment and the number is above the set total (e.g. 205/204). One Piece: 'parallel' (alternate art) when the illustration extends past the usual art box or is a different picture from the normal print, 'manga' for a manga-panel style illustration, 'box-topper' for the box-topper stamp, 'full-art' for a borderless full-art print. 'unknown' if unsure.",
    },
  },
  required: [...CARD_READ_SCHEMA.required, "subtitle", "variant"],
} as const;

export const SYSTEM_LORCANA = `You identify Disney Lorcana trading cards from photos for a seller who is about to list them.

Read what is actually on the card. The lookup keys on the name, the version line under it, and the collector fraction, so those matter most — return null rather than a guess for anything you cannot actually see, and let confidence reflect that.

The name is the large text in the name band; the version is the smaller line right under it ("Ariel - On Human Legs" is name "Ariel", subtitle "On Human Legs") — report the two separately, never joined. The collector number is printed bottom-left as a fraction like "42/204" followed by a dot and the set number ("· 1"): cardNumber is the left half, setTotal the right half, setCode the set number after the dot. Enchanted cards fill the whole face with art and carry a number ABOVE the set total (205/204 and up); report variant "enchanted" for those. Foil is a finish, not a different card — ignore shine.

The copyright line along the bottom prints a year ("©Disney" with a year on the right); report the last year you can read in copyrightYear.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a sleeve. Judge condition only from what the photo can actually support. If more than one card is visible, read the largest or most central one and cap confidence at 0.5.`;

export const SYSTEM_ONEPIECE = `You identify One Piece Card Game cards from photos for a seller who is about to list them.

Read what is actually on the card. The lookup keys on the card id printed small in the bottom-right corner, just left of the rarity letter — "OP01-077", "ST01-001", "EB01-005", "PRB01-002", promos "P-055" — so read it exactly: letters, digits, hyphen. Put the whole id in cardNumber (e.g. "OP01-077"); put the part before the hyphen in setCode (e.g. "OP01"); setTotal is null (One Piece prints no denominator). The name is the large text in the name band; subtitle is an empty string for this game.

Alternate-art printings share the same id and are told apart only by the picture: report variant "parallel" when the illustration extends beyond the normal art box or is clearly a different illustration from the standard print, "manga" for a manga-panel style illustration, "box-topper" when a box-topper stamp is present, "full-art" for a borderless full-art print, "standard" for the normal framed print. "unknown" if unsure. The rarity letters near the id (C, UC, R, SR, SEC, L) are not the variant.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a sleeve. Judge condition only from what the photo can actually support. If more than one card is visible, read the largest or most central one and cap confidence at 0.5.`;

/**
 * Yu-Gi-Oh! (09-29): the rarity rides in `variant` (one set code can be an
 * Ultra and a Quarter Century Secret, different price lines told apart by the
 * foil); the 1st Edition stamp in `firstEdition`. Slugs match
 * tcgCards.ts raritySlug of the TCGplayer rarity names.
 */
export const YUGIOH_RARITIES = [
  "common", "rare", "super-rare", "ultra-rare", "secret-rare", "ultimate-rare", "ghost-rare", "starlight-rare",
  "quarter-century-secret-rare", "platinum-secret-rare", "prismatic-secret-rare", "collectors-rare", "gold-rare", "starfoil-rare", "mosaic-rare",
  "shatterfoil-rare", "duel-terminal", "premium-gold-rare", "gold-secret-rare",
  // Colored-name Ultra Rares (Legendary Duelists / Duelist Saga reprints): the ranker splits the color off (tcgCards searchYugioh).
  "ultra-rare-blue", "ultra-rare-green", "ultra-rare-purple", "ultra-rare-red", "ultra-rare-bronze", "ultra-rare-silver",
] as const;

export const YUGIOH_READ_SCHEMA = {
  ...CARD_READ_SCHEMA,
  properties: {
    ...CARD_READ_SCHEMA.properties,
    firstEdition: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "true when the words '1st Edition' are printed just below the artwork on the left side, false when that spot is visible and blank or says 'LIMITED EDITION'. Null when it can't be seen.",
    },
    variant: {
      type: "string",
      enum: [...YUGIOH_RARITIES, "unknown"],
      description: "The rarity, judged from the foil on the name and the artwork (see the instructions). 'unknown' if the photo can't show it.",
    },
  },
  required: [...CARD_READ_SCHEMA.required, "variant"],
} as const;

export const SYSTEM_YUGIOH = `You identify Yu-Gi-Oh! trading cards from photos for a seller who is about to list them.

Read what is actually on the card. The lookup keys on the set code, so read it exactly — return null rather than a guess for anything you cannot actually see, and let confidence reflect that.

Where things are printed:
- The card name is in the name bar across the top. Report it exactly as printed ("Blue-Eyes White Dragon", hyphens included). No attribute icon, no level stars.
- The set code is printed directly under the artwork on the RIGHT side: letters/digits, a hyphen, a language code, a number — "LOB-EN001", "RA01-EN052", "MP23-EN045". The very first print runs have no language code ("LOB-001", "SDY-006"). Put the whole code in cardNumber exactly as printed, the part before the hyphen in setCode (e.g. "LOB"); setTotal is null (Yu-Gi-Oh! prints no denominator).
- The 8-digit number in the bottom-left corner is the card's passcode, NOT the set code. Never report it as cardNumber.
- "1st Edition" is printed under the artwork on the LEFT side, opposite the set code. Report it in firstEdition: true when you see those words, false when that spot is visible and blank or says "LIMITED EDITION". It matters: a 1st Edition copy can sell for many times the Unlimited one.

Rarity (variant) — judge from the foil, since the same set code can come in several rarities:
- First look at the FRAME (the card's outer border and the box around the art), before the name or the art. A GOLD frame is a gold-rare / premium-gold-rare / gold-secret-rare, never secret-rare, whatever the art does. A frame covered in small dots, stars or sparkle is a whole-card foil: starfoil, shatterfoil, mosaic, starlight or duel-terminal (Duel Terminal and Hidden Arsenal sets: DT01–DT07, DTP1, HAC1 — dots over the frame, art and text box). Pick one of those before any of the name/art rarities below; only a plain-coloured frame goes on to the name/art rules.
- common: name in plain black or white ink, artwork not foil.
- rare: name in silver foil, artwork not foil.
- super-rare: name in plain ink, artwork holographic with a smooth, even shine (no visible grain).
- ultra-rare: name in gold foil AND artwork holographic.
- ultra-rare-blue / -green / -purple / -red / -bronze / -silver: an Ultra Rare whose name foil is that colour instead of gold (Legendary Duelists, Duelist Saga, Dragons of Legend reprints). Look at the name's colour before answering ultra-rare or super-rare.
- secret-rare: artwork covered in a fine GRAINY sparkle (tiny glitter points in diagonal lines, visible even in a flat scan), name in silver/rainbow foil that can look almost plain in a scan. Grainy sparkle on the art = secret, not super, even when the name looks plain.
- ultimate-rare: artwork, card frame edges and attribute/level icons are embossed (raised, textured) and the name is gold.
- ghost-rare: artwork is a pale, washed-out, silvery hologram (the picture looks ghostly), silver name.
- starlight-rare: the WHOLE card — frame, text box and art — is covered in a rainbow sparkling foil with raised lines.
- quarter-century-secret-rare: a secret-rare sparkle that is much denser and darker, with the frame around the art and the name bar also glittering (the card looks dark and speckled all over), and a gold "25th" stamp in the bottom-right corner. A plain-coloured frame with sparkle only in the art = secret-rare.
- platinum-secret-rare: name in a cool silver-white platinum foil, artwork with a secret-rare pattern.
- prismatic-secret-rare: artwork with a strong textured prism/glitter pattern, rainbow name.
- collectors-rare: the artwork carries a fine textured foil that follows the drawing's lines, rainbow name.
- gold-rare: gold card border and gold name, gold foil in the art.
- premium-gold-rare: like gold-rare but the gold frame and art are covered in a coarse gold glitter (Maximum Gold, Premium Gold sets: MAGO, MGED, PGL3).
- gold-secret-rare: gold border and name with a secret-rare diagonal sparkle in the art (Premium Gold PGLD / PGL2).
Gold foils decide the set: a gold card is almost never a plain booster printing, so read its set code carefully (MAGO-EN046, MGED-EN026, PGL2-EN024).
- starfoil-rare: the whole face has a glittery star/confetti foil pattern (often older tins and Battle Packs).
- mosaic-rare: the whole face has a foil made of small square/triangular tiles.
- shatterfoil-rare: the whole face, frame included, has a cracked-glass foil of large irregular shards (Battle Pack 3 and later tins); starfoil is small round dots/stars instead.
- duel-terminal: "DUEL TERMINAL" is printed under the artwork on the left (where 1st Edition would be) and the whole card has a fine sparkling parallel foil. Set codes are DT01–DT07, DTP1, HAC1 and the like — read the small code carefully, it is not the passcode.
- unknown: glare or a sleeve hides the foil.

Photos are phone snapshots: angled, glare, uneven light, sometimes still in a sleeve. Glare can hide foil or fake it on a plain card — if the name ink is unclear, lower confidence rather than guess a rare. Judge condition only from what the photo can actually support. If more than one card is visible, read the largest or most central one and cap confidence at 0.5.`;

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

Some numbers carry letters: Trainer Gallery and Galarian Gallery cards print
"TG01/TG30" or "GG16/GG70", Shiny Vault prints "SV49/SV94", Radiant
Collection "RC10/RC25", promos "SWSH001" or "SVP 212" with no denominator.
Keep the letters with the number (cardNumber "TG01", setTotal 30); Shining
cards print "SH1/SH12" (letters S-H, not S-N). Read the fraction from the
small print in the bottom corner, never from the HP or the attack damage.
Diamond & Pearl era cards also print a code like "DPBP#307" next to the
Pokédex data — that is a database code, never the collector number.

Every card prints a copyright line along the bottom edge ("©2016 Pokémon",
"©1995, 96, 98, 99 Nintendo/Creatures/GAME FREAK"). Its last year is the
print year — the one thing that separates a 2003 card from its 2008 reprint
with the same name and number. Report it in copyrightYear when you can read
it.

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

If the card sits inside a graded slab (a rigid plastic holder with a grading
label across the top: PSA, CGC, BGS, SGC, ACE), say so in "slab" and still
read the card underneath as usual. A toploader, card saver or magnetic
one-touch holder is NOT a slab: no printed grading label means slab is false.

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
- marks: The List reprints look exactly like the original printing except
  for one tiny white planeswalker symbol (a five-pointed emblem) printed on
  the black border in the very bottom-left corner, level with or just below
  the collector-number line — smaller than the set symbol and easy to miss,
  so look there deliberately at full zoom before answering; it is NOT the set
  symbol and NOT the artist brush icon. Also: the Promo Pack planeswalker
  stamp in the text box; a prerelease date stamp near the set symbol; a
  printed serial number like 045/500.
- artist: the credit after the brush icon, bottom-left, exactly as printed.
- copyrightYear: the last year of the copyright line (© 1993–2023 → 2023).
  The earliest cards (Alpha, Beta, Unlimited, Revised and expansions up to
  1995) print only "Illus. © Artist" with NO year — return null for those,
  do not invent 1993. From 4th Edition (1995) on there is a second small
  line "© 1995 Wizards of the Coast, Inc." — read that year exactly.
- borderColor: the colour of the outermost edge of the card, the strip
  OUTSIDE the coloured frame, the part a sleeve would cover first. Black on
  Alpha, Beta and every modern card; white on Unlimited, Revised, 4th–9th
  Edition and most 1990s–2000s cards. Judge the very edge, never the inner
  frame or the text box.

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

// ---------------------------------------------------------------------------
// Binder page: where are the cards? One cheap call finds every card in a
// photo of a 9-pocket page (or a spread on the table) and returns its box as
// fractions of the image; the browser crops each card out of the full-size
// photo and sends it through the ordinary single-card read. The locate call
// itself is not a scan on the seller's allowance — each card found is.
// ---------------------------------------------------------------------------

export const LOCATE_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      description: "One entry per trading card whose face is visible, in reading order (top row left to right, then the next row). Empty when the photo shows no cards.",
      items: {
        type: "object",
        properties: {
          x: { type: "number", description: "Left edge of the card as a fraction of the image width, 0 to 1." },
          y: { type: "number", description: "Top edge of the card as a fraction of the image height, 0 to 1." },
          w: { type: "number", description: "Card width as a fraction of the image width." },
          h: { type: "number", description: "Card height as a fraction of the image height." },
        },
        required: ["x", "y", "w", "h"],
        additionalProperties: false,
      },
    },
  },
  required: ["cards"],
  additionalProperties: false,
} as const;

const SYSTEM_LOCATE = `You find trading cards in a photo for a seller's scanner. The photo shows a binder page, a toploader stack, or cards laid out on a table. Return one tight bounding box per card whose front is visible, as fractions of the image (x, y = top-left corner; w, h = size). Include cards inside plastic pockets or sleeves. Skip empty pockets, the backs of cards, and anything that is not a trading card. Boxes should hug the card's printed border, not the pocket.`;

export interface LocateResult {
  cards: { x: number; y: number; w: number; h: number }[];
  usage: VisionUsage;
}

export async function locateCards(base64Image: string, mediaType: string): Promise<LocateResult> {
  const response = await getClient().messages.create({
    model: VISION_MODEL,
    max_tokens: 1500,
    output_config: { effort: "low", format: { type: "json_schema", schema: LOCATE_SCHEMA } },
    system: SYSTEM_LOCATE,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: normalizeMediaType(mediaType), data: base64Image } },
          { type: "text", text: "Where is every card in this photo?" },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("Locate request was declined");
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("Locate response contained no readable result");
  const parsed = JSON.parse(text.text) as { cards?: unknown };
  const cards = Array.isArray(parsed.cards)
    ? parsed.cards.filter(
        (c): c is { x: number; y: number; w: number; h: number } =>
          !!c && typeof c === "object" && ["x", "y", "w", "h"].every((k) => typeof (c as Record<string, unknown>)[k] === "number"),
      )
    : [];
  const u = response.usage;
  return {
    cards,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

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
const MTG_MARKS = new Set(["list-icon", "promo-stamp", "date-stamp", "serialized", "embossed"]);
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
    attractionLights: Array.isArray(parsed.attractionLights) ? parseAttractionLights(parsed.attractionLights) : [],
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
/**
 * The whole read: one look at the card, then — only when that look left the
 * identification unsettled — a second look at the bottom strip, enlarged,
 * asking for just the printed details (docs/POKEMON-IDENTIFICATION.md,
 * docs/MTG-IDENTIFICATION.md; Chris 09-10: 98% on a clear photo). The
 * second call costs roughly a third of the first and fires on the hard
 * tenth of scans, so the average scan barely moves.
 */
export async function analyzeCardImageWithUsage(
  base64Image: string,
  mediaType: string,
  languageHint: ScanLanguage,
  game: GameId = "pokemon",
  /**
   * The photo is one pocket cut from a binder page. The pocket's plastic
   * edge and the neighbouring sleeve read as a slab holder (3 of 9 cards on
   * Chris's first page, 09-27), so the prompt says so and slab is forced
   * false — a graded card does not fit a binder pocket.
   */
  pocket = false,
  /** Games this seller may scan; a read of one of them under the wrong switch re-reads as it. Omitted = never switch. */
  canSwitchTo?: (detected: GameId) => boolean,
): Promise<{ read: VisionCardRead; usage: VisionUsage }> {
  const first = await firstLook(base64Image, mediaType, languageHint, game, pocket);
  const detected = first.read.detectedGame;
  if (detected && detected !== game && isGameId(detected) && canSwitchTo?.(detected)) {
    // The seller's switch said one game, the card is another: read it again
    // with the right game's instructions (the first read is the wrong schema).
    const again = await analyzeCardImageWithUsage(base64Image, mediaType, languageHint, detected, pocket);
    return {
      read: { ...again.read, game: detected, switchedFrom: game },
      usage: addUsage(first.usage, again.usage),
    };
  }
  if (pocket) first.read.slab = false;
  // An Art Series front prints no text at all, so the picture itself is the
  // identification (lib/server/artHash.ts) — no second vision call needed.
  if (game === "mtg" && (first.read.kind === "art" || /^unknown\b/i.test(first.read.name) || !first.read.name)) {
    const matched = await matchArtByPicture(base64Image, first.read);
    if (matched) return { read: matched, usage: first.usage };
  }
  // A basic land with no collector number (1990s core sets, box sets) has
  // only its picture to say which printing it is — same name, same artist,
  // same year across sets (Plains BRB 128 vs 6ED 333, 09-29 panel). Every
  // hashed land front is a candidate; no hit within range keeps the read.
  if (game === "mtg" && first.read.kind !== "art" && !first.read.cardNumber && BASIC_LAND_NAME.test(first.read.name.trim())) {
    const matched = await matchArtByPicture(base64Image, first.read, "land");
    if (matched) return { read: matched, usage: first.usage };
  }
  const reason = await secondLookReason(first.read, game);
  if (!reason) return first;
  try {
    const second = await secondLook(base64Image, game);
    return {
      read: mergeSecondLook(first.read, second.read, reason, game),
      usage: addUsage(first.usage, second.usage),
    };
  } catch (err) {
    // The first read stands; a failed close-up must never fail a scan.
    console.warn("second look failed:", err instanceof Error ? err.message : err);
    return { read: { ...first.read, secondLook: `${reason}:failed` }, usage: first.usage };
  }
}

const BASIC_LAND_NAME = /^(snow-covered )?(plains|island|swamp|mountain|forest)$|^wastes$/i;

async function matchArtByPicture(base64Image: string, read: VisionCardRead, kind: "art" | "token" | "land" = "art"): Promise<VisionCardRead | null> {
  try {
    const { matchArtSeries } = await import("@/lib/server/artHash");
    const hit = await matchArtSeries(Buffer.from(base64Image, "base64"), kind);
    if (!hit) return null;
    return {
      ...read,
      name: hit.name,
      setCode: hit.setCode.toUpperCase(),
      cardNumber: hit.number,
      // A land is still a card; the art / token kinds name the object.
      kind: kind === "land" ? (read.kind ?? "card") : kind,
      confidence: Math.max(read.confidence ?? 0, 0.9),
      secondLook: `${kind}-picture:${hit.distance}`,
    };
  } catch (err) {
    console.warn("art picture match failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

async function firstLook(
  base64Image: string,
  mediaType: string,
  languageHint: ScanLanguage,
  game: GameId,
  pocket = false,
): Promise<{ read: VisionCardRead; usage: VisionUsage }> {
  const response = await getClient().messages.create({
    // Sonnet 5, was Opus 5 (09-02 A/B, all 64 prod photos, ab-vision.mjs →
    // backups/ab-vision-0902.json): identification IDENTICAL (name 64/64,
    // number 59/64 on both) at 2.5x cheaper ($0.011 vs $0.028/scan) — the
    // difference between a maxed-out subscriber (500 scans at the time; see lib/pricing.ts) losing money and ~47%
    // margin. Tradeoff: Sonnet abstains on photo-judged condition more often
    // (34/64 vs 60/64), so sellers pick condition manually more — fine, a
    // photo-guessed condition was always soft.
    model: VISION_MODEL,
    max_tokens: 2000,
    // Reading a card is perception, not deep reasoning, and this runs once per
    // photo in a batch — low effort keeps a stack of cards moving.
    output_config: {
      effort: "low",
      format: { type: "json_schema", schema: game === "mtg" ? MTG_READ_SCHEMA : game === "lorcana" || game === "onepiece" ? TCG_READ_SCHEMA : game === "yugioh" ? YUGIOH_READ_SCHEMA : CARD_READ_SCHEMA },
    },
    // Cached (09-29): the per-game instructions are the same on every scan,
    // so a stack of cards pays ~10% for them after the first (5-minute cache;
    // Sonnet 5 caches 1,024+ tokens, shorter prompts just don't cache).
    system: [
      {
        type: "text",
        text: game === "mtg" ? SYSTEM_MTG : game === "lorcana" ? SYSTEM_LORCANA : game === "onepiece" ? SYSTEM_ONEPIECE : game === "yugioh" ? SYSTEM_YUGIOH : SYSTEM,
        cache_control: { type: "ephemeral" },
      },
    ],
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
            }, but trust the photo over that if they disagree.${
              pocket
                ? " This photo is one pocket cut out of a binder page: the card is in a soft plastic pocket, and the edges of the picture may show the pocket seam or a sliver of the next card. It is NOT a graded slab; slab is false. Read the card in the middle."
                : ""
            }`,
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
  const asWear = (v: unknown): WearLevel | null =>
    v === "clean" || v === "light wear" || v === "worn" ? v : null;
  const read: VisionCardRead = {
    ...parsed,
    // Schema-constrained, but the number still reaches a regex downstream.
    cardNumber: parsed.cardNumber?.trim() || null,
    setTotal: typeof parsed.setTotal === "number" ? parsed.setTotal : null,
    setCode: parsed.setCode?.trim().toUpperCase() || null,
    artStyle: parsed.artStyle === "standard" || parsed.artStyle === "full-art" ? parsed.artStyle : null,
    kind: parsed.kind === "token" || parsed.kind === "art" || parsed.kind === "card" ? parsed.kind : null,
    slab: typeof parsed.slab === "boolean" ? parsed.slab : null,
    firstEdition: typeof parsed.firstEdition === "boolean" ? parsed.firstEdition : null,
    corners: asWear(parsed.corners),
    edges: asWear(parsed.edges),
    surface: asWear(parsed.surface),
    copyrightYear: typeof parsed.copyrightYear === "number" && parsed.copyrightYear >= 1993 && parsed.copyrightYear <= 2100 ? Math.trunc(parsed.copyrightYear) : null,
    name: parsed.name.trim(),
    game,
    detectedGame: DETECTED_GAMES.includes(parsed.cardGame as (typeof DETECTED_GAMES)[number]) ? parsed.cardGame : null,
    ...(game === "mtg" ? normalizeMtgCues(parsed) : {}),
    ...(game === "lorcana" || game === "onepiece"
      ? {
          subtitle: (parsed as { subtitle?: string | null }).subtitle?.trim() || null,
          variant: TCG_VARIANTS.has(String((parsed as { variant?: string | null }).variant)) ? (parsed as { variant?: string | null }).variant : null,
        }
      : {}),
    ...(game === "yugioh"
      ? {
          subtitle: null,
          variant: (YUGIOH_RARITIES as readonly string[]).includes(String((parsed as { variant?: string | null }).variant)) ? (parsed as { variant?: string | null }).variant : null,
        }
      : {}),
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

// ---------------------------------------------------------------------------
// Second look (09-10, the 98% push). The first read sees the whole card at
// phone size; the printed details that settle a printing — collector
// fraction, copyright year, the List icon, a date stamp, a serial, an Art
// Series name — live in the bottom strip in small type. When the first read
// left one of those open, crop that strip, enlarge it, and ask for those
// fields alone.
// ---------------------------------------------------------------------------

export const SECOND_LOOK_SCHEMA = {
  type: "object",
  properties: {
    name: nullableString(
      "The card name if it is printed in this strip (Art Series cards print the name in small type along the bottom edge). Null when the name is not in this crop.",
    ),
    cardNumber: nullableString(
      "The collector number as printed: the left half of a fraction ('199/165' -> '199', 'TG12/TG30' -> 'TG12'), or a promo number like 'SWSH001' / 'SVP 212', or a Magic number like '0158', '386z', '30s'. Null if not visible.",
    ),
    setTotal: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "The right half of that fraction ('199/165' -> 165, 'TG12/TG30' -> 30). Null when no denominator is printed.",
    },
    setCode: nullableString(
      "The short expansion code printed beside the number, e.g. 'SVI', 'WAR', 'LTC'. Not a language code, not the regulation mark. Null if not visible.",
    ),
    copyrightYear: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description:
        "The LAST year in the copyright line ('(c)2016 Pokemon' -> 2016; 'TM & (c) 1993-2023 Wizards of the Coast' -> 2023). Null when no year is printed (the earliest Magic cards print only 'Illus. (c) Artist').",
    },
    listIcon: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "Magic only. true when a small WHITE planeswalker symbol (five-pointed flame shape) is printed inside the black border at the very bottom-left corner, left of or below the copyright line - The List reprint. false when that corner is visible and there is no such symbol. Null if the corner is not in the crop.",
    },
    dateStamp: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description: "Magic only. true when a small rectangular foil date stamp (prerelease) is visible. Null if unsure.",
    },
    embossed: {
      type: "boolean",
      description: "Magic only. true when a large faint raised / embossed symbol (e.g. the D&D ampersand '&') is pressed across the text box and art, not just the small set symbol. false otherwise.",
    },
    serialNumber: nullableString("A printed serial like '045/500' if visible, else null."),
    artist: nullableString("The artist credit as printed ('Illus. Rob Alexander' → 'Rob Alexander'). Null if not visible."),
    borderColor: {
      anyOf: [{ type: "string", enum: ["black", "white", "silver", "gold", "borderless"] }, { type: "null" }],
      description: "The colour of the card's outermost edge (outside the frame) as seen in this crop. Null if the edge is not visible.",
    },
    innerBevel: {
      anyOf: [{ type: "boolean" }, { type: "null" }],
      description:
        "Magic, WHITE-bordered 1990s cards only. true when the inner edge of the white border shows a thin dark bevelled / embossed line where it meets the coloured frame (Unlimited Edition prints this). false when the white border meets the frame flat, with no dark line (Revised, 4th, 5th Edition). Null for black borders, modern cards, or when the edge is not clear.",
    },
    confidence: { type: "number", description: "0 to 1, how sure you are of the number and year specifically." },
  },
  required: ["name", "cardNumber", "setTotal", "setCode", "copyrightYear", "listIcon", "dateStamp", "embossed", "serialNumber", "artist", "borderColor", "innerBevel", "confidence"],
  additionalProperties: false,
} as const;

const SYSTEM_SECOND_LOOK = `This is an enlarged close-up of the BOTTOM part of one trading card (Pokémon, Magic: The Gathering or One Piece Card Game). Read only what is printed here, exactly as printed, and return null for anything you cannot actually see in this crop. Do not guess from memory of the card.

What lives here: the collector number and its denominator or expansion code in the bottom corner; the copyright line and its last year; the artist credit; on Art Series cards the card's name in small type; on The List reprints a small white planeswalker symbol at the far bottom-left inside the black border; on prerelease cards a small rectangular foil date stamp; on in-store promos a large faint embossed symbol (the D&D ampersand '&') pressed across the text box; on serialized cards a printed serial like 045/500. The outer edge of the card, if visible, is black or white; on a white-bordered 1990s Magic card look at where the white border meets the coloured frame — Unlimited Edition has a thin dark bevelled line there, Revised and 4th Edition meet flat.`;

type SecondLookRead = {
  name: string | null;
  cardNumber: string | null;
  setTotal: number | null;
  setCode: string | null;
  copyrightYear: number | null;
  listIcon: boolean | null;
  dateStamp: boolean | null;
  embossed?: boolean;
  serialNumber: string | null;
  artist: string | null;
  borderColor: string | null;
  innerBevel: boolean | null;
  confidence: number;
};

/** Below this the first read is treated as unsettled. */
const SECOND_LOOK_CONFIDENCE = 0.7;

/**
 * Why the first read needs a close-up, or null when it doesn't. Cheap and
 * conservative: the second call has to earn its cost.
 */
export async function secondLookReason(read: VisionCardRead, game: GameId): Promise<string | null> {
  if (game === "mtg") {
    if (read.kind === "art" || /^unknown\b/i.test(read.name) || !read.name) return "art-name";
    // The printed key names a card that ALSO exists as a List reprint, a
    // prerelease / promo-pack stamp or a serialized twin: the corner mark
    // decides, so look at the corner before the ranker chooses.
    if (read.setCode && read.cardNumber && (read.marks ?? []).length === 0) {
      const { hasTwinPrinting } = await import("@/lib/server/mtgCards");
      const twin = await hasTwinPrinting(read.setCode, read.cardNumber.replace(/^0+(?=\d)/, ""));
      if (twin) return `${twin}-twin`;
    }
  }
  if (typeof read.confidence === "number" && read.confidence < SECOND_LOOK_CONFIDENCE) return "low-confidence";
  if (!read.cardNumber && read.kind !== "art") return "no-number";
  return null;
}

/**
 * Bottom 45% of the image, widened to at least 1400px, as JPEG. One Piece
 * prints its key in small gold type at the bottom RIGHT ("OP06-119 SEC"),
 * which a whole-card read of a SEC foil turned into "OP01-050" twice on the
 * 09-30 seller batch — so its crop is the bottom-right third, enlarged more.
 */
async function bottomStrip(base64Image: string, game: GameId = "pokemon"): Promise<{ base64: string; mediaType: ImageMediaType }> {
  const sharp = (await import("sharp")).default;
  const input = Buffer.from(base64Image, "base64");
  const meta = await sharp(input).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("second look: unreadable image");
  const top = Math.round(h * (game === "onepiece" ? 0.66 : 0.55));
  const left = game === "onepiece" ? Math.round(w * 0.38) : 0;
  const targetWidth = Math.min(1568, Math.max(w - left, 1400));
  const out = await sharp(input)
    .extract({ left, top, width: w - left, height: h - top })
    .resize({ width: targetWidth, withoutEnlargement: false })
    .jpeg({ quality: 90 })
    .toBuffer();
  return { base64: out.toString("base64"), mediaType: "image/jpeg" };
}

export async function secondLook(base64Image: string, game: GameId): Promise<{ read: SecondLookRead; usage: VisionUsage }> {
  const strip = await bottomStrip(base64Image, game);
  const ask =
    game === "onepiece"
      ? "Read the printed details in this crop. The card is a One Piece Card Game card: its key is printed small at the bottom right, like 'OP06-119', 'ST16-004', 'EB02-061' or 'P-088', followed by the rarity (C, UC, R, SR, SEC, L, P, SP). Return the key exactly as cardNumber and its prefix before the dash ('OP06') as setCode. Read every digit from the print itself — foil glare often hides a stroke."
      : `Read the printed details in this crop. The card is a ${game === "mtg" ? "Magic: The Gathering" : "Pokémon"} card.`;
  const response = await getClient().messages.create({
    model: VISION_MODEL,
    max_tokens: 600,
    output_config: { effort: "low", format: { type: "json_schema", schema: SECOND_LOOK_SCHEMA } },
    system: SYSTEM_SECOND_LOOK,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: strip.mediaType, data: strip.base64 } },
          { type: "text", text: ask },
        ],
      },
    ],
  });
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error("second look: no readable result");
  const parsed = JSON.parse(text.text) as SecondLookRead;
  const u = response.usage;
  return {
    read: parsed,
    usage: {
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    },
  };
}

/**
 * Fold the close-up into the first read. Fill what was null; on a
 * low-confidence first read let the close-up override the fraction; add the
 * marks it saw. The first read keeps everything the crop cannot see (name
 * band, art, condition).
 */
export function mergeSecondLook(first: VisionCardRead, second: SecondLookRead, reason: string, game: GameId): VisionCardRead {
  const out: VisionCardRead = { ...first, secondLook: reason };
  const override = reason === "low-confidence" || reason === "no-number";
  const num = second.cardNumber?.trim() || null;
  if (num && (override || !first.cardNumber)) out.cardNumber = num;
  if (typeof second.setTotal === "number" && (override || !first.setTotal)) out.setTotal = second.setTotal;
  const code = second.setCode?.trim().toUpperCase() || null;
  if (code && (override || !first.setCode)) out.setCode = code;
  const year =
    typeof second.copyrightYear === "number" && second.copyrightYear >= 1993 && second.copyrightYear <= 2100
      ? Math.trunc(second.copyrightYear)
      : null;
  if (year && !first.copyrightYear) out.copyrightYear = year;
  if (second.name && (reason === "art-name" || !first.name || /^unknown\b/i.test(first.name))) out.name = second.name.trim();
  if (override && typeof second.confidence === "number" && second.confidence > (first.confidence ?? 0)) out.confidence = second.confidence;
  if (game === "mtg") {
    const marks = new Set(first.marks ?? []);
    if (second.listIcon === true) marks.add("list-icon");
    if (second.dateStamp === true) marks.add("date-stamp");
    if (second.embossed === true) marks.add("embossed");
    const serial = second.serialNumber?.trim() || null;
    if (serial) {
      marks.add("serialized");
      out.serialNumber = serial;
    }
    out.marks = [...marks] as VisionCardRead["marks"];
    // The close-up sees the edge better than the whole-card read did (which
    // called Beta white and Unlimited black on the 09-10 panel).
    if (second.borderColor && MTG_BORDERS.has(second.borderColor) && (override || !first.borderColor)) {
      out.borderColor = second.borderColor as VisionCardRead["borderColor"];
    }
    if (typeof second.innerBevel === "boolean") out.bevel = second.innerBevel;
    if (typeof second.listIcon === "boolean") out.listIconSeen = second.listIcon;
    if (second.artist && !first.artist) out.artist = second.artist.trim();
    // A readable bottom strip with no year on it: the card predates the
    // year line (before 4th Edition / Ice Age) — a cue only the close-up
    // can give, since the whole-card read cannot tell "none" from "missed".
    // "Readable" = it read the artist credit (same line, same type size)
    // or says it is sure; 1990s cards have no number, so the model's own
    // confidence sits low there even when every letter is legible.
    const stripReadable = Boolean(second.artist) || (typeof second.confidence === "number" && second.confidence >= 0.6);
    if (!year && !first.copyrightYear && stripReadable) out.noYearLine = true;
  }
  return out;
}

function addUsage(a: VisionUsage, b: VisionUsage): VisionUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

// ---------------------------------------------------------------------------
// Picture tiebreak (09-10, Chris: "get us close to 99%, I don't care how").
// When the ranker's #1 and #2 sit within a point of each other — Unlimited
// vs Revised, two McDonald's Pikachus, a List reprint vs its original — the
// printed key has run out. Send the photo and BOTH catalog pictures to the
// stronger model and ask which one it is. Fires on ties only (about one
// scan in fifty), a few cents each.
// ---------------------------------------------------------------------------

export const TIEBREAK_MODEL = "claude-opus-5";

export const TIEBREAK_SCHEMA = {
  type: "object",
  properties: {
    pick: {
      anyOf: [{ type: "string", enum: ["A", "B", "C", "D", "E", "F"] }, { type: "null" }],
      description: "Which catalog picture shows the SAME printing as the photo: 'A' (second image), 'B' (third image), and 'C'–'F' when more are shown. Null when the catalog pictures are the same printing to your eye or the photo cannot settle it.",
    },
    confidence: { type: "number", description: "0 to 1." },
    reason: { type: "string", description: "One short sentence: the printed detail that decided it (border, set symbol, copyright line, stamp, frame, art)." },
  },
  required: ["pick", "confidence", "reason"],
  additionalProperties: false,
} as const;

const SYSTEM_TIEBREAK = `You compare trading cards for a seller's listing. The FIRST image is the seller's photo. The SECOND (A) and THIRD (B) images — and C, D, E, F after them when given — are catalog pictures of different printings that share the same name. Decide which catalog printing the photo shows.

Judge only by what is printed: border colour and its inner edge, the set symbol or expansion code, the collector number and denominator, the copyright line and its year, a 1st Edition stamp, a promo or date stamp, a List icon in the bottom-left corner, frame style, and the artwork. Ignore lighting, glare, sleeves, angle and wear. If the catalog pictures show no printed difference you can see, or the photo does not show the deciding detail, answer null rather than guess.

Yu-Gi-Oh! printings of one set code often differ ONLY by foil, and the foil is the answer: the colour of the name foil (plain, silver, gold, blue, green, purple, red, bronze), whether the artwork is flat, smoothly holographic or covered in grainy sparkle, whether the foil runs over the whole card (frame and text box too) and its pattern (dots/stars, large shards, square tiles, raised lines), and stamps such as "25th" or "DUEL TERMINAL". Here glare that shows a foil pattern is evidence, not noise.`;

export interface TiebreakResult {
  id: string | null;
  pick: "A" | "B" | "C" | "D" | "E" | "F" | null;
  confidence: number;
  reason: string;
  usage: VisionUsage;
}

async function catalogPicture(id: string, game: GameId): Promise<{ base64: string; mediaType: ImageMediaType } | null> {
  let url: string | null = null;
  if (game === "mtg") {
    const { mtgCardById } = await import("@/lib/server/mtgCards");
    url = (await mtgCardById(id))[0]?.imageLarge ?? null;
  } else if (game === "lorcana" || game === "onepiece" || game === "yugioh") {
    const { tcgReferenceImage } = await import("@/lib/server/tcgCards");
    url = await tcgReferenceImage(id);
  } else {
    const { englishCardById } = await import("@/lib/server/enCards");
    url = (await englishCardById(id)).cards[0]?.imageLarge ?? null;
  }
  if (!url) return null;
  // pokemontcg.io's plain PNG is a 245px thumbnail; use the _hires twin.
  url = url.replace(/(images\.pokemontcg\.io\/[^/]+\/[^/._]+)\.png$/, "$1_hires.png");
  const res = await fetch(url, { headers: { "User-Agent": "CardFlip/1.0 (+https://cardflip.io)" }, signal: AbortSignal.timeout(12_000) });
  if (!res.ok) return null;
  return toClaudeImage(Buffer.from(await res.arrayBuffer()));
}

/**
 * Bytes → something Claude accepts. Lorcast serves AVIF, which the API does
 * not take, so anything that is not JPEG / PNG / WebP / GIF is re-encoded
 * as JPEG with sharp.
 */
export async function toClaudeImage(bytes: Buffer): Promise<{ base64: string; mediaType: ImageMediaType }> {
  const head4 = bytes.subarray(0, 4).toString("hex");
  const isPng = head4 === "89504e47";
  const isJpeg = head4.startsWith("ffd8ff");
  const isWebp = bytes.subarray(8, 12).toString() === "WEBP";
  const isGif = bytes.subarray(0, 3).toString() === "GIF";
  if (isPng) return { base64: bytes.toString("base64"), mediaType: "image/png" };
  if (isWebp) return { base64: bytes.toString("base64"), mediaType: "image/webp" };
  if (isGif) return { base64: bytes.toString("base64"), mediaType: "image/gif" };
  if (isJpeg) return { base64: bytes.toString("base64"), mediaType: "image/jpeg" };
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(bytes).jpeg({ quality: 90 }).toBuffer();
  return { base64: jpeg.toString("base64"), mediaType: "image/jpeg" };
}

/**
 * Which of two (up to six — Yu-Gi-Oh! rarities of one code, lib/tiebreak.ts
 * tiebreakIds) catalog printings the photo shows. Returns id null when the
 * model declines or a catalog picture is missing — the caller keeps the
 * ranker's order then.
 */
const LETTERS = ["A", "B", "C", "D", "E", "F"] as const;
export async function tiebreakByPicture(
  base64Image: string,
  mediaType: string,
  game: GameId,
  ids: string[],
): Promise<TiebreakResult> {
  const zero: VisionUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  ids = ids.slice(0, LETTERS.length);
  const pictures = await Promise.all(ids.map((id) => catalogPicture(id, game)));
  if (ids.length < 2 || pictures.some((p) => !p)) return { id: null, pick: null, confidence: 0, reason: "catalog picture missing", usage: zero };
  const letters = LETTERS.slice(0, ids.length);
  const catalogBlocks = pictures.flatMap((p, i) => [
    { type: "text" as const, text: `Catalog printing ${letters[i]}:` },
    { type: "image" as const, source: { type: "base64" as const, media_type: p!.mediaType, data: p!.base64 } },
  ]);
  const response = await getClient().messages.create({
    model: TIEBREAK_MODEL,
    // Opus 5 thinks by default and those tokens count against max_tokens;
    // a tight cap (300-450) starved the JSON answer (09-10: "Unterminated
    // string", "no readable result"). Only generated tokens are billed.
    max_tokens: 4000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: TIEBREAK_SCHEMA } },
    system: SYSTEM_TIEBREAK,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Seller's photo:" },
          { type: "image", source: { type: "base64", media_type: normalizeMediaType(mediaType), data: base64Image } },
          ...catalogBlocks,
          { type: "text", text: `Which printing is the photo, ${letters.slice(0, -1).join(", ")} or ${letters[letters.length - 1]}? The game is ${game === "mtg" ? "Magic: The Gathering" : game === "onepiece" ? "One Piece Card Game" : game === "lorcana" ? "Disney Lorcana" : game === "yugioh" ? "Yu-Gi-Oh!" : "Pokémon"}.` },
        ],
      },
    ],
  });
  const text = response.content.find((block) => block.type === "text");
  if (!text || text.type !== "text") throw new Error(`tiebreak: no readable result (stop_reason ${response.stop_reason})`);
  const parsed = JSON.parse(text.text) as { pick: TiebreakResult["pick"]; confidence: number; reason: string };
  const u = response.usage;
  const usage: VisionUsage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
  };
  const at = parsed.pick ? (letters as readonly string[]).indexOf(parsed.pick) : -1;
  const pick = at > -1 ? letters[at] : null;
  const sure = typeof parsed.confidence === "number" && parsed.confidence >= 0.6;
  return { id: pick && sure ? ids[at] : null, pick, confidence: parsed.confidence ?? 0, reason: parsed.reason ?? "", usage };
}
