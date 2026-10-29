import { useLocalSearchParams } from "expo-router";
import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView from "~/components/SiteWebView";

function one(v: string | string[] | undefined): string | null {
  const s = Array.isArray(v) ? v[0] : v;
  return s ? s : null;
}

/**
 * Scanner tab = the website's own scanner page (/app: the queue, the card editor with "Is this your card?",
 * Send to eBay, the category sheet) inside the app, 1:1 with the site (Chris 10-29 1:23am: "the app has to
 * match the website almost 1:1, everywhere and anywhere possible"). Only the camera is native: the page's
 * "Add Cards" asks the app for it (the site's postToApp bridge, SiteWebView onMessage), and the native
 * scanner comes back here with ?resume=<the scans>&ask=category, which the site turns into its own
 * post-scan state: the rows in the queue, the first one open in the editor, "Which category?" on top.
 * `t` is a nonce so a second visit with the same ids still reloads.
 */
export default function ScanTab() {
  const params = useLocalSearchParams<{ resume?: string; ask?: string; rn?: string; rnum?: string; rg?: string; ri?: string; t?: string }>();
  const q = new URLSearchParams();
  for (const key of ["resume", "ask", "rn", "rnum", "rg", "ri", "t"] as const) {
    const v = one(params[key]);
    if (v) q.set(key, v);
  }
  const qs = q.toString();
  return (
    <Screen>
      <AppHeader />
      <SiteWebView path={qs ? `/app?${qs}` : "/app"} scanner />
    </Screen>
  );
}
