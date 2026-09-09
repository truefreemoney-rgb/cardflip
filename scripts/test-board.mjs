/**
 * docs/BOARD.md parser (lib/server/board.ts). Run: npm run test:board
 * Pins the shape the admin console relies on, and that the real file parses
 * into non-empty sections with owner tags.
 */
import { readFileSync } from "node:fs";
const { parseBoard } = await import(new URL("../src/lib/server/board.ts", import.meta.url).href);

let failures = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : `\n         got      ${JSON.stringify(actual)}\n         expected ${JSON.stringify(expected)}`}`);
}

const sample = `# Board\nintro\n\n## Now — current main tasks\n- [ ] [Chris] Do the thing\n- [x] [Claude] Done **bold** thing\n\n## Future ideas\n- [ ] Untagged idea\n`;
const s = parseBoard(sample);
check("two sections", s.map((x) => x.title), ["Now", "Future ideas"]);
check("hint after the dash", s[0].hint, "current main tasks");
check("owner tag + text", s[0].items[0], { done: false, owner: "Chris", text: "Do the thing" });
check("done + bold stripped", s[0].items[1], { done: true, owner: "Claude", text: "Done bold thing" });
check("untagged item", s[1].items[0], { done: false, owner: null, text: "Untagged idea" });

const real = parseBoard(readFileSync(new URL("../docs/BOARD.md", import.meta.url), "utf8"));
check("real board has the core categories", ["Now", "Chris", "Claude", "Future ideas"].every((t) => real.some((x) => x.title === t)), true);
check("every OPEN real item carries an owner tag", real.flatMap((x) => x.items).filter((i) => !i.done).every((i) => i.owner !== null), true);

console.log(failures === 0 ? "\nAll board checks passed." : `\n${failures} board check(s) FAILED.`);
process.exitCode = failures === 0 ? 0 : 1;
