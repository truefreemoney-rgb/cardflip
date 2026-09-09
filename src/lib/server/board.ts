import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * docs/BOARD.md, parsed for the admin console (Chris, 09-09: "incorporate
 * it into the admin page"). The file is the source of truth and is edited
 * in the repo; this is read-only. Shape: `## Title` sections, `- [ ]` /
 * `- [x]` items, an optional leading `[Chris]` / `[Claude]` / `[both]` tag.
 */
export interface BoardItem {
  done: boolean;
  owner: "Chris" | "Claude" | "both" | null;
  text: string;
}
export interface BoardSection {
  title: string;
  /** The part after " — " in the heading, if any ("current main tasks"). */
  hint: string | null;
  items: BoardItem[];
}

export function parseBoard(md: string): BoardSection[] {
  const sections: BoardSection[] = [];
  let current: BoardSection | null = null;
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h = /^##\s+(.+)$/.exec(line);
    if (h) {
      const [title, hint] = h[1].split(/\s+—\s+/, 2);
      current = { title: title.trim(), hint: hint?.trim() ?? null, items: [] };
      sections.push(current);
      continue;
    }
    const it = /^-\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    if (it && current) {
      let text = it[2].trim();
      let owner: BoardItem["owner"] = null;
      const tag = /^\[(Chris|Claude|both)\]\s*/.exec(text);
      if (tag) {
        owner = tag[1] as BoardItem["owner"];
        text = text.slice(tag[0].length);
      }
      // Strip markdown bold markers; the console renders plain text.
      text = text.replace(/\*\*/g, "");
      current.items.push({ done: it[1] !== " ", owner, text });
    }
  }
  return sections;
}

export async function loadBoard(): Promise<{ sections: BoardSection[]; updatedAt: number | null }> {
  const file = path.join(process.cwd(), "docs", "BOARD.md");
  try {
    const [md, stat] = await Promise.all([readFile(file, "utf8"), import("node:fs/promises").then((m) => m.stat(file))]);
    return { sections: parseBoard(md), updatedAt: stat.mtimeMs };
  } catch {
    return { sections: [], updatedAt: null };
  }
}
