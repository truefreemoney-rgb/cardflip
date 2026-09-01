import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { LIMITS, limitOrRespond } from "@/lib/server/rateLimit";
import { lookupPsaCert, psaConfigured, PsaCertNotFound } from "@/lib/server/psa";

/** Verify a PSA slab by cert number. Both budgets guard PSA's 100/day tier. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cert: string }> },
) {
  try {
    const user = await requireUser();
    if (!psaConfigured()) {
      return NextResponse.json({ error: "PSA lookup isn't configured" }, { status: 503 });
    }
    const { cert } = await params;
    const certNumber = cert.trim();
    if (!/^\d{5,12}$/.test(certNumber)) {
      return NextResponse.json({ error: "That doesn't look like a PSA cert number" }, { status: 400 });
    }
    const limited =
      limitOrRespond(`psa:${user.id}`, LIMITS.psaCert) ??
      limitOrRespond("psa:global", LIMITS.psaCertGlobal);
    if (limited) return limited;

    const result = await lookupPsaCert(certNumber);
    return NextResponse.json({ cert: result });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof PsaCertNotFound) {
      return NextResponse.json({ error: "PSA has no cert with that number" }, { status: 404 });
    }
    console.warn("PSA cert lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "PSA lookup failed — try again" }, { status: 502 });
  }
}
