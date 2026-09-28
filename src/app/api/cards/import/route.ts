import { NextResponse } from "next/server";
import { requireUser, AuthError, subscriptionGate } from "@/lib/server/auth";
import { previewImport, commitImport, MAX_CSV_BYTES } from "@/lib/server/collectionImport";

/**
 * Import from other apps (Tier 2 #12): POST { csv, commit?, omit? }.
 * commit false (default) = preview only; true = create the rows.
 * `omit` = file line numbers the seller unticked in the review.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const wall = subscriptionGate(user);
    if (wall) return wall;
    const body = await req.json().catch(() => null);
    const csv = typeof body?.csv === "string" ? body.csv : "";
    if (!csv.trim()) return NextResponse.json({ error: "Choose a CSV file first." }, { status: 400 });
    if (csv.length > MAX_CSV_BYTES) return NextResponse.json({ error: "That file is too big — split it under 1 MB." }, { status: 413 });
    const omit = Array.isArray(body?.omit) ? body.omit.filter((n: unknown): n is number => typeof n === "number") : [];
    try {
      if (body?.commit === true) {
        const result = await commitImport(user.id, csv, omit);
        return NextResponse.json({ created: result.created, cards: result.cards });
      }
      return NextResponse.json({ preview: await previewImport(csv) });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't read that file.";
      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    throw err;
  }
}
