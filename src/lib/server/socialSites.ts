import "server-only";
import { bluesky } from "@/lib/server/sites/bluesky";
import { facebook, instagram, threads } from "@/lib/server/sites/meta";
import { x } from "@/lib/server/sites/x";
import type { SocialSite } from "@/lib/server/socialPublish";

/**
 * Every site the publisher knows, in reach order (docs/SOCIAL-AUTOPILOT.md).
 * A site posts only when its env vars exist; the rest show as "not
 * connected" on /admin/social. Every site here takes the 7am set-spotlight
 * VIDEO (Chris 09-25 reversed the 09-10 no-video rule; lib/socialVideo.ts),
 * picture as the fallback. Next up: Pinterest, then TikTok (needs its own
 * app audit).
 */
export const SOCIAL_SITES: SocialSite[] = [bluesky, x, facebook, instagram, threads];
