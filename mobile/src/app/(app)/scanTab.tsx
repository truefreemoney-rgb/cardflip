import { useLocalSearchParams } from "expo-router";
import { useEffect, useRef } from "react";
import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView, { type SiteWebViewHandle } from "~/components/SiteWebView";
import { onScanResult } from "~/lib/scanBus";

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

/**
 * Scanner tab = the website's own scanner page (/app: the queue, the card editor with "Is this your card?",
 * Send to eBay, the category sheet) inside the app, 1:1 with the site (Chris 10-29 1:23am: "the app has to
 * match the website almost 1:1, everywhere and anywhere possible"). Only the camera is native: the page's
 * "Add Cards" asks the app for it (the site's postToApp bridge, SiteWebView onMessage), and the native
 * scanner hands its scans back INTO the page that is still open (lib/scanBus -> inject -> the site's
 * "cardflip:resume" event): the queue keeps what it had, the new rows join it, the tapped one opens in the
 * editor, "Which category?" asks over them (Chris 10-29 1:32am: Add Cards "didn't keep the previously saved
 * cards … it's supposed to just add to the list"). The ?resume= params remain as the fallback when this
 * tab was not mounted; `t` is a nonce so a second visit with the same ids still reloads.
 */
export default function ScanTab() {
  const params = useLocalSearchParams<{ resume?: string; ask?: string; rn?: string; rnum?: string; rg?: string; ri?: string; ebay?: string; t?: string }>();
  const web = useRef<SiteWebViewHandle>(null);
  useEffect(
    () =>
      onScanResult((r) => {
        // Only a live scanner page can take the scans in place; anything else (the error screen, a sign-in
        // bounce, another page the tab wandered to) tells the scanner to reload the tab with ?resume= instead.
        if (!web.current || web.current.currentPath() !== "/app") return false;
        web.current.inject(`window.dispatchEvent(new CustomEvent("cardflip:resume", { detail: ${JSON.stringify({ ids: r.ids })} })); true;`);
        return true;
      }),
    [],
  );
  const q = new URLSearchParams();
  for (const key of ["resume", "ask", "rn", "rnum", "rg", "ri", "ebay", "t"] as const) {
    const v = one(params[key]);
    if (v) q.set(key, v);
  }
  const qs = q.toString();
  return (
    <Screen>
      <AppHeader />
      <SiteWebView ref={web} path={qs ? `/app?${qs}` : "/app"} scanner />
    </Screen>
  );
}
