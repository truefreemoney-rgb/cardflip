import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { AuthError, requireAdminOwner } from "@/lib/server/auth";
import { fixSeriesNow, isOffCheck, putCheck, retireCheck, storedRaw } from "@/lib/server/checkedPrices";
import { dropCardLists, loadCardRecord } from "@/lib/server/cardPages";
import { cardPath } from "@/lib/cardPages";
import { setMark, slotAt } from "@/lib/server/postCheck";
import { dispatchTiktokRender } from "@/lib/server/socialTiktok";
import type { Slot } from "@/lib/server/socialPublish";
import { todayUtc } from "@/lib/priceSeries";
import type { GameId } from "@/lib/types";
import { adminAuthResponse } from "@/lib/server/adminGate";

/**
 * /api/admin/post-check (owner only, /admin/prices "Post cards", 10-18).
 * POST { action, game, cardId, variant, day, slot, usd?, n?, label? }
 *  - "ok": the eBay sold check agrees with the price (a mark for the day).
 *  - "fix": eBay sold says `usd` (from `n` sales): the price is fixed everywhere
 *    (checkedPrices.ts), its card page rebuilt, and the slot's video remade
 *    when it has not posted yet (it now shows the checked price with no %, or
 *    sits out of a change post).
 *  - "undo": drop the mark, or retire a fix made by mistake.
 */
export const dynamic = "force-dynamic";

const GAMES: ReadonlySet<string> = new Set(["pokemon", "mtg", "lorcana", "onepiece", "yugioh"]);
const SLOT_NAMES: ReadonlySet<string> = new Set(["morning", "midday", "evening"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The card page shows a fix at once (it is otherwise cached for two days). Best effort. */
async function rebuildPage(game: GameId, cardId: string): Promise<void> {
  try {
    await dropCardLists(game, cardId);
    const rec = await loadCardRecord(game, cardId);
    if (rec) revalidatePath(cardPath(game, rec.facts.setSlug, rec.facts.name, rec.facts.key));
  } catch (err) {
    console.warn(`post check: could not rebuild the page of ${game} ${cardId}`, err);
  }
}

export async function POST(req: Request) {
  try {
    await requireAdminOwner();
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const action = b?.action;
    const game = typeof b?.game === "string" && GAMES.has(b.game) ? (b.game as GameId) : null;
    const cardId = typeof b?.cardId === "string" ? b.cardId.slice(0, 120) : "";
    const variant = typeof b?.variant === "string" ? b.variant.slice(0, 40) : "";
    const day = typeof b?.day === "string" && DAY.test(b.day) ? b.day : "";
    const slot = typeof b?.slot === "string" && SLOT_NAMES.has(b.slot) ? (b.slot as Slot) : null;
    if (!game || !cardId || !variant || !day || !slot || !["ok", "fix", "undo"].includes(String(action))) {
      return NextResponse.json({ error: "Bad request" }, { status: 400 });
    }
    if (action === "ok") {
      await setMark(day, game, cardId, variant, true);
      return NextResponse.json({ ok: true });
    }
    if (action === "undo") {
      await setMark(day, game, cardId, variant, false);
      const retired = await retireCheck(game, cardId, variant, todayUtc());
      if (retired) await rebuildPage(game, cardId);
      return NextResponse.json({ ok: true });
    }
    const usd = Number(b?.usd);
    const n = Number(b?.n ?? 0);
    if (!(usd > 0 && usd < 1_000_000) || !Number.isInteger(n) || n < 0 || n > 999) {
      return NextResponse.json({ error: "Type the eBay sold price (and how many sales, if you counted)." }, { status: 400 });
    }
    const label = typeof b?.label === "string" ? b.label.slice(0, 200) : cardId;
    const videoPrice = Number(b?.price);
    // The video still shows the old price: remake it while it has not gone out.
    const remake = async (): Promise<{ remade: boolean; remakeError?: string }> => {
      if (slotAt(slot, day) <= Date.now()) return { remade: false };
      try {
        await dispatchTiktokRender(day, [slot], { force: true });
        return { remade: true };
      } catch (err) {
        return { remade: false, remakeError: err instanceof Error ? err.message : String(err) };
      }
    };
    // eBay sold agrees with our own number: nothing to fix (a check there retires itself at once, 10-18 Mew δ test).
    // It counts as "Looks right"; only the video is remade when its own price was the wrong one.
    const ours = await storedRaw(game, cardId, variant);
    if (ours != null && !isOffCheck(ours, usd)) {
      await setMark(day, game, cardId, variant, true);
      const video = videoPrice > 0 && isOffCheck(videoPrice, usd) ? await remake() : { remade: false };
      return NextResponse.json({ ok: true, agreed: true, ours, ...video });
    }
    const check = { game, cardId, variant, usd: Math.round(usd * 100) / 100, n, day: todayUtc(), note: `${label}: eBay sold ${usd}${n ? ` (${n} sales)` : ""}, admin post check ${day} ${slot}` };
    await putCheck(check);
    const fixed = await fixSeriesNow(check, todayUtc());
    await rebuildPage(game, cardId);
    // The remade video prints the checked price (no %), or picks another card for a change post.
    return NextResponse.json({ ok: true, fixed, ...(await remake()) });
  } catch (err) {
    if (err instanceof AuthError) return adminAuthResponse(err);
    console.error("post check failed:", err);
    return NextResponse.json({ error: "Couldn't save." }, { status: 500 });
  }
}
