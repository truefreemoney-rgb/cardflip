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

// 10-23 (Turso rows written, $1 per million): rows go up in place, tcg prices take a two-column UPDATE,
// and mtg prices (prod's own daily job) ride only on a row's first push. A 40-row stand-in mirror of each.
{
  const mirrorPath = path.join(dir, "mirror.db");
  const mirror = new DatabaseSync(mirrorPath);
  for (const t of ["mtg_cards", "tcg_cards"]) {
    const ddl = local.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t).sql;
    mirror.exec(ddl);
    remote.exec(ddl);
    const cols = local.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    const ins = mirror.prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
    for (const r of local.prepare(`SELECT * FROM ${t} WHERE price_usd IS NOT NULL LIMIT 40`).all()) ins.run(...cols.map((c) => r[c] ?? null));
  }
  const runT = (table) =>
    execFileSync(process.execPath, ["scripts/push-catalog.mjs", "--only", table], {
      env: { ...process.env, TURSO_DATABASE_URL: `file:${remotePath.replace(/\\/g, "/")}`, TURSO_AUTH_TOKEN: "x", CATALOG_PUSH_STATE: statePath, CATALOG_PUSH_LOCAL: mirrorPath },
      encoding: "utf8",
    });
  const [tcgId, mtgId] = [mirror.prepare("SELECT id FROM tcg_cards LIMIT 1").get().id, mirror.prepare("SELECT id FROM mtg_cards LIMIT 1").get().id];
  const at = (t, id) => remote.prepare(`SELECT rowid AS rid, name, price_usd FROM ${t} WHERE id = ?`).get(id);

  assert.match(runT("tcg_cards"), /pushing 40 changed of 40/, "tcg: first push sends every row");
  assert.match(runT("mtg_cards"), /pushing 40 changed of 40/, "mtg: first push sends every row, prices included");
  const tcg0 = at("tcg_cards", tcgId), mtg0 = at("mtg_cards", mtgId);
  assert.ok(mtg0.price_usd != null, "a new mtg row arrives with its price");

  mirror.exec(`UPDATE tcg_cards SET price_usd = 123.45, synced_at = synced_at + 1 WHERE id = '${tcgId}'`);
  assert.match(runT("tcg_cards"), /pushing 1 changed of 40 rows \(remote has 40; 1 price-only/, "tcg: a price change goes up alone");
  assert.deepEqual([at("tcg_cards", tcgId).price_usd, at("tcg_cards", tcgId).rid], [123.45, tcg0.rid], "…as a two-column update in place");

  // 10-25: a price the local mirror lacks (blank, or a feed's $0) never replaces prod's (prod's 5am crons
  // priced it), on either path, and a real local price still replaces prod's.
  const tcgAt = (id) => {
    const r = remote.prepare("SELECT name, price_usd, price_usd_foil FROM tcg_cards WHERE id = ?").get(id);
    return [r.name, r.price_usd, r.price_usd_foil];
  };
  remote.exec(`UPDATE tcg_cards SET price_usd_foil = 8.88 WHERE id = '${tcgId}'`); // prod's cron priced the foil
  mirror.exec(`UPDATE tcg_cards SET price_usd = 0, price_usd_foil = NULL, synced_at = synced_at + 1 WHERE id = '${tcgId}'`);
  assert.match(runT("tcg_cards"), /pushing 1 changed of 40 rows \(remote has 40; 1 price-only/, "tcg: a blanked local price is a price-only change");
  assert.deepEqual(tcgAt(tcgId).slice(1), [123.45, 8.88], "…that never blanks prod's prices");
  mirror.exec(`UPDATE tcg_cards SET name = 'Renamed', synced_at = synced_at + 1 WHERE id = '${tcgId}'`);
  assert.match(runT("tcg_cards"), /pushing 1 changed of 40 rows \(remote has 40; 0 price-only/, "tcg: a real change with no local price goes up whole");
  assert.deepEqual(tcgAt(tcgId), ["Renamed", 123.45, 8.88], "…and keeps prod's prices too");
  mirror.exec(`UPDATE tcg_cards SET price_usd = 4.56, synced_at = synced_at + 1 WHERE id = '${tcgId}'`);
  assert.match(runT("tcg_cards"), /1 price-only/);
  assert.deepEqual(tcgAt(tcgId), ["Renamed", 4.56, 8.88], "a real local price still replaces prod's (price-only)");
  mirror.exec(`UPDATE tcg_cards SET name = 'Renamed again', price_usd_foil = 9.99, synced_at = synced_at + 1 WHERE id = '${tcgId}'`);
  assert.match(runT("tcg_cards"), /0 price-only/);
  assert.deepEqual(tcgAt(tcgId), ["Renamed again", 4.56, 9.99], "…and on a whole-row update");

  remote.exec(`UPDATE mtg_cards SET price_usd = 7.77 WHERE id = '${mtgId}'`); // prod's daily job priced it
  mirror.exec(`UPDATE mtg_cards SET price_usd = 999, synced_at = synced_at + 1 WHERE id = '${mtgId}'`);
  assert.match(runT("mtg_cards"), /no changed rows \(40 rows, 1 fingerprints relabelled\)/, "mtg: a price-only change is never pushed");
  mirror.exec(`UPDATE mtg_cards SET name = 'Renamed', synced_at = synced_at + 1 WHERE id = '${mtgId}'`);
  assert.match(runT("mtg_cards"), /pushing 1 changed of 40/, "mtg: a real change goes up");
  assert.deepEqual([at("mtg_cards", mtgId).name, at("mtg_cards", mtgId).price_usd, at("mtg_cards", mtgId).rid], ["Renamed", 7.77, mtg0.rid], "…in place, keeping prod's price");
  mirror.close();
}

remote.close();
state.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log("test:push-catalog ok");
