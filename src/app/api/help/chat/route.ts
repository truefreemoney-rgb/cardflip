import { NextRequest, NextResponse } from "next/server";
import { AuthError, requireUser } from "@/lib/server/auth";
import { LIMITS, clientIp, limitOrRespond } from "@/lib/server/rateLimit";
import { HELP_DAILY_CAP, HelpCapError, HelpNotConfiguredError, askHelp, clearHelpHistory, helpHistory } from "@/lib/server/helpChat";

/**
 * The help robot's chat. Signed-in only. GET = the seller's rolling
 * conversation, POST {message} = ask (reply comes back in the same request),
 * DELETE = start over.
 */

function unauthorized(err: unknown) {
  if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 401 });
  throw err;
}

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ messages: await helpHistory(user.id), dailyCap: HELP_DAILY_CAP });
  } catch (err) {
    return unauthorized(err);
  }
}

export async function POST(req: NextRequest) {
  const limited = limitOrRespond(`help:${clientIp(req)}`, LIMITS.helpChat);
  if (limited) return limited;
  try {
    const user = await requireUser();
    const body = await req.json().catch(() => ({}));
    const message = typeof body?.message === "string" ? body.message.trim() : "";
    if (!message) return NextResponse.json({ error: "Say something first" }, { status: 400 });
    try {
      const reply = await askHelp(user, message);
      return NextResponse.json({ reply });
    } catch (err) {
      if (err instanceof HelpCapError) {
        return NextResponse.json({ error: `That's ${HELP_DAILY_CAP} questions today. I need to recharge. Email support@cardflip.io.` }, { status: 429 });
      }
      if (err instanceof HelpNotConfiguredError) {
        return NextResponse.json({ error: "The robot is offline here. Email support@cardflip.io." }, { status: 503 });
      }
      throw err;
    }
  } catch (err) {
    return unauthorized(err);
  }
}

export async function DELETE() {
  try {
    const user = await requireUser();
    await clearHelpHistory(user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return unauthorized(err);
  }
}
