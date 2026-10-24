// Garbled text guard: no tracked source file may hold UTF-8 that was read as Windows-1252 and
// saved back (a middle dot turns into "A-circumflex + dot", e-acute into "A-tilde + copyright").
// Review batch 2 (cbbd3c71, 10-22) did that to four files and the admin Overview printed the
// garbled "Pokemon . Magic" for two days: tsc, tests and the smoke all passed because it is only
// display text. Chris 10-24: "how did that slip through".
//   node scripts/test-mojibake.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { extname } from "node:path";

const TEXT = new Set([".ts", ".tsx", ".mjs", ".js", ".cjs", ".css", ".yml", ".yaml"]);

// A UTF-8 lead byte read as cp1252 (U+00C2..U+00F4) followed by a continuation byte read as
// cp1252 (0x80-0xBF: the C1 specials cp1252 maps to curly quotes, dashes, the euro sign...,
// then U+00A0..U+00BF). Escapes only, so this file never matches itself.
const CONT = "\u20ac\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u017d\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u017e\u0178\u00a0-\u00bf";
const GARBLED = new RegExp(`[\u00c2-\u00f4][${CONT}]`, "g");
// The byte-order mark read as cp1252: scripts strip it on purpose (.replace(/^...BOM.../, "")).
const BOM_AS_CP1252 = "\u00ef\u00bb\u00bf";
const garbledAt = (line) => {
  for (const m of line.matchAll(GARBLED)) {
    if (line.startsWith(BOM_AS_CP1252, m.index) || line.startsWith(BOM_AS_CP1252, m.index - 1)) continue;
    return m.index;
  }
  return -1;
};

let failed = 0;
let files = 0;
const tracked = execFileSync("git", ["ls-files", "src", "scripts", ".github"], { encoding: "utf8" }).split("\n").filter(Boolean);
for (const path of tracked) {
  if (!TEXT.has(extname(path))) continue;
  files++;
  readFileSync(path, "utf8").split("\n").forEach((line, i) => {
    const at = garbledAt(line);
    if (at < 0) return;
    failed++;
    console.log(`  FAIL  ${path}:${i + 1}: garbled "${line.slice(Math.max(0, at - 20), at + 20).trim()}"`);
  });
}

// The pattern itself: garbled text is caught, real accents and symbols are not.
const check = (label, got, want) => {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
};
check("catches a garbled middle dot", garbledAt("276 \u00c2\u00b7 1,846") >= 0, true);
check("catches a garbled e-acute", garbledAt("Pok\u00c3\u00a9mon") >= 0, true);
check("catches a garbled em dash", garbledAt("a \u00e2\u20ac\u201d b") >= 0, true);
check("catches a garbled times sign", garbledAt("\u00c3\u2014 2") >= 0, true);
check("catches a garbled arrow", garbledAt("url \u00e2\u2020\u2019 404") >= 0, true);
check("leaves real e-acute, dot, dash, times, arrow alone", garbledAt("Pok\u00e9mon \u00b7 \u2014 \u00d7 \u2192"), -1);
check("leaves the byte-order-mark strip alone", garbledAt(`.replace(/^${BOM_AS_CP1252}/, "")`), -1);

console.log(failed ? `\n${failed} problem(s) in ${files} files` : `\nno garbled text in ${files} files`);
process.exit(failed ? 1 : 0);
