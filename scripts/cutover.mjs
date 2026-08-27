// Fly -> Vercel cutover driver. Reads .env.migration.json (BOM-tolerant) so the
// Turso credentials never pass through a shell, then inspects the database or
// runs the seed / photo-migration scripts against it.
//
//   node scripts/cutover.mjs inspect
//   node scripts/cutover.mjs seed <snapshot.db>
//   node scripts/cutover.mjs photos <photoDir> [--dry-run]
//
// Delete once the migration is finished.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "@libsql/client";

const REPO = process.cwd();
const cfg = JSON.parse(
  fs.readFileSync(path.join(REPO, ".env.migration.json"), "utf8").replace(/^﻿/, "")
);
const env = {
  ...process.env,
  TURSO_DATABASE_URL: cfg.dbUrl,
  TURSO_AUTH_TOKEN: cfg.dbToken,
};

const mode = process.argv[2];

// Host only — never the token.
console.log("turso host:", String(cfg.dbUrl).replace(/^libsql:\/\//, "").split("?")[0]);

async function inspect() {
  const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  const tables = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const names = tables.rows.map((r) => r.name);
  console.log(`${names.length} tables`);
  for (const t of names) {
    const r = await db.execute(`SELECT COUNT(*) AS n FROM "${t}"`);
    const n = Number(r.rows[0].n);
    if (n > 0) console.log(`  ${String(t).padEnd(28)} ${n}`);
  }
  try {
    const u = await db.execute("SELECT email, role FROM users ORDER BY email");
    console.log(`users (${u.rows.length}):`);
    for (const row of u.rows) console.log(`  ${row.email}  role=${row.role ?? ""}`);
  } catch {
    console.log("  (no users table)");
  }
}

function run(script, args, extraEnv) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(REPO, "scripts", script), ...args], {
      cwd: REPO,
      env: { ...env, ...extraEnv },
      stdio: "inherit",
    });
    p.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`))
    );
  });
}

// Copy the admin row's password hash out of a local snapshot into Turso, so the
// password is set without re-implementing the app's scrypt format here.
async function syncAdmin(snapshotPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const local = new DatabaseSync(path.resolve(snapshotPath), { readOnly: true });
  const row = local
    .prepare("SELECT id, name, email, password_hash, role, created_at FROM users WHERE email = ?")
    .get("admin@cardflip.dev");
  if (!row) throw new Error("admin@cardflip.dev not found in " + snapshotPath);

  const db = createClient({ url: cfg.dbUrl, authToken: cfg.dbToken });
  const existing = await db.execute({
    sql: "SELECT id FROM users WHERE email = ?",
    args: ["admin@cardflip.dev"],
  });

  if (existing.rows.length > 0) {
    await db.execute({
      sql: "UPDATE users SET password_hash = ?, role = 'admin' WHERE email = ?",
      args: [row.password_hash, "admin@cardflip.dev"],
    });
    console.log("admin password updated on turso");
  } else {
    await db.execute({
      sql: "INSERT INTO users (id, name, email, password_hash, role, ebay_connected, created_at) VALUES (?, ?, ?, ?, 'admin', 0, ?)",
      args: [row.id, row.name, row.email, row.password_hash, row.created_at],
    });
    console.log("admin created on turso");
  }
}

if (mode === "inspect") {
  await inspect();
} else if (mode === "admin") {
  await syncAdmin(process.argv[3]);
} else if (mode === "go") {
  // Everything still outstanding: photos into card_photos, then the admin password.
  await run("migrate-photos.mjs", [], { PHOTO_SOURCE: path.resolve(process.argv[3]) });
  await syncAdmin(process.argv[4]);
  console.log("\n--- cutover writes complete ---");
  await inspect();
} else if (mode === "seed") {
  const src = path.resolve(process.argv[3]);
  console.log("seeding from:", src);
  await run("seed-turso.mjs", ["--wipe"], { SEED_SOURCE: src });
} else if (mode === "photos") {
  const dir = path.resolve(process.argv[3]);
  const dry = process.argv.includes("--dry-run") ? ["--dry-run"] : [];
  console.log("photos from:", dir);
  await run("migrate-photos.mjs", dry, { PHOTO_SOURCE: dir });
} else {
  console.error(
    "usage: cutover.mjs inspect | go <photoDir> <snapshot.db> | admin <snapshot.db> | seed <db> | photos <dir> [--dry-run]"
  );
  process.exit(1);
}
