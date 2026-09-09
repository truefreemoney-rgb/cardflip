import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * The board — Chris's organised task list, edited live in the admin console
 * (09-09: "I should be able to delete and add categories, one for my own
 * thoughts, checkboxes clickable"). Lives in the settings table (key
 * "board", JSON). docs/BOARD.md is the SEED: it is parsed once, the first
 * time the console loads and nothing is stored yet; after that the DB is
 * the truth. Shape: `## Title — hint` sections, `- [ ]` / `- [x]` items,
 * an optional leading `[Chris]` / `[Claude]` / `[both]` tag.
 */
export const BOARD_KEY = "board";
export const BOARD_MAX_BYTES = 200_000;

export type BoardOwner = "Chris" | "Claude" | "both" | null;
export interface BoardItem {
  id: string;
  done: boolean;
  owner: BoardOwner;
  text: string;
}
export interface BoardSection {
  id: string;
  title: string;
  /** The part after " — " in the heading, if any ("current main tasks"). */
  hint: string | null;
  items: BoardItem[];
}

const OWNERS = new Set(["Chris", "Claude", "both"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function parseBoard(md: string): BoardSection[] {
  const sections: BoardSection[] = [];
  let current: BoardSection | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      const [title, hint] = h[1].split(/\s+—\s+/, 2);
      current = { id: randomUUID(), title: title.trim(), hint: hint?.trim() ?? null, items: [] };
      sections.push(current);
      continue;
    }
    const it = /^-\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (it && current) {
      let text = it[2].trim();
      let owner: BoardOwner = null;
      // "[Admin]" / "[Admin / Claude]" are the console's display labels for
      // "Chris" / "both" (Chris doesn't want his name shown) — accept either
      // spelling in the file so a hand-edited BOARD.md still parses.
      const tag = /^\[(Chris|Claude|both|Admin \/ Claude|Admin)\]\s*/.exec(text);
      if (tag) {
        const raw = tag[1];
        owner = raw === "Admin" ? "Chris" : raw === "Admin / Claude" ? "both" : (raw as BoardOwner);
        text = text.slice(tag[0].length);
      }
      // Strip markdown bold markers; the console renders plain text.
      text = text.replace(/\*\*/g, "");
      current.items.push({ id: randomUUID(), done: it[1] !== " ", owner, text });
    }
  }
  return sections;
}

/** The board back as markdown — same dialect docs/BOARD.md is written in. */
export function serializeBoard(sections: BoardSection[]): string {
  const out = ["# CardFlip Board", "", "Exported from the admin console (the live copy is in the settings table).", ""];
  for (const s of sections) {
    out.push(`## ${s.title}${s.hint ? ` — ${s.hint}` : ""}`, "");
    for (const it of s.items) out.push(`- [${it.done ? "x" : " "}] ${it.owner ? `[${it.owner}] ` : ""}${it.text}`);
    out.push("");
  }
  return out.join("\n");
}

/**
 * Validate a board coming from the client. Returns the cleaned board or a
 * message. Strict on shape, lenient on content (any text, any title).
 */
export function validateBoard(input: unknown): { ok: true; sections: BoardSection[] } | { ok: false; error: string } {
  if (!Array.isArray(input)) return { ok: false, error: "Board must be a list of sections" };
  if (input.length > 40) return { ok: false, error: "Too many sections (max 40)" };
  const seen = new Set<string>();
  const sections: BoardSection[] = [];
  for (const s of input) {
    if (!s || typeof s !== "object") return { ok: false, error: "Bad section" };
    const { id, title, hint, items } = s as Record<string, unknown>;
    if (typeof id !== "string" || !ID_RE.test(id) || seen.has(id)) return { ok: false, error: "Bad section id" };
    seen.add(id);
    if (typeof title !== "string" || !title.trim() || title.length > 80) return { ok: false, error: "Section title is required (1–80 characters)" };
    if (hint != null && (typeof hint !== "string" || hint.length > 120)) return { ok: false, error: "Section hint too long" };
    if (!Array.isArray(items) || items.length > 300) return { ok: false, error: "Too many items in a section (max 300)" };
    const clean: BoardItem[] = [];
    for (const it of items) {
      if (!it || typeof it !== "object") return { ok: false, error: "Bad item" };
      const { id: iid, done, owner, text } = it as Record<string, unknown>;
      if (typeof iid !== "string" || !ID_RE.test(iid) || seen.has(iid)) return { ok: false, error: "Bad item id" };
      seen.add(iid);
      if (typeof text !== "string" || text.length > 1000) return { ok: false, error: "Item text too long (max 1000)" };
      if (owner != null && (typeof owner !== "string" || !OWNERS.has(owner))) return { ok: false, error: "Bad owner tag" };
      clean.push({ id: iid, done: Boolean(done), owner: (owner as BoardOwner) ?? null, text: text.trim() });
    }
    sections.push({ id, title: title.trim(), hint: typeof hint === "string" && hint.trim() ? hint.trim() : null, items: clean });
  }
  return { ok: true, sections };
}

/** The personal category Chris asked for; seeded once alongside the file. */
export function notesSection(): BoardSection {
  return { id: randomUUID(), title: "Chris's thoughts", hint: "your own notes, anything goes", items: [] };
}

async function seedFromFile(): Promise<BoardSection[]> {
  const file = path.join(process.cwd(), "docs", "BOARD.md");
  try {
    const md = await readFile(file, "utf8");
    const sections = parseBoard(md);
    if (!sections.some((s) => /thoughts/i.test(s.title))) sections.splice(1, 0, notesSection());
    return sections;
  } catch {
    return [notesSection()];
  }
}

export async function loadBoard(): Promise<{ sections: BoardSection[]; updatedAt: number | null }> {
  const stored = await getSetting(BOARD_KEY);
  if (stored) {
    try {
      const v = validateBoard(JSON.parse(stored));
      if (v.ok) {
        const row = (await db.prepare("SELECT updated_at FROM settings WHERE key = ?").get(BOARD_KEY)) as { updated_at: number } | undefined;
        return { sections: v.sections, updatedAt: row?.updated_at ?? null };
      }
    } catch {
      /* fall through: reseed */
    }
  }
  const sections = await seedFromFile();
  await saveBoard(sections);
  return { sections, updatedAt: Date.now() };
}

/**
 * Replace the live board with the file. Claude edits docs/BOARD.md in the
 * repo (a Technical category, moved items…); Chris presses "Reload from
 * file" in the console. Live edits since the last reload are lost (except Chris's thoughts) — the
 * button says so. Ids are fresh; the console re-renders from the response.
 */
export async function reseedBoard(): Promise<{ sections: BoardSection[]; updatedAt: number }> {
  const sections = await seedFromFile();
  // Keep Chris's own notes: the file never holds them, so a reload would
  // otherwise empty the category (found 09-09).
  const { sections: live } = await loadBoard();
  const notes = live.find((s) => /thoughts/i.test(s.title));
  if (notes?.items.length) {
    const target = sections.find((s) => /thoughts/i.test(s.title));
    if (target) target.items = notes.items;
    else sections.splice(1, 0, { ...notes, id: randomUUID() });
  }
  await saveBoard(sections);
  return { sections, updatedAt: Date.now() };
}

export async function saveBoard(sections: BoardSection[]): Promise<void> {
  const json = JSON.stringify(sections);
  if (json.length > BOARD_MAX_BYTES) throw new Error("Board too large");
  await setSetting(BOARD_KEY, json);
}
