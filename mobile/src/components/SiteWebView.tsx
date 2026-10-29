import { router, useFocusEffect } from "expo-router";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import WebView, { type WebViewNavigation } from "react-native-webview";
import { API_URL, APP_HEADER_VALUE } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { readToken } from "~/lib/tokenStore";
import { colors, space } from "~/lib/theme";

/**
 * A cardflip.io page inside the app (docs/APP-PLAN.md "Hybrid", 10-28):
 * account, wishlist, packs, rewards, help, price check, pricing. The page
 * opens signed in without the website's own sign-in ever showing: the first
 * load is GET /api/auth/app-cookie?next=<path> with the app's bearer token in
 * the request headers, which turns that same session into the website's
 * cookie and lands on the page with ?app=1 (the site then hides its menu, tab
 * bar and footer — the site's lib/appMode.ts). Cookies stay inside the
 * WebView; the app itself keeps using the bearer token.
 *
 * Steering: a page that sends the browser to /login, /signup or the home page
 * (a sign-out, a dead session) calls onLeave (default: re-check the app's own
 * session, which shows the app's sign-in when it is gone, or redo the handoff
 * when it is not); a link to the website's scanner page (/app) switches to the
 * Scanner tab with the link's query (resume=, the eBay return), which shows
 * that page (and the page's "Add Cards" opens the app's camera over the
 * bridge); mailto:/tel: links go to the phone's apps; any other site (eBay
 * listings, TCGplayer, help links) opens in Safari, except the eBay sign-in
 * and Stripe checkout hosts, which need this WebView's cookies to come back
 * signed in (review 10-29).
 *
 * Web (the in-pane preview only, never shipped): react-native-webview has no
 * web build, so the handoff is a fetch with credentials and the page sits in
 * an <iframe>; the dev server drops X-Frame-Options for that (next.config.ts).
 */
const LEAVE_PATHS = new Set(["/", "/login", "/signup"]);
/** Other hosts that stay inside the WebView: flows that end by sending the browser back to cardflip.io. */
const KEEP_HOSTS = /(^|\.)(auth|signin)\.ebay\.(com|co\.uk|ca|com\.au|ie)$|(^|\.)(checkout|billing)\.stripe\.com$/i;
/** The query a link to /app may carry into the Scanner tab (the site's My Cards Resume / Verify / "Move to listings", the eBay return). */
const SCANNER_PARAMS = ["resume", "ask", "rn", "rnum", "rg", "ri", "ebay"] as const;

function withAppFlag(path: string): string {
  return /[?&]app=1(?:&|$)/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}app=1`;
}

/** Only our own paths: "/app/account", never a full URL or "//host". */
export function safeSitePath(raw: string | string[] | undefined): string {
  const p = Array.isArray(raw) ? raw[0] : raw;
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/app/account";
}

/** What a screen holding a ref can do with the page: run script in it (the Scanner tab's in-place resume), and ask where it is. */
export type SiteWebViewHandle = { inject(js: string): void; currentPath(): string | null };

/** guest: a public page with no session (the first-open card page, 10-29): no handoff, and the site's own Sign up / Log in links open the app's screens. */
const SiteWebView = forwardRef<SiteWebViewHandle, { path: string; onLeave?: () => void; onLoading?: (loading: boolean) => void; scanner?: boolean; guest?: boolean }>(function SiteWebView(
  { path, onLeave, onLoading, scanner = false, guest = false },
  ref,
) {
  const { refresh } = useAuth();
  const web = useRef<React.ComponentRef<typeof WebView>>(null);
  /** The page's current path (null until the first load): the Scanner tab only hands scans into the scanner page. */
  const here = useRef<string | null>(null);
  useImperativeHandle(ref, () => ({ inject: (js: string) => web.current?.injectJavaScript(js), currentPath: () => here.current }), []);
  // Each tab is its own page: when this one comes back into view, tell it (the site's SessionProvider
  // re-reads the user, Inventory re-reads its rows), so Seller / Collector flipped on one tab reaches the
  // others (Chris 10-29 1:38am). The first focus races the page load and is harmless.
  useFocusEffect(
    useCallback(() => {
      web.current?.injectJavaScript(`window.dispatchEvent(new Event("cardflip:focus")); true;`);
    }, []),
  );
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const leaving = useRef(false);

  useEffect(() => {
    let live = true;
    readToken().then((t) => live && setToken(t));
    return () => {
      live = false;
    };
  }, [attempt]);

  // The error screen replaces the page: tell the holder the spinner can stop.
  useEffect(() => {
    if (failed) onLoading?.(false);
  }, [failed, onLoading]);

  const retry = () => {
    setFailed(null);
    setAttempt((a) => a + 1);
  };

  function leave(): void {
    if (leaving.current) return;
    leaving.current = true;
    void refresh().then(async () => {
      // Still signed in on the app's side (the WebView's cookie went, the token did not): redo the handoff
      // instead of leaving the tab sitting on the website's login page.
      if (!onLeave && (await readToken())) retry();
      leaving.current = false; // a tab stays; the next sign-out can steer again
    });
    if (onLeave) onLeave();
  }

  /** Hand a link to /app to the Scanner tab, query and all; true when it was one. */
  function toScanner(u: URL): boolean {
    if (u.pathname !== "/app" || scanner) return false;
    const params: Record<string, string> = { t: String(Date.now()) };
    for (const k of SCANNER_PARAMS) {
      const v = u.searchParams.get(k);
      if (v) params[k] = v;
    }
    router.navigate({ pathname: "/(app)/scanTab", params });
    return true;
  }

  /** False = the app takes over instead of the page (see the file comment). */
  function steer(url: string, topFrame = true): boolean {
    if (/^(mailto|tel|sms):/i.test(url)) {
      void Linking.openURL(url);
      return false;
    }
    try {
      const u = new URL(url);
      if (u.origin !== new URL(API_URL).origin) {
        if (!topFrame || !/^https?:$/.test(u.protocol) || KEEP_HOSTS.test(u.hostname)) return true;
        void Linking.openURL(url);
        return false;
      }
      if (toScanner(u)) return false;
      if (guest && (u.pathname === "/signup" || u.pathname === "/login")) {
        router.replace(u.pathname === "/signup" ? "/signup" : "/login");
        return false;
      }
      if (LEAVE_PATHS.has(u.pathname)) {
        leave();
        return false;
      }
    } catch {
      // Not a URL we can read: let the page have it.
    }
    return true;
  }

  if (token === undefined && !guest) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandSoft} size="large" />
      </View>
    );
  }
  if (!token && !guest) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Sign in again to open this page.</Text>
        <Pressable onPress={retry} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{failed}</Text>
        <Pressable onPress={retry} style={styles.retry}>
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const headers: Record<string, string> = { "x-cardflip-app": APP_HEADER_VALUE };
  if (token) headers.authorization = `Bearer ${token}`;
  if (Platform.OS === "web") {
    return <WebPreview key={attempt} path={path} headers={headers} guest={guest} onLoad={() => onLoading?.(false)} onFail={setFailed} />;
  }
  const ours = (url: string | undefined): boolean => {
    try {
      return Boolean(url) && new URL(url as string).origin === new URL(API_URL).origin;
    } catch {
      return false;
    }
  };
  return (
    <WebView
      ref={web}
      key={attempt}
      style={styles.web}
      source={{ uri: guest ? `${API_URL}${withAppFlag(path)}` : `${API_URL}/api/auth/app-cookie?next=${encodeURIComponent(path)}`, headers }}
      onLoadStart={() => onLoading?.(true)}
      onLoadEnd={() => onLoading?.(false)}
      onError={() => setFailed("Couldn't load the page. Check your connection and try again.")}
      onHttpError={(e) => {
        if (e.nativeEvent.statusCode === 401) leave();
        // A server error on the page itself (not a picture or a call it made): the same Try again as no signal.
        else if (e.nativeEvent.statusCode >= 500 && ours(e.nativeEvent.url) && !/\/api\/(?!auth\/app-cookie)/.test(e.nativeEvent.url)) setFailed("CardFlip couldn't load that page. Try again in a moment.");
      }}
      onNavigationStateChange={(nav: WebViewNavigation): void => {
        if (ours(nav.url)) {
          try {
            here.current = new URL(nav.url).pathname;
          } catch {
            here.current = null;
          }
        }
        // An in-page navigation has already changed this page; when the app takes the link over
        // (the Scanner tab, the phone's apps), put this page back where it was.
        if (!steer(nav.url) && !nav.loading && !LEAVE_PATHS.has(here.current ?? "")) web.current?.injectJavaScript("history.back(); true;");
      }}
      onShouldStartLoadWithRequest={(req): boolean => steer(req.url, req.isTopFrame !== false)}
      // target=_blank links: ours over the tabs with a Back bar, anything else in Safari.
      onOpenWindow={(e) => {
        const url = e.nativeEvent.targetUrl;
        if (!url) return;
        if (ours(url)) {
          const u = new URL(url);
          if (!toScanner(u)) router.push({ pathname: "/web", params: { path: u.pathname + u.search } });
        } else void Linking.openURL(url);
      }}
      // The page's own bridge (the site's lib/appMode.ts postToApp): the scanner page's "Add Cards" asks for
      // the app's camera instead of the web one. Only our own pages get to ask.
      onMessage={(e) => {
        if (!ours(e.nativeEvent.url)) return;
        try {
          const msg = JSON.parse(e.nativeEvent.data) as { type?: string };
          if (msg.type === "scan") router.navigate("/scan");
        } catch {
          /* not ours */
        }
      }}
      allowsBackForwardNavigationGestures
      sharedCookiesEnabled
      startInLoadingState={false}
      keyboardDisplayRequiresUserAction={false}
      contentInsetAdjustmentBehavior="never"
      applicationNameForUserAgent={`CardFlipApp/${APP_HEADER_VALUE}`}
    />
  );
});

export default SiteWebView;

/** Web only: cookie handoff by fetch, then the page in an iframe. */
function WebPreview({ path, headers, guest, onLoad, onFail }: { path: string; headers: Record<string, string>; guest: boolean; onLoad(): void; onFail(message: string): void }) {
  const [ready, setReady] = useState(guest);
  useEffect(() => {
    let live = true;
    if (guest) return;
    fetch(`${API_URL}/api/auth/app-cookie`, { method: "POST", headers, credentials: "include" })
      .then((res) => {
        if (!live) return;
        if (res.ok) setReady(true);
        else onFail(`The sign-in handoff answered ${res.status}.`);
      })
      .catch(() => live && onFail("Couldn't reach the server for the sign-in handoff."));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one handoff per mount; headers/onFail are stable for the screen's life
  }, [path]);
  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandSoft} size="large" />
      </View>
    );
  }
  return (
    <iframe
      title="CardFlip page"
      src={`${API_URL}${withAppFlag(path)}`}
      onLoad={onLoad}
      style={{ flex: 1, border: "none", width: "100%", height: "100%", backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  message: { color: colors.muted, fontSize: 15, textAlign: "center" },
  retry: { marginTop: space.lg, borderColor: colors.edgeStrong, borderWidth: 1, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
});
