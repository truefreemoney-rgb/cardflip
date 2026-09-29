import "server-only";
import { getSetting, setSetting } from "@/lib/server/settings";

/**
 * CI / prod-smoke failure → email Chris (09-29: CI sat red for three hours
 * and nobody looked; "we cant keep having problems"). GitHub Actions POSTs
 * here from a failure() step. One mail per workflow per hour, so a smoke
 * check failing every 15 minutes is one alert, not four.
 */
export const OPS_ALERT_GAP_MS = 60 * 60 * 1000;

export interface OpsAlert {
  workflow: string;
  sha?: string;
  url?: string;
  message?: string;
}

export async function opsAlert(
  a: OpsAlert,
  now = Date.now(),
  deps: {
    get?: (k: string) => Promise<string | null>;
    set?: (k: string, v: string) => Promise<void>;
    send?: (a: OpsAlert) => Promise<void>;
  } = {},
): Promise<"sent" | "quiet"> {
  const get = deps.get ?? getSetting;
  const set = deps.set ?? setSetting;
  const key = `ops_alert:${a.workflow.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const last = Number((await get(key)) ?? 0);
  if (now - last < OPS_ALERT_GAP_MS) return "quiet";
  if (deps.send) await deps.send(a);
  else {
    const { sendOpsAlertEmail } = await import("@/lib/server/mail");
    const { OWNER_EMAIL } = await import("@/lib/server/users");
    await sendOpsAlertEmail(OWNER_EMAIL, a);
  }
  await set(key, String(now));
  return "sent";
}
