"use client";

/**
 * The app whose built-in browser this page is open in, or null for a real
 * browser. Ad and post links open inside TikTok / Instagram / Facebook, and
 * whether those let a page use the camera is up to each app (10-04: no way to
 * test TikTok's from a phone without a live ad). When the camera fails there,
 * the scanner says how to reopen the page in the phone's own browser.
 */
// 10-05: TikTok's browser forced the live camera into its own fullscreen player (Chris's iPhone), so every app below
// gets the phone's own camera instead (CameraCapture). Same tokens as lib/attribution.ts IN_APP_SOURCES, plus Snapchat
// and LinkedIn. Threads is tested before Instagram (its browser says Barcelona), Instagram before Facebook (it carries FB tokens).
const IN_APP: [RegExp, string][] = [
  [/\bBarcelona\b/, "Threads"],
  [/musical_ly|BytedanceWebview|\bTikTok\b|\btrill_/i, "TikTok"],
  [/\bInstagram\b/i, "Instagram"],
  [/\b(FBAN|FBAV|FB_IAB|FBIOS)\b/, "Facebook"],
  [/\bPinterest\b/i, "Pinterest"],
  [/\bTwitter(Android|\b)/, "X"],
  [/\bSnapchat\b/i, "Snapchat"],
  [/\bLinkedInApp\b/i, "LinkedIn"],
];

export function inAppBrowserName(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string | null {
  for (const [re, name] of IN_APP) if (re.test(ua)) return name;
  return null;
}

/**
 * An app's own browser on an iPhone that does not name itself (10-05: TikTok's DM link browser still played the live
 * camera fullscreen after the name check shipped). Safari, Chrome, Firefox and Edge on iOS all carry "Safari/" in the
 * user agent; a bare app web view does not.
 */
export function isIosWebView(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  return /\b(iPhone|iPad|iPod)\b/.test(ua) && !/\bSafari\//.test(ua);
}

/** The camera-blocked message for an in-app browser. */
export function inAppCameraMessage(app: string): string {
  return `${app}'s built-in browser didn't let CardFlip use the camera. Tap ⋯ at the top of the screen, choose Open in browser, then tap Scan again.`;
}

/**
 * A link that leaves the app's browser for the phone's own (10-05, Chris: "we need them to get off tiktoks browser").
 * iOS 17+ opens x-safari-https:// in Safari; Android opens an intent:// link in Chrome. Null on anything else. Whether
 * an app lets the link through is up to the app, so the phone camera stays on the page as the fallback.
 */
export function openInBrowserUrl(href: string, ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string | null {
  const u = new URL(href);
  if (/\b(iPhone|iPad|iPod)\b/.test(ua)) return `x-safari-${u.protocol.replace(":", "")}://${u.host}${u.pathname}${u.search}`;
  if (/\bAndroid\b/.test(ua)) return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(":", "")};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
  return null;
}

/** "Safari" or "Chrome": the browser openInBrowserUrl opens. */
export function phoneBrowserName(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  return /\bAndroid\b/.test(ua) ? "Chrome" : "Safari";
}
