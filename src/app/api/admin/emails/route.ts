import { NextResponse } from "next/server";
import { requireAdminOwner, AuthError } from "@/lib/server/auth";
import { CAMPAIGN_IDS, VARIANT_KEYS, campaignOverview, sendCampaignTest, setCampaignsOn, sweepCampaigns, type CampaignId, type VariantKey } from "@/lib/server/campaigns";
import { isMailConfigured } from "@/lib/server/mail";
import { OWNER_EMAIL } from "@/lib/server/users";

/**
 * The weekly mails (lib/server/campaigns.ts), owner only.
 * GET = the overview. PATCH `{ on: boolean }` = the switch.
 * POST `{ test: <variant key> }` mails that version to the owner (works while off);
 * POST `{ runNow: <campaign id> }` sends that mail to everyone due now, ignoring the day and hour (needs the switch on, still capped).
 */
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function fail(err: unknown, what: string) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
  console.error(`admin emails ${what} failed:`, err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Something went wrong" }, { status: 500 });
}

export async function GET() {
  try {
    await requireAdminOwner();
    return NextResponse.json(await campaignOverview());
  } catch (err) {
    return fail(err, "read");
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdminOwner();
    const body = await req.json().catch(() => null);
    if (typeof body?.on !== "boolean") return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    if (body.on && !isMailConfigured()) return NextResponse.json({ error: "Email isn't set up on this server" }, { status: 400 });
    await setCampaignsOn(body.on);
    return NextResponse.json({ on: body.on });
  } catch (err) {
    return fail(err, "switch");
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminOwner();
    const body = await req.json().catch(() => null);
    if (typeof body?.test === "string") {
      if (!(VARIANT_KEYS as readonly string[]).includes(body.test)) return NextResponse.json({ error: "Unknown email" }, { status: 400 });
      await sendCampaignTest(body.test as VariantKey, OWNER_EMAIL);
      return NextResponse.json({ ok: true, to: OWNER_EMAIL });
    }
    if (typeof body?.runNow === "string" && (CAMPAIGN_IDS as readonly string[]).includes(body.runNow)) {
      return NextResponse.json(await sweepCampaigns(Date.now(), { force: true, only: body.runNow as CampaignId }));
    }
    return NextResponse.json({ error: "Nothing to do" }, { status: 400 });
  } catch (err) {
    return fail(err, "send");
  }
}
