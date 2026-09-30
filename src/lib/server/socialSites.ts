import "server-only";
import { bluesky } from "@/lib/server/sites/bluesky";
import { facebook, instagram, threads } from "@/lib/server/sites/meta";
import { pinterest } from "@/lib/server/sites/pinterest";
import { x } from "@/lib/server/sites/x";
import type { SocialSite } from "@/lib/server/socialPublish";

/**
 * Every site the publisher knows, in reach order (docs/SOCIAL-AUTOPILOT.md).
 * A site posts only when its env vars exist; the rest show as "not
 * connected" on /admin/social. Every site here takes the 1pm movers VIDEO
 * (Chris 09-25 reversed the 09-10 no-video rule; lib/socialVideo.ts),
 * picture as the fallback, except Pinterest, which pins the picture with a
 * link home (pictures only, OAuth connect).
 *
 * TikTok is deliberately NOT in this list (Chris 09-30): its developer app
 * was refused for production, so API posts could only stay private, and he
 * posts TikTok by hand from a package the night render builds every evening
 * (lib/socialTiktok.ts, the "TikTok — post by hand" card on /admin/social).
 * Do not add it back without a production-approved app.
 */
export const SOCIAL_SITES: SocialSite[] = [bluesky, x, facebook, instagram, threads, pinterest];
