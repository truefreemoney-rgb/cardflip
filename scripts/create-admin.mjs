#!/usr/bin/env node
// Creates (or promotes) an admin account directly in the app's SQLite file.
// Usage:
//   npm run admin
//   npm run admin -- you@example.com "your password" "Your Name"

import { DatabaseSync } from "node:sqlite";
import { randomBytes, randomUUID, scryptSync } from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const [, , emailArg, passwordArg, nameArg] = process.argv;

const email = (emailArg ?? "admin@cardflip.dev").trim().toLowerCase();
const password = passwordArg ?? randomBytes(9).toString("base64url");
const name = nameArg ?? "Admin";
const generatedPassword = !passwordArg;

const dataDir = path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(path.join(dataDir, "cardflip.db"));

// Mirrors src/lib/db.ts — kept in sync so this script works even if the app
// has never been started yet (nothing to seed an admin into otherwise).
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    ebay_connected INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
`);

function hashPassword(plain) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(plain, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

const existing = db.prepare("SELECT id, role FROM users WHERE email = ?").get(email);

if (existing) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ?").run(existing.id);
  if (passwordArg) {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
      hashPassword(password),
      existing.id,
    );
  }
  console.log(`\nPromoted existing account to admin: ${email}`);
  if (passwordArg) console.log("Password updated to the one you provided.");
} else {
  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, ebay_connected, created_at)
     VALUES (?, ?, ?, ?, 'admin', 0, ?)`,
  ).run(randomUUID(), name, email, hashPassword(password), Date.now());
  console.log(`\nCreated new admin account: ${email}`);
}

console.log(`Password:  ${password}${generatedPassword ? "  (generated — save this)" : ""}`);
console.log(`\nStart the app (npm run dev), log in at http://localhost:3000/login,`);
console.log(`then open http://localhost:3000/admin\n`);

db.close();
