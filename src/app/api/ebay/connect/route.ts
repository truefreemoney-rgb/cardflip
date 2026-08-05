import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { setEbayConnected } from "@/lib/server/users";

export async function POST() {
  try {
    const user = await requireUser();
    // Real flow: exchange an OAuth code from eBay for tokens here. There's
    // no eBay developer app registered yet, so this just flips the flag.
    setEbayConnected(user.id, true);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
