import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { MAX_EVENTS, TAPS_PER_VIEW, cleanLabel, heatDevice, pageKey } from "@/lib/heatmap";
import { LIMITS, clientIp } from "@/lib/server/rateLimit";
import { limitOrRespondShared } from "@/lib/server/rateLimitDb";

/**
 * Heat map beacon (10-18, lib/heatmap.ts). POST {tab, ev:[…]} from
 * <HeatPing/>: page views ("v"), taps ("c") and scroll depth ("d") for one
 * browser tab. Always 204 with no body; anything odd is dropped silently,
 * like /api/visit: recording must never fail a page. No IP, user agent or
 * account is stored, only the tab's random id.
 */
export const dynamic = "force-dynamic";

const TAB = /^[a-z0-9]{12}$/;
const done = () => new NextResponse(null, { status: 204 });
const int = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const ua = req.headers.get("user-agent") ?? "";
    if (!ua || /bot|crawl|spider|preview|lighthouse|headless/i.test(ua)) return done();
    const body = (await req.json().catch(() => null)) as { tab?: unknown; ev?: unknown } | null;
    const tab = typeof body?.tab === "string" && TAB.test(body.tab) ? body.tab : null;
    if (!tab || !Array.isArray(body?.ev) || body.ev.length === 0) return done();
    if (await limitOrRespondShared(`heat:${clientIp(req)}`, LIMITS.heat)) return done();

    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const views: (string | number)[][] = [];
    const taps: (string | number)[][] = [];
    const depths: [number, number][] = [];
    const tapsPerSeq = new Map<number, number>();

    for (const raw of body.ev.slice(0, MAX_EVENTS) as Record<string, unknown>[]) {
      if (!raw || typeof raw !== "object") continue;
      const s = int(raw.s, 0, 5000);
      if (s === null) continue;
      if (raw.t === "d") {
        const d = int(raw.d, 0, 100);
        if (d !== null) depths.push([s, d]);
        continue;
      }
      const path = typeof raw.p === "string" ? raw.p.split("?")[0].replace(/\/+$/, "") || "/" : "";
      const page = pageKey(path);
      const w = int(raw.w, 1, 10000);
      if (!page || w === null) continue;
      const device = heatDevice(w);
      if (raw.t === "v") {
        views.push([tab, s, day, now, page, path, device]);
      } else if (raw.t === "c") {
        const x = int(raw.x, 0, 1000);
        const y = int(raw.y, 0, 100000);
        const h = int(raw.h, 1, 100000);
        const n = (tapsPerSeq.get(s) ?? 0) + 1;
        if (x === null || y === null || h === null || n > TAPS_PER_VIEW) continue;
        tapsPerSeq.set(s, n);
        taps.push([now, page, device, x, y, h, raw.f === 1 ? 1 : 0, cleanLabel(raw.l)]);
      }
    }

    if (views.length) {
      await db
        .prepare(`INSERT OR IGNORE INTO heat_views (tab, seq, day, at, page, path, device) VALUES ${views.map(() => "(?, ?, ?, ?, ?, ?, ?)").join(", ")}`)
        .run(...views.flat());
    }
    if (taps.length) {
      await db
        .prepare(`INSERT INTO heat_taps (at, page, device, x, y, h, fixed, label) VALUES ${taps.map(() => "(?, ?, ?, ?, ?, ?, ?, ?)").join(", ")}`)
        .run(...taps.flat());
    }
    for (const [s, d] of depths.slice(0, 5)) {
      await db.prepare("UPDATE heat_views SET depth = MAX(depth, ?) WHERE tab = ? AND seq = ?").run(d, tab, s);
    }
  } catch {
    // Recording is best-effort.
  }
  return done();
}
