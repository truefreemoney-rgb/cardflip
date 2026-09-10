/**
 * Board save conflict guard (09-10): a save built on a stale copy is refused,
 * so an open board page can't wipe what another tab or Claude wrote.
 * Run: npm run test:boardsave
 *
 * Throwaway-db trick from test-auth.mjs: chdir to a temp dir before any import.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-board-save-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { saveBoard, loadBoard, BoardConflictError } = await import(at("lib/server/board.ts"));

let failures = 0;
function check(label, actual, expected = true) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — got ${JSON.stringify(actual)}`}`);
}

const section = (title, text) => ({ id: crypto.randomUUID(), title, hint: "", items: [{ id: crypto.randomUUID(), done: false, owner: "Claude", text }] });

const t1 = await saveBoard([section("Now", "first")]);
check("unconditional save returns a stamp", typeof t1, "number");
const loaded = await loadBoard();
check("loadBoard hands back the same stamp", loaded.updatedAt, t1);

await new Promise((r) => setTimeout(r, 5));
const t2 = await saveBoard([section("Now", "second")], t1);
check("save with the current stamp lands", (await loadBoard()).sections[0].items[0].text, "second");
check("…and returns a newer stamp", t2 > t1);

let conflict = null;
try { await saveBoard([section("Now", "from a stale tab")], t1); } catch (e) { conflict = e; }
check("save with the old stamp is refused", conflict instanceof BoardConflictError);
check("…and the live board is untouched", (await loadBoard()).sections[0].items[0].text, "second");

const t3 = await saveBoard([section("Now", "third")]);
check("unconditional save still works (server-side callers)", (await loadBoard()).sections[0].items[0].text, "third");
check("…with a fresh stamp", t3 >= t2);

console.log(failures === 0 ? "\nAll board-save checks passed." : `\n${failures} board-save check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
