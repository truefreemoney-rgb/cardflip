import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireAdmin, AuthError } from "@/lib/server/auth";
import { MAGIC_PUBLIC_KEY, magicPublic, setSetting } from "@/lib/server/settings";

/** Admin console switches. GET reads them; PATCH flips the ones in the body. */
export async function GET() {
  try {
    await requireAdmin();
    return NextResponse.json({ magicPublic: await magicPublic() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    throw err;
  }
}

export async function PATCH(req: Request) {
  try {
    await requireAdmin();
    const body = await req.json().catch(() => null);
    if (typeof body?.magicPublic === "boolean") {
      await setSetting(MAGIC_PUBLIC_KEY, body.magicPublic ? "1" : "0");
      // The public pages (landing, /help, /terms, /privacy, metadata, OG image)
      // are statically cached — the landing for a day. Bust everything so the
      // flip is visible at once (09-05: Chris flipped it and the site kept
      // saying Magic).
      revalidatePath("/", "layout");
    } else {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }
    return NextResponse.json({ magicPublic: await magicPublic() });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: 403 });
    console.error("settings patch failed:", err);
    return NextResponse.json({ error: "Couldn't save the setting" }, { status: 500 });
  }
}
