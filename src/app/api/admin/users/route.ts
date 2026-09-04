import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { createUser, findUserByEmail, toPublicUser, type Role } from "@/lib/server/users";

/**
 * Admin: create an account by hand (Chris, 09-04: "add new accounts from
 * the admin panel"). Same validation as public signup; no session is
 * issued — the admin hands the password (or a reset link) to the person.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    const name = typeof body?.name === "string" ? body.name.trim() : "";
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const role: Role = body?.role === "admin" ? "admin" : "user";

    if (!name || name.length > 80) return NextResponse.json({ error: "Name is required (1–80 characters)." }, { status: 400 });
    if (!/^\S+@\S+\.\S+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
    if (password.length < 6) return NextResponse.json({ error: "Password must be at least 6 characters." }, { status: 400 });
    if (await findUserByEmail(email)) return NextResponse.json({ error: "An account with that email already exists." }, { status: 409 });

    const user = await createUser(name, email, password, role);
    return NextResponse.json({ user: toPublicUser(user) }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("create user failed:", err);
    return NextResponse.json({ error: "Couldn't create the account" }, { status: 500 });
  }
}
