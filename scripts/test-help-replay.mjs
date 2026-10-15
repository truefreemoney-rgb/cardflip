/**
 * Replay real robot conversations against the live prompt (10-14, after Jenny's ticket #1001).
 * Run: npm run test:helpreplay   (needs ANTHROPIC_API_KEY; a few cents per run; SKIPs without one)
 *
 * Each scripts/help-replays/*.json is one seller: the account shape, their turns in order, and for
 * each turn the lines the reply must and must not contain (regexes, "(?i)" prefix = ignore case).
 * Run it before pushing a prompt change; a FAIL means the robot would have said the wrong thing
 * to a real person we already heard from.
 */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const replaysDir = new URL("./help-replays/", import.meta.url);
if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_BASE_URL) {
  console.log("help replay: SKIP (set ANTHROPIC_API_KEY, and no ANTHROPIC_BASE_URL, to run the real model)");
  process.exit(0);
}

const work = mkdtempSync(path.join(tmpdir(), "cardflip-helpreplay-"));
process.chdir(work);
process.once("exit", () => {
  try { rmSync(work, { recursive: true, force: true }); } catch { /* libsql may still hold the file on Windows */ }
});

const at = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { createUser, findUserById } = await import(at("lib/server/users.ts"));
const { askHelp, HELP_MODEL } = await import(at("lib/server/helpChat.ts"));
const { db } = await import(at("lib/db.ts"));

const re = (s) => (s.startsWith("(?i)") ? new RegExp(s.slice(4), "i") : new RegExp(s));
let failures = 0;
let n = 0;
console.log(`help replay on ${HELP_MODEL}`);
for (const file of readdirSync(replaysDir).filter((f) => f.endsWith(".json")).sort()) {
  const replay = JSON.parse(readFileSync(new URL(file, replaysDir), "utf8"));
  console.log(`\n# ${replay.name}`);
  const made = await createUser(`Replay ${++n}`, `replay${n}@example.com`, "hunter22");
  if (replay.user?.trialScansUsed != null) {
    await db.prepare("UPDATE users SET trial_scans_used = ? WHERE id = ?").run(replay.user.trialScansUsed, made.id);
  }
  const user = (await findUserById(made.id)) ?? made;
  for (const turn of replay.turns) {
    const reply = await askHelp(user, turn.say);
    console.log(`\n  > ${turn.say}\n  < ${reply.content.replace(/\n/g, "\n    ")}${reply.actions.length ? `\n    [${reply.actions.map((a) => a.type + (a.value ? ":" + a.value : "")).join(", ")}]` : ""}`);
    for (const m of turn.mustSay ?? []) {
      const ok = re(m).test(reply.content) || reply.actions.some((a) => re(m).test(`${a.type}:${a.value}`));
      if (!ok) failures++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  says ${m}`);
    }
    for (const m of turn.mustNotSay ?? []) {
      const ok = !re(m).test(reply.content);
      if (!ok) failures++;
      console.log(`  ${ok ? "PASS" : "FAIL"}  never says ${m}`);
    }
  }
}
console.log(failures ? `\n${failures} replay check(s) failed` : "\nAll replay checks passed");
process.exit(failures ? 1 : 0);
