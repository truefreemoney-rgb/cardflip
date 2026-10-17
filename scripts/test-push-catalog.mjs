// push-catalog sends only rows that changed (task #23, 10-17). Runs the real
// script against a throwaway SQLite file standing in for Turso, with its own
// fingerprint state. Needs data/cardflip.db (the local mirror). No network.
//   node scripts/test-push-catalog.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = process.cwd();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "push-catalog-"));
const remotePath = path.join(dir, "remote.db");
const statePath = path.join(dir, "state.db");
const TABLE = "mtg_sets";
const local = new DatabaseSync(path.join(root, "data", "cardflip.db"), { readOnly: true });
const localCount = local.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get().n;
const remote = new DatabaseSync(remotePath);
remote.exec(local.prepare("SELECT sql FROM sqlite_master WHERE name = ?").get(TABLE).sql);

const run = () =>
  execFileSync(process.execPath, ["scripts/push-catalog.mjs", "--only", TABLE], {
    env: { ...process.env, TURSO_DATABASE_URL: `file:${remotePath.replace(/\\/g, "/")}`, TURSO_AUTH_TOKEN: "x", CATALOG_PUSH_STATE: statePath },
    encoding: "utf8",
  });
const remoteCount = () => remote.prepare(`SELECT COUNT(*) AS n FROM ${TABLE}`).get().n;

let out = run();
assert.match(out, new RegExp(`pushing ${localCount} changed of ${localCount}`), "empty remote: every row goes up");
assert.equal(remoteCount(), localCount);

out = run();
assert.match(out, /up to date/, "nothing new: skipped before any hashing");

// The nightly case: the sync re-stamps synced_at, content unchanged.
remote.exec(`UPDATE ${TABLE} SET synced_at = 0`);
out = run();
assert.match(out, /no changed rows/, "re-stamped but unchanged rows are not resent");

// Fingerprints lost for 3 rows (or 3 local rows changed): exactly those go up.
const state = new DatabaseSync(statePath);
state.exec("DELETE FROM pushed WHERE rowid IN (SELECT rowid FROM pushed LIMIT 3)");
out = run();
assert.match(out, new RegExp(`pushing 3 changed of ${localCount}`), "only the changed rows");

// Turso lost rows the state thinks it has: push all once.
remote.exec(`DELETE FROM ${TABLE} WHERE rowid IN (SELECT rowid FROM ${TABLE} LIMIT 5)`);
out = run();
assert.match(out, /rows short but only 0 changed: pushing all/, "remote short: full push");
assert.equal(remoteCount(), localCount);

remote.close();
state.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log("test:push-catalog ok");
