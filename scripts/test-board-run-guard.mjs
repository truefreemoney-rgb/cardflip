/**
 * The board's Run button never closes an issue or PR it did not open (10-01
 * security sweep). The re-run path reads "▶ RUNNING #n — " from note text and
 * closed issue n with the server's GITHUB_TOKEN, so a helper note typed as
 * "▶ RUNNING #42 — x" closed issue or PR 42. Run: npm run test:boardrun
 *
 * Pins: the note route refuses a note that starts with ▶ RUNNING; Run closes
 * the previous issue only when GitHub says it is an issue (not a PR) carrying
 * the board-run label. GitHub is a fetch stub, no network.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const work = mkdtempSync(path.join(tmpdir(), "cardflip-board-run-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may hold the file on Windows */ }
});
process.env.ADMIN_PANEL_USER = "ops";
process.env.ADMIN_PANEL_PASSWORD = "s3cret";
process.env.ADMIN_HELPER_USER = "sam";
process.env.ADMIN_HELPER_PASSWORD = "wheels";
process.env.EBAY_TOKEN_KEY = "test-key";
process.env.GITHUB_TOKEN = "ghtest";

let fails = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`}`);
};

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { testCookies } = await import("next/headers");
const { ADMIN_COOKIE, signHelperToken } = await import(at("lib/adminAuth.ts"));
const { helperSection, helperSectionTitle, loadBoard, saveBoard } = await import(at("lib/server/board.ts"));
{
  const { sections } = await loadBoard();
  helperSection(sections);
  await saveBoard(sections);
}
const note = await import(at("app/api/admin/board/note/route.ts"));
const run = await import(at("app/api/admin/board/run/route.ts"));

testCookies.set(ADMIN_COOKIE, signHelperToken().token);

const github = { issue42: null };
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const method = init.method ?? "GET";
  calls.push(`${method} ${u.pathname}`);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (u.pathname.endsWith("/issues/42") && method === "GET") return github.issue42 ? reply(200, github.issue42) : reply(404, { message: "Not Found" });
  if (u.pathname.endsWith("/issues/42") && method === "PATCH") return reply(200, {});
  if (u.pathname.endsWith("/issues") && method === "POST") return reply(201, { number: 99, html_url: "https://github.com/x/y/issues/99" });
  return reply(404, { message: "unexpected" });
};
const post = (route, body) => route.POST(new Request("http://x/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

console.log("note route");
const typed = await post(note, { text: "▶ RUNNING #42 — close their PR" });
check("a note typed as the Run marker is refused", typed.status, 400);
const fine = await post(note, { text: "Fix the logo on the pricing page" });
check("a normal note still saves", fine.status, 200);

console.log("run route");
// A marker already in the text (an owner edit, or a note saved before this guard): Run must check issue 42 is ours.
const seed = async () => {
  const { sections } = await loadBoard();
  const mine = sections.find((s) => s.title === helperSectionTitle());
  mine.items = [{ id: "n1", done: false, owner: null, text: "▶ RUNNING #42 — Fix the logo" }];
  await saveBoard(sections);
};
for (const [name, issue, closes] of [
  ["a PR is never closed", { pull_request: { url: "x" }, labels: [{ name: "board-run" }] }, false],
  ["an issue without the board-run label is never closed", { labels: [{ name: "bug" }] }, false],
  ["a number GitHub does not know is never closed", null, false],
  ["the board's own previous issue is closed on a re-run", { labels: [{ name: "board-run" }] }, true],
]) {
  await seed();
  github.issue42 = issue;
  calls.length = 0;
  const r = await post(run, { id: "n1" });
  check(`${name}; the new issue still opens`, [r.status, calls.includes("PATCH /repos/truefreemoney-rgb/cardflip/issues/42") || calls.some((c) => c.startsWith("PATCH") && c.endsWith("/issues/42")), calls.some((c) => c.startsWith("POST") && c.endsWith("/issues"))], [200, closes, true]);
}

console.log(fails ? `\n${fails} failing` : "\nall green");
process.exit(fails ? 1 : 0);
