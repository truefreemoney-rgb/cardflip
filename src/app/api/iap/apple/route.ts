import { NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { applyTransaction, verifyTransaction } from "@/lib/server/appleIap";
import { isAppRequest } from "@/lib/server/appSession";
import { ipGate } from "@/lib/server/rateLimitDb";
import { findUserById, toPublicUser } from "@/lib/server/users";

/**
 * The iPhone app, right after Apple's purchase sheet says done (lib/server/appleIap.ts): POST
 * { signedTransaction } = StoreKit 2's signed transaction (JWS). Checked against Apple's root, tied to the signed-in
 * account (the appAccountToken the app set is that account's id), credited once. Answers { user } so the header
 * counter shows the new scans at once; the app finishes the transaction with Apple only after a 200.
 */
export async function POST(req: Request) {
  if (!isAppRequest(req)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const limited = await ipGate(req, "iap:apple");
  if (limited) return limited;
  try {
    const user = await requireUser();
    const body = (await req.json().catch(() => null)) as { signedTransaction?: unknown } | null;
    const jws = typeof body?.signedTransaction === "string" ? body.signedTransaction : "";
    if (!jws || jws.length > 20_000) return NextResponse.json({ error: "Bad request." }, { status: 400 });
    let tx;
    try {
      tx = await verifyTransaction(jws);
    } catch (err) {
      console.warn("apple iap: transaction refused:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "That purchase couldn't be checked with Apple." }, { status: 400 });
    }
    if (tx.appAccountToken && tx.appAccountToken.toLowerCase() !== user.id.toLowerCase()) {
      return NextResponse.json({ error: "That purchase belongs to another CardFlip account." }, { status: 409 });
    }
    const out = await applyTransaction(user, tx, "app");
    if (out.result === "other_account") {
      return NextResponse.json({ error: "That subscription belongs to another CardFlip account." }, { status: 409 });
    }
    const fresh = (await findUserById(user.id)) ?? user;
    return NextResponse.json({ result: out.result, user: toPublicUser(fresh) });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
    console.error("apple iap:", err);
    return NextResponse.json({ error: "Couldn't add that purchase. Try again." }, { status: 500 });
  }
}
