import "server-only";
import { bluesky } from "@/lib/server/sites/bluesky";
import { x } from "@/lib/server/sites/x";
import type { SocialSite } from "@/lib/server/socialPublish";

/**
 * Every site the publisher knows, in reach order (docs/SOCIAL-AUTOPILOT.md).
 * A site posts only when its env vars exist; the rest show as "not
 * connected" on /admin/social. Image sites only — no video, ever (Chris
 * 09-10). X waits on its four keys. Next up: Meta (IG/FB/Threads), Pinterest.
 */
export const SOCIAL_SITES: SocialSite[] = [bluesky, x];
