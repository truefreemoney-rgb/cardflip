import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/server/password";

export type Role = "user" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  ebayConnected: boolean;
  createdAt: number;
}

interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  ebay_connected: number;
  created_at: number;
}

function fromRow(row: UserRow): User {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    passwordHash: row.password_hash,
    role: row.role,
    ebayConnected: row.ebay_connected === 1,
    createdAt: row.created_at,
  };
}

export function findUserByEmail(email: string): User | null {
  const row = db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email.trim().toLowerCase()) as UserRow | undefined;
  return row ? fromRow(row) : null;
}

export function findUserById(id: string): User | null {
  const row = db.prepare("SELECT * FROM users WHERE id = ?").get(id) as
    | UserRow
    | undefined;
  return row ? fromRow(row) : null;
}

export function createUser(
  name: string,
  email: string,
  password: string,
  role: Role = "user",
): User {
  const id = randomUUID();
  const createdAt = Date.now();
  const passwordHash = hashPassword(password);
  const normalizedEmail = email.trim().toLowerCase();

  db.prepare(
    `INSERT INTO users (id, name, email, password_hash, role, ebay_connected, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  ).run(id, name.trim(), normalizedEmail, passwordHash, role, createdAt);

  return {
    id,
    name: name.trim(),
    email: normalizedEmail,
    passwordHash,
    role,
    ebayConnected: false,
    createdAt,
  };
}

/**
 * The shared "Try it now" account. It's public and wiped on every entry, so
 * it must never hold anything personal — in particular it can't be linked to
 * a real eBay account (the tokens would be usable by the next visitor).
 */
export const DEMO_EMAIL = "demo@cardflip.dev";

export function isDemoUser(user: Pick<User, "email">): boolean {
  return user.email === DEMO_EMAIL;
}

export function setEbayConnected(userId: string, connected: boolean): void {
  db.prepare("UPDATE users SET ebay_connected = ? WHERE id = ?").run(
    connected ? 1 : 0,
    userId,
  );
}

export function setUserRole(userId: string, role: Role): void {
  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, userId);
}

export function listAllUsers(): User[] {
  const rows = db
    .prepare("SELECT * FROM users ORDER BY created_at DESC")
    .all() as unknown as UserRow[];
  return rows.map(fromRow);
}

export function countUsers(): number {
  const row = db.prepare("SELECT COUNT(*) as n FROM users").get() as {
    n: number;
  };
  return row.n;
}

export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  ebayConnected: boolean;
  createdAt: number;
}

/** Strips the password hash before a user record ever reaches the client. */
export function toPublicUser(user: User): PublicUser {
  const { id, name, email, role, ebayConnected, createdAt } = user;
  return { id, name, email, role, ebayConnected, createdAt };
}
