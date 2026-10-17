import "server-only";

/**
 * The 15-minute uptime ping (#57, 10-17). prod-smoke.yml asks GitHub for every 15 minutes but GitHub's scheduler
 * ran it every 2-4 hours (10-14..10-17), so a dead site could sit unnoticed half a morning. Vercel Cron runs on the
 * minute: /api/cron/uptime calls runUptime with three cheap probes (one-row database read, the home page, one
 * indexed card search) and mails Chris on a failure. A probe fails only if its retry also fails, so a single cold
 * start is not an alert. The full smoke (every page, every sitemap) stays on GitHub and after each deploy.
 */

export interface UptimeProbe {
  label: string;
  run: () => Promise<void>;
}

export interface UptimeResult {
  ok: boolean;
  failures: { label: string; detail: string }[];
}

export const UPTIME_RETRY_MS = 20_000;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 200);

export async function runUptime(
  probes: UptimeProbe[],
  deps: { retryMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<UptimeResult> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const retryMs = deps.retryMs ?? UPTIME_RETRY_MS;
  const outcomes = await Promise.all(
    probes.map(async (p) => {
      try {
        await p.run();
        return null;
      } catch {
        await sleep(retryMs);
        try {
          await p.run();
          return null;
        } catch (e) {
          return { label: p.label, detail: message(e) };
        }
      }
    }),
  );
  const failures = outcomes.filter((o): o is { label: string; detail: string } => o !== null);
  return { ok: failures.length === 0, failures };
}

/** One plain-words line per failed probe, for the alert mail. */
export const uptimeMessage = (r: UptimeResult): string =>
  `The 15-minute uptime check failed (checked twice, 20 s apart): ${r.failures.map((f) => `${f.label}: ${f.detail}`).join("; ")}`;
