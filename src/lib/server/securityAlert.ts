import "server-only";

/**
 * A network shut out for probing (rateLimitDb.shutOutIp) → email Chris (10-20: "im not always going to be around
 * refreshing the admin page"). The block has already happened; the mail only says so. At most
 * SECURITY_ALERTS_PER_DAY a day, so a bot rotating IPs can't flood the inbox (the rest stay on /admin/errors).
 * Sent after the response, never in the way of the request; a failure is logged, never thrown.
 */
export const SECURITY_ALERTS_PER_DAY = 5;

export interface SecurityAlert {
  ip: string;
  reason: string;
  at: number;
}

export async function securityAlert(
  a: SecurityAlert,
  deps: { bump?: (key: string) => Promise<number>; send?: (a: SecurityAlert) => Promise<void> } = {},
): Promise<"sent" | "quiet"> {
  const bump = deps.bump ?? (async (key: string) => (await import("@/lib/server/dayBudget")).dayBump(key));
  if ((await bump("security_alert_mail")) > SECURITY_ALERTS_PER_DAY) return "quiet";
  if (deps.send) await deps.send(a);
  else {
    const { sendSecurityAlertEmail } = await import("@/lib/server/mail");
    const { ALERT_EMAIL } = await import("@/lib/server/users");
    await sendSecurityAlertEmail(ALERT_EMAIL, a);
  }
  return "sent";
}

/** securityAlert once the response has gone out (Vercel keeps the function alive for it); starts at once outside a request. */
export async function securityAlertLater(a: SecurityAlert): Promise<void> {
  const job = async () => {
    try {
      await securityAlert(a);
    } catch (err) {
      console.error("security alert: mail failed:", err instanceof Error ? err.message : err);
    }
  };
  try {
    const { after } = await import("next/server");
    after(job);
  } catch {
    void job();
  }
}
