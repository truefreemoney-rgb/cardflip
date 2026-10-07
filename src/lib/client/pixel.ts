/**
 * Ad-measurement events (TikTok Pixel, 10-04, for the first paid test; Google Ads conversions 10-06, below).
 *
 * The pixel itself is loaded by GoogleAnalytics.tsx under the same consent
 * gate as GA4 and only when NEXT_PUBLIC_TIKTOK_PIXEL_ID is set. These helpers
 * are safe to call anywhere: they no-op when the pixel is absent (no id,
 * consent refused, /admin, tests).
 *
 * Standard TikTok event names, so Ads Manager can optimise on them:
 *   CompleteRegistration = an account was created
 *   Subscribe            = a plan was paid for
 *   CompletePayment      = a one-time Booster was paid for
 *   ViewContent          = /scan showed a price
 *   ClickButton          = a signup button was tapped on /scan
 */
type Ttq = { track: (event: string, props?: Record<string, unknown>) => void };

function ttq(): Ttq | null {
  if (typeof window === "undefined") return null;
  const t = (window as unknown as { ttq?: Ttq }).ttq;
  return t && typeof t.track === "function" ? t : null;
}

// The pixel mounts after first paint (DeferredAnalytics, up to ~2 s): an event
// fired before then waits here instead of being dropped. Given up after 15 s
// (no id, consent refused), so nothing piles up.
const pending: [string, Record<string, unknown> | undefined][] = [];
let waiting = false;

function flushWhenReady() {
  if (waiting) return;
  waiting = true;
  const started = Date.now();
  const timer = window.setInterval(() => {
    const t = ttq();
    if (t) {
      for (const [e, p] of pending.splice(0)) {
        try {
          t.track(e, p);
        } catch {
          // Measurement never breaks the page.
        }
      }
    }
    if (t || Date.now() - started > 15_000) {
      window.clearInterval(timer);
      pending.length = 0;
      waiting = false;
    }
  }, 250);
}

/**
 * Google Ads conversions (10-06): the same moments, sent to the AW- account
 * when its id and that conversion's label exist on Vercel. Pushed onto
 * dataLayer, so a call before gtag.js loads waits there; with consent refused
 * gtag.js never loads and nothing leaves the page.
 */
const ADS_ID = process.env.NEXT_PUBLIC_GOOGLE_ADS_ID;
const ADS_LABEL: Partial<Record<string, string | undefined>> = {
  CompleteRegistration: process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL,
  Subscribe: process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL,
  CompletePayment: process.env.NEXT_PUBLIC_GOOGLE_ADS_PURCHASE_LABEL,
};

/** True once GoogleAnalytics.tsx's init has queued gtag('config', ADS_ID). */
function adsConfigured(dl: unknown[]): boolean {
  return dl.some((a) => {
    const args = a as ArrayLike<unknown> | null;
    return args != null && typeof args === "object" && args[0] === "config" && args[1] === ADS_ID;
  });
}

function adsConversion(event: string, props?: Record<string, unknown>, waitedMs = 0) {
  const label = ADS_LABEL[event];
  if (!ADS_ID || !label || typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  // The Google sign-in return (/signup?step=welcome) fires this on first paint, before the tag's
  // js/config commands are queued (they wait on /api/geo). A conversion queued ahead of its
  // config may never send, so hold it until config is there (10-07: 3 of the first 4 ad signups
  // came this way and none showed in Google Ads). Gives up after 20 s (consent refused / no tag).
  if (!adsConfigured(w.dataLayer)) {
    if (waitedMs < 20_000) setTimeout(() => adsConversion(event, props, waitedMs + 250), 250);
    return;
  }
  const value = typeof props?.value === "number" ? props.value : undefined;
  // gtag() pushes its `arguments` object; the queue only reads that shape.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  })("event", "conversion", { send_to: `${ADS_ID}/${label}`, ...(value != null ? { value, currency: typeof props?.currency === "string" ? props.currency : "USD" } : {}) });
}

/**
 * GA4 recommended events for the same moments (10-07): a second signup count
 * next to Google Ads, and importable into Ads as a conversion if the AW tag
 * ever under-counts. Same wait-for-config rule as adsConversion.
 */
const GA_ID = process.env.NEXT_PUBLIC_GA_ID;
const GA_EVENT: Partial<Record<string, string>> = { CompleteRegistration: "sign_up" };

function gaEvent(event: string, waitedMs = 0) {
  const name = GA_EVENT[event];
  if (!GA_ID || !name || typeof window === "undefined") return;
  const w = window as unknown as { dataLayer?: unknown[] };
  w.dataLayer = w.dataLayer || [];
  const ready = w.dataLayer.some((a) => {
    const args = a as ArrayLike<unknown> | null;
    return args != null && typeof args === "object" && args[0] === "config" && args[1] === GA_ID;
  });
  if (!ready) {
    if (waitedMs < 20_000) setTimeout(() => gaEvent(event, waitedMs + 250), 250);
    return;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  (function gtag(..._args: unknown[]) {
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer!.push(arguments);
  })("event", name, { send_to: GA_ID });
}

export function pixelTrack(event: "CompleteRegistration" | "Subscribe" | "CompletePayment" | "ViewContent" | "ClickButton", props?: Record<string, unknown>) {
  try {
    adsConversion(event, props);
  } catch {
    // Measurement never breaks the page.
  }
  try {
    gaEvent(event);
  } catch {
    // Measurement never breaks the page.
  }
  try {
    const t = ttq();
    if (t) t.track(event, props);
    else if (typeof window !== "undefined") {
      pending.push([event, props]);
      flushWhenReady();
    }
  } catch {
    // Measurement never breaks the page.
  }
}
