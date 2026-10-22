import "server-only";
import { NextResponse } from "next/server";
import { AuthError } from "@/lib/server/auth";

/**
 * The JSON catch-all for the signed-in user routes (cards, wishlist, price
 * checks, live prices). 10-22: a non-auth error used to be rethrown into
 * Next's HTML 500 page, which the app's fetch().json() then choked on.
 * Same shape as adminFailure() in adminGate.ts.
 */
export function apiFailure(err: unknown): NextResponse {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  console.error("api route failed:", err);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}
