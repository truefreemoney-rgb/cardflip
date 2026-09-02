import { NextResponse } from "next/server";
import { requireUser, AuthError } from "@/lib/server/auth";
import { isDemoUser } from "@/lib/server/users";
import { dayBudgetSpent } from "@/lib/server/dayBudget";
import { LIMITS, limitOrRespond } from "@/lib/server/rateLimit";
import { lookupPsaCert, psaConfigured, PsaApiError, PsaCertNotFound } from "@/lib/server/psa";

/**
 * Verify a PSA slab by cert number. Both budgets guard PSA's 100/day tier.
 *
 * The daily budget is a DATABASE counter (dayBudget.ts — the pattern was
 * born here): on serverless the in-memory count resets with every cold start
 * and doesn't span instances, so it never actually bound — which is how the
 * 100/day PSA quota kept burning mysteriously (09-01, 09-02) while we made a
 * handful of calls. The other leak was the shared demo account: a public
 * one-click login that bots can walk through, now refused here (the demo has
 * no slabs to verify).
 */
const PSA_DAILY_BUDGET = 80;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ cert: string }> },
) {
  try {
    const user = await requireUser();
    if (isDemoUser(user)) {
      return NextResponse.json({ error: "The demo account can't verify certs — sign up to use PSA lookup." }, { status: 403 });
    }
    if (!psaConfigured()) {
      return NextResponse.json({ error: "PSA lookup isn't configured" }, { status: 503 });
    }
    const { cert } = await params;
    const certNumber = cert.trim();
    if (!/^\d{5,12}$/.test(certNumber)) {
      return NextResponse.json({ error: "That doesn't look like a PSA cert number" }, { status: 400 });
    }
    const limited = limitOrRespond(`psa:${user.id}`, LIMITS.psaCert);
    if (limited) return limited;
    if (await dayBudgetSpent("psa_calls", PSA_DAILY_BUDGET)) {
      return NextResponse.json(
        { error: "Today's PSA lookup budget is used up — try again tomorrow." },
        { status: 429 },
      );
    }

    const result = await lookupPsaCert(certNumber);
    return NextResponse.json({ cert: result });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof PsaCertNotFound) {
      return NextResponse.json({ error: "PSA has no cert with that number" }, { status: 404 });
    }
    if (err instanceof PsaApiError) {
      // 500 from PSA is how an invalid/truncated token presents.
      const hint = err.status === 500 ? "PSA rejected our API token" : `PSA answered ${err.status}`;
      return NextResponse.json({ error: `${hint} — lookup unavailable` }, { status: 502 });
    }
    console.warn("PSA cert lookup failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "PSA lookup failed — try again" }, { status: 502 });
  }
}
