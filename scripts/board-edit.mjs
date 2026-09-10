// Replace the text of one live-board item by a substring of its current text
// (prod Turso via .env.migration.json; loadBoard → saveBoard with the
// conflict check). Usage (alias loader like board-add.mjs):
//   ... scripts/board-edit.mjs --match "MAIN FOCUS" --text "new text" [--done]
import fs from "node:fs";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL ||= cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN ||= cfg.dbToken;
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);
const { loadBoard, saveBoard, normalizeBoard } = await import("@/lib/server/board");
const board = await loadBoard();
const hits = board.sections.flatMap((s) => s.items.filter((it) => it.text.includes(opt("match"))));
if (hits.length !== 1) throw new Error(`--match must hit exactly one item, hit ${hits.length}`);
if (opt("text")) hits[0].text = opt("text");
if (flag("done")) hits[0].done = true;
const n = normalizeBoard(board.sections);
console.log("saved, updatedAt", await saveBoard(n.sections, board.updatedAt));
