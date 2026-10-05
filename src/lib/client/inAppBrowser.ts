"use client";

/**
 * The app whose built-in browser this page is open in, or null for a real
 * browser. Ad and post links open inside TikTok / Instagram / Facebook, and
 * whether those let a page use the camera is up to each app (10-04: no way to
 * test TikTok's from a phone without a live ad). When the camera fails there,
 * the scanner says how to reopen the page in the phone's own browser.
 */
export function inAppBrowserName(ua: string = typeof navigator === "undefined" ? "" : navigator.userAgent): string | null {
  if (/musical_ly|BytedanceWebview|TikTok/i.test(ua)) return "TikTok";
  if (/Instagram/i.test(ua)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return "Facebook";
  return null;
}

/** The camera-blocked message for an in-app browser. */
export function inAppCameraMessage(app: string): string {
  return `${app}'s built-in browser didn't let CardFlip use the camera. Tap ⋯ at the top of the screen, choose Open in browser, then tap Scan again.`;
}
