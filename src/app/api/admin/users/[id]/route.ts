import { NextResponse } from "next/server";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { deleteUser, findUserById, isDemoUser } from "@/lib/server/users";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Admin: delete an account and everything under it (cards, wishlist, sessions cascade). */
export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    await requireAdmin();
    const { id } = await params;
    const user = await findUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (isDemoUser(user)) return NextResponse.json({ error: "The demo account can't be deleted." }, { status: 400 });
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("delete user failed:", err);
    return NextResponse.json({ error: "Couldn't delete the user" }, { status: 500 });
  }
}
