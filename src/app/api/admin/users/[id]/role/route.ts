import { NextResponse } from "next/server";
import { requireAdminOwner } from "@/lib/server/auth";
import { adminFailure } from "@/lib/server/adminGate";
import { OWNER_EMAIL, findUserById, setUserRole, toPublicUser, type Role } from "@/lib/server/users";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: Request, { params }: RouteParams) {
  try {
    await requireAdminOwner();
    const { id } = await params;
    const body = await req.json().catch(() => null);
    const role: Role | undefined =
      body?.role === "admin" || body?.role === "user" ? body.role : undefined;

    if (!role) {
      return NextResponse.json({ error: "role must be 'admin' or 'user'" }, { status: 400 });
    }

    // The owner stays admin: demoting it from the console would lock the owner out of it (review 10-19 admin #31).
    const target = await findUserById(id);
    if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
    if (role !== "admin" && target.email.toLowerCase() === OWNER_EMAIL) {
      return NextResponse.json({ error: "The owner account stays admin" }, { status: 400 });
    }

    await setUserRole(id, role);
    const updated = await findUserById(id);
    if (!updated) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    return NextResponse.json({ user: toPublicUser(updated) });
  } catch (err) {
    return adminFailure(err);
  }
}
