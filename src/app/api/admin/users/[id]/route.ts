import { NextResponse } from "next/server";
import { requireAdminOwner, AuthError } from "@/lib/server/auth";
import { OWNER_EMAIL, deleteUser, findUserById } from "@/lib/server/users";
import { cancelAllSubscriptions } from "@/lib/server/stripe";
import { adminAuthResponse } from "@/lib/server/adminGate";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Admin: delete an account and everything under it (cards, wishlist, sessions cascade). */
export async function DELETE(_req: Request, { params }: RouteParams) {
  try {
    await requireAdminOwner();
    const { id } = await params;
    const user = await findUserById(id);
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
    // The owner's own account is never deleted from the console (review 10-19 admin #31: only a client confirm stood guard).
    if (user.email.toLowerCase() === OWNER_EMAIL) return NextResponse.json({ error: "The owner account can't be deleted here" }, { status: 400 });
    // A deleted account cannot cancel its own plan: stop the billing first, or refuse.
    try {
      await cancelAllSubscriptions(user.stripeCustomerId, user.stripeSubscriptionId);
    } catch (err) {
      console.error("admin delete: subscription cancel failed:", err);
      return NextResponse.json({ error: "Couldn't cancel this user's Stripe subscription, so nothing was deleted. Try again or cancel it in Stripe first." }, { status: 502 });
    }
    await deleteUser(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) return adminAuthResponse(err);
    console.error("delete user failed:", err);
    return NextResponse.json({ error: "Couldn't delete the user" }, { status: 500 });
  }
}
