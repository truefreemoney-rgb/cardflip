// Add one line to the live board from the command line (prod Turso via
// .env.migration.json). Usage:
//   node --experimental-strip-types --no-warnings --conditions=react-server --import ./scripts/lib/register-alias.mjs scripts/board-add.mjs --section Claude [--done] --owner Claude --text "..."
import fs from "node:fs";
import { randomUUID } from "node:crypto";
const cfg = JSON.parse(fs.readFileSync(".env.migration.json", "utf8").replace(/^﻿/, ""));
process.env.TURSO_DATABASE_URL ||= cfg.dbUrl;
process.env.TURSO_AUTH_TOKEN ||= cfg.dbToken;
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n) => args.includes(`--${n}`);
const { loadBoard, saveBoard, normalizeBoard } = await import("@/lib/server/board");
const board = await loadBoard();
const section = board.sections.find((s) => s.title === (opt("section") ?? "Claude"));
if (!section) throw new Error("no section " + opt("section"));
section.items.unshift({ id: randomUUID().slice(0, 8), done: flag("done"), owner: opt("owner") ?? "Claude", text: opt("text") });
const n = normalizeBoard(board.sections);
const at = await saveBoard(n.sections, board.updatedAt);
console.log("saved, updatedAt", at);
