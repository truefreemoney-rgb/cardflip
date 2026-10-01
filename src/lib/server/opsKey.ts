import "server-only";
import { secretEqual } from "@/lib/server/secretEqual";

/**
 * The GitHub workflows' key for /api/ops/alert, /api/ops/mail-check and /api/ops/ebay-marketplaces (secret OPS_KEY;
 * workflows ci, prod-smoke, ebay-research). 10-01 sweep: SOCIAL_POST_KEY used to open these too, so the key that CI
 * holds for its failure mail could also post on every social account. OPS_KEY cannot post; SOCIAL_POST_KEY (publisher,
 * TikTok cron, bios) cannot call these. Unset = nobody gets in.
 */
export function opsKeyOk(req: { headers: Headers }): boolean {
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return secretEqual(given, process.env.OPS_KEY);
}
