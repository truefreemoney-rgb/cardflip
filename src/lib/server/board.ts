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
  /** Photos attached to the note (Vercel Blob URLs, 09-09: "for my thoughts, i need a image update option"). */
  images?: string[];
  /** When it reached Completed (ms). Set by normalizeBoard, never by hand. */
  completedAt?: number;
  /** The category it lived in before Completed, so it can be reopened there. */
  from?: string;
}

/**
 * Completed (Chris, 09-09: "once tasks are 100% complete, they move to a
 * complete section … you should be the only one completing these tasks").
 * Every done item anywhere is swept here, newest first — by Claude in a
 * session, by a merged-and-live run, or by a tick. Live views hide it.
 */
export const COMPLETED_TITLE = "Completed";
export const isCompletedSection = (s: BoardSection): boolean => /^completed$|^done/i.test(s.title.trim());
export interface BoardSection {
  id: string;
  title: string;
  /** The part after " — " in the heading, if any ("current main tasks"). */
  hint: string | null;
  items: BoardItem[];
}

const OWNERS = new Set(["Chris", "Claude", "both"]);
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
/** Only our own Blob store — an arbitrary URL would let a stale client save an off-site image. */
export const BLOB_URL_RE = /^https:\/\/[a-z0-9]+\.public\.blob\.vercel-storage\.com\/board\/[A-Za-z0-9._-]+$/;
export const MAX_IMAGES = 6;

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
    for (const it of s.items) {
      const stamp = it.completedAt ? ` (completed ${new Date(it.completedAt).toISOString().slice(0, 10)}${it.from ? `, from ${it.from}` : ""})` : "";
      out.push(`- [${it.done ? "x" : " "}] ${it.owner ? `[${it.owner}] ` : ""}${it.text.replace(/\r?\n/g, " ⏎ ")}${(it.images ?? []).map((u) => ` [image](${u})`).join("")}${stamp}`);
    }
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
      const { id: iid, done, owner, text, images, completedAt, from } = it as Record<string, unknown>;
      if (typeof iid !== "string" || !ID_RE.test(iid) || seen.has(iid)) return { ok: false, error: "Bad item id" };
      seen.add(iid);
      if (typeof text !== "string" || text.length > 1000) return { ok: false, error: "Item text too long (max 1000)" };
      if (owner != null && (typeof owner !== "string" || !OWNERS.has(owner))) return { ok: false, error: "Bad owner tag" };
      let imgs: string[] | undefined;
      if (images != null) {
        if (!Array.isArray(images) || images.length > MAX_IMAGES) return { ok: false, error: `Too many images (max ${MAX_IMAGES})` };
        if (!images.every((u) => typeof u === "string" && BLOB_URL_RE.test(u))) return { ok: false, error: "Bad image URL" };
        imgs = images.length ? (images as string[]) : undefined;
      }
      if (completedAt != null && (typeof completedAt !== "number" || !Number.isFinite(completedAt))) return { ok: false, error: "Bad completedAt" };
      if (from != null && (typeof from !== "string" || from.length > 80)) return { ok: false, error: "Bad from" };
      clean.push({
        id: iid,
        done: Boolean(done),
        owner: (owner as BoardOwner) ?? null,
        text: text.trim(),
        ...(imgs ? { images: imgs } : {}),
        ...(typeof completedAt === "number" ? { completedAt } : {}),
        ...(typeof from === "string" && from.trim() ? { from: from.trim() } : {}),
      });
    }
    sections.push({ id, title: title.trim(), hint: typeof hint === "string" && hint.trim() ? hint.trim() : null, items: clean });
  }
  return { ok: true, sections };
}

/**
 * Sweep every done item into Completed (newest first, stamped with when and
 * where from) and every not-done item in Completed back to where it came
 * from (a reopen). Pure; returns whether anything moved.
 */
export function normalizeBoard(sections: BoardSection[], now = Date.now()): { sections: BoardSection[]; changed: boolean } {
  let changed = false;
  const next = sections.map((s) => ({ ...s, items: s.items.slice() }));
  let completed = next.find(isCompletedSection);
  if (!completed) {
    completed = { id: randomUUID(), title: COMPLETED_TITLE, hint: "what got finished, newest first", items: [] };
    next.push(completed);
    changed = true;
  }
  const arrivals: BoardItem[] = [];
  for (const s of next) {
    if (s === completed) continue;
    const keep: BoardItem[] = [];
    for (const it of s.items) {
      if (it.done) {
        arrivals.push({ ...it, completedAt: it.completedAt ?? now, from: it.from ?? s.title });
        changed = true;
      } else keep.push(it);
    }
    s.items = keep;
  }
  // Reopened: un-ticked inside Completed goes home (or to the first section).
  const reopened = completed.items.filter((it) => !it.done);
  if (reopened.length) {
    changed = true;
    completed.items = completed.items.filter((it) => it.done);
    for (const it of reopened) {
      const home = next.find((s) => s !== completed && s.title === it.from) ?? next.find((s) => s !== completed);
      const clean: BoardItem = { ...it };
      delete clean.completedAt;
      delete clean.from;
      home?.items.push(clean);
    }
  }
  if (arrivals.length) completed.items = [...arrivals.sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)), ...completed.items];
  // Completed always sits last so the live cards read top-down.
  if (next[next.length - 1] !== completed) {
    next.splice(next.indexOf(completed), 1);
    next.push(completed);
    changed = true;
  }
  return { sections: next, changed };
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
        const n = normalizeBoard(v.sections);
        if (n.changed) {
          await saveBoard(n.sections);
          return { sections: n.sections, updatedAt: Date.now() };
        }
        const row = (await db.prepare("SELECT updated_at FROM settings WHERE key = ?").get(BOARD_KEY)) as { updated_at: number } | undefined;
        return { sections: n.sections, updatedAt: row?.updated_at ?? null };
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

/** Thrown when a save is built on a copy of the board that is no longer the live one. */
export class BoardConflictError extends Error {
  constructor() {
    super("The board changed since this copy was loaded");
    this.name = "BoardConflictError";
  }
}

/**
 * Save the board. Pass `expect` (the updatedAt the caller loaded) and the
 * write only lands if the live row still carries that stamp — a second tab
 * or Claude's admin-API edits can't be wiped by an autosave of a stale copy
 * (09-09: seven notes gone that way; 09-10: a row Claude added vanished under
 * Chris's open page). Returns the stamp written.
 */
export async function saveBoard(sections: BoardSection[], expect?: number | null): Promise<number> {
  const json = JSON.stringify(normalizeBoard(sections).sections);
  if (json.length > BOARD_MAX_BYTES) throw new Error("Board too large");
  const now = Date.now();
  if (typeof expect === "number") {
    const r = await db
      .prepare("UPDATE settings SET value = ?, updated_at = ? WHERE key = ? AND updated_at = ?")
      .run(json, now, BOARD_KEY, expect);
    if (Number(r.changes ?? 0) === 0) throw new BoardConflictError();
    return now;
  }
  await setSetting(BOARD_KEY, json);
  const row = (await db.prepare("SELECT updated_at FROM settings WHERE key = ?").get(BOARD_KEY)) as { updated_at: number } | undefined;
  return row?.updated_at ?? now;
}
