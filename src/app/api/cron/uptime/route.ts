import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cronAuthError } from "@/lib/server/cronAuth";
import { opsAlert } from "@/lib/server/opsAlert";
import { runUptime, uptimeMessage, type UptimeProbe } from "@/lib/server/uptime";
import { SITE_URL } from "@/lib/siteUrl";

/**
 * 15-minute uptime ping (#57, lib/server/uptime.ts). Vercel Cron, every 15 minutes (vercel.json). Three probes:
 * a one-row database read, the home page through the public address, and an indexed card search; any that fails
 * twice mails Chris (opsAlert, at most once an hour). Nothing is written except the alert's own timestamp.
 *   GET /api/cron/uptime → Bearer CRON_SECRET (Vercel)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const TIMEOUT_MS = 20_000;

async function get(path: string): Promise<{ status: number; text: string }> {
  const res = await fetch(SITE_URL + path, { cache: "no-store", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "cardflip-uptime" } });
  return { status: res.status, text: await res.text() };
}

const PROBES: UptimeProbe[] = [
  {
    label: "database read",
    run: async () => {
      const row = (await db.prepare("SELECT 1 AS ok").get()) as { ok: number } | undefined;
      if (Number(row?.ok) !== 1) throw new Error("no row");
    },
  },
  {
    label: "home page",
    run: async () => {
      const r = await get("/");
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      if (!/<title>[^<]*CardFlip/i.test(r.text)) throw new Error("no CardFlip title");
    },
  },
  {
    label: "card search",
    run: async () => {
      const r = await get("/api/search-card?name=The%20One%20Ring&number=246&setCode=ltr&game=mtg");
      if (r.status !== 200) throw new Error(`status ${r.status}`);
      const top = (JSON.parse(r.text) as { cards?: { name?: string }[] }).cards?.[0]?.name;
      if (top !== "The One Ring") throw new Error(`top result ${top ?? "none"}`);
    },
  },
];

export async function GET(req: NextRequest) {
  const denied = cronAuthError(req);
  if (denied) return denied;
  const started = Date.now();
  const result = await runUptime(PROBES);
  let alert: string | null = null;
  if (!result.ok) {
    alert = await opsAlert({ workflow: "Uptime", message: uptimeMessage(result) }).catch((e) => `mail failed: ${e instanceof Error ? e.message : e}`);
  }
  return NextResponse.json({ ...result, alert, ms: Date.now() - started });
}
