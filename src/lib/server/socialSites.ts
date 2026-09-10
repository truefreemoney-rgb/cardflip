import "server-only";
import { bluesky } from "@/lib/server/sites/bluesky";
import type { SocialSite } from "@/lib/server/socialPublish";

/**
 * Every site the publisher knows, in reach order (docs/SOCIAL-AUTOPILOT.md).
 * A site posts only when its env vars exist; the rest show as "not
 * connected" on /admin/social. Image sites only — no video, ever (Chris
 * 09-10). Next up: Meta (IG/FB/Threads), X, Pinterest.
 */
export const SOCIAL_SITES: SocialSite[] = [bluesky];
