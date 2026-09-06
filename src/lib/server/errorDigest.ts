import "server-only";
import { errorCount24h, errorGroups24h, reportServerError } from "@/lib/server/errorLog";
import { isMailConfigured, sendErrorDigestEmail } from "@/lib/server/mail";
import { OWNER_EMAIL } from "@/lib/server/users";

/** Email the owner when error_events > this in 24h. Override with ERROR_DIGEST_MIN. */
export const ERROR_DIGEST_MIN = Math.max(0, Number(process.env.ERROR_DIGEST_MIN ?? 5) || 0);

export interface ErrorDigestResult {
  errors24h: number;
  sent: boolean;
  reason?: string;
}

/**
 * Runs at the end of the daily cron: counts the last 24h of error_events and
 * mails the owner a grouped digest when the count clears the threshold.
 * Never throws — the price refresh is the cron's job, this is a bonus.
 */
export async function sendErrorDigestIfNeeded(
  deps: {
    count?: () => Promise<number>;
    groups?: () => Promise<{ source: string; message: string; count: number }[]>;
    send?: (to: string, total: number, groups: { source: string; message: string; count: number }[]) => Promise<void>;
    configured?: () => boolean;
    min?: number;
  } = {},
): Promise<ErrorDigestResult> {
  const min = deps.min ?? ERROR_DIGEST_MIN;
  try {
    const errors24h = await (deps.count ?? errorCount24h)();
    if (errors24h <= min) return { errors24h, sent: false, reason: `≤ ${min}` };
    if (!(deps.configured ?? isMailConfigured)()) return { errors24h, sent: false, reason: "mail not configured" };
    const groups = await (deps.groups ?? errorGroups24h)();
    await (deps.send ?? sendErrorDigestEmail)(process.env.ERROR_DIGEST_TO ?? OWNER_EMAIL, errors24h, groups);
    return { errors24h, sent: true };
  } catch (err) {
    await reportServerError("errorDigest", err);
    return { errors24h: -1, sent: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
