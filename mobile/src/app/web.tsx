import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import WebView, { type WebViewNavigation } from "react-native-webview";
import { API_URL, APP_HEADER_VALUE } from "~/lib/api";
import { useAuth } from "~/lib/auth";
import { readToken } from "~/lib/tokenStore";
import { colors, space } from "~/lib/theme";

/**
 * A cardflip.io page inside the app (docs/APP-PLAN.md "Hybrid", 10-28):
 * account, packs, wishlist, rewards, help, price check, subscribe. The page
 * opens signed in without the website's own sign-in ever showing: the first
 * load is GET /api/auth/app-cookie?next=<path> with the app's bearer token in
 * the request headers, which turns that same session into the website's
 * cookie and lands on the page with ?app=1 (the site then hides its menu, tab
 * bar and footer — the site's lib/appMode.ts). Cookies stay inside this
 * WebView; the app itself keeps using the bearer token.
 *
 * Leaving: a page that sends the browser to /login, /signup or the home page
 * (a sign-out, a dead session) closes this screen and re-checks the app's own
 * session. mailto:/tel: links go to the phone's apps.
 *
 * Web (the in-pane preview only, never shipped): react-native-webview has no
 * web build, so the handoff is a fetch with credentials and the page sits in
 * an <iframe>; the dev server drops X-Frame-Options for that (next.config.ts).
 */
const LEAVE_PATHS = new Set(["/", "/login", "/signup"]);

function withAppFlag(path: string): string {
  return /[?&]app=1(?:&|$)/.test(path) ? path : `${path}${path.includes("?") ? "&" : "?"}app=1`;
}

/** Only our own paths: "/app/account", never a full URL or "//host". */
function safePath(raw: string | string[] | undefined): string {
  const p = Array.isArray(raw) ? raw[0] : raw;
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/app/account";
}

export default function WebScreen() {
  const params = useLocalSearchParams<{ path?: string; title?: string }>();
  const path = safePath(params.path);
  const title = (Array.isArray(params.title) ? params.title[0] : params.title) || "CardFlip";
  const insets = useSafeAreaInsets();
  const { refresh } = useAuth();
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState<string | null>(null);
  const leaving = useRef(false);

  useEffect(() => {
    let live = true;
    readToken().then((t) => live && setToken(t));
    return () => {
      live = false;
    };
  }, []);

  function leave(): void {
    if (leaving.current) return;
    leaving.current = true;
    void refresh();
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/home");
  }

  /**
   * False = the app takes over instead of the page: a sign-out / sign-in page
   * closes this screen; the website's scanner (/app, e.g. "Back to Scanning"
   * on the pricing page) opens the app's own scanner. Both handlers below
   * call this: a full load goes through onShouldStartLoadWithRequest, an
   * in-page route change (Next's router) through onNavigationStateChange.
   */
  function steer(url: string): boolean {
    if (/^(mailto|tel|sms):/i.test(url)) {
      void Linking.openURL(url);
      return false;
    }
    try {
      const u = new URL(url);
      if (u.origin !== new URL(API_URL).origin) return true;
      if (u.pathname === "/app") {
        if (leaving.current) return false;
        leaving.current = true;
        if (router.canGoBack()) router.back();
        router.push("/scan");
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

  const headers = token ? { authorization: `Bearer ${token}`, "x-cardflip-app": APP_HEADER_VALUE } : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace("/(app)/home"))} hitSlop={10} style={styles.backBtn}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.backBtn}>{loading && !failed ? <ActivityIndicator color={colors.brandSoft} /> : null}</View>
      </View>
      {token === undefined ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brandSoft} size="large" />
        </View>
      ) : !headers ? (
        <View style={styles.center}>
          <Text style={styles.message}>Sign in again to open this page.</Text>
        </View>
      ) : failed ? (
        <View style={styles.center}>
          <Text style={styles.message}>{failed}</Text>
          <Pressable onPress={() => setFailed(null)} style={styles.retry}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : Platform.OS === "web" ? (
        <WebPreview path={path} headers={headers} onLoad={() => setLoading(false)} onFail={setFailed} />
      ) : (
        <WebView
          style={styles.web}
          source={{ uri: `${API_URL}/api/auth/app-cookie?next=${encodeURIComponent(path)}`, headers }}
          onLoadStart={() => setLoading(true)}
          onLoadEnd={() => setLoading(false)}
          onError={() => setFailed("Couldn't load the page. Check your connection and try again.")}
          onHttpError={(e) => {
            if (e.nativeEvent.statusCode === 401) leave();
          }}
          onNavigationStateChange={(nav: WebViewNavigation): void => {
            steer(nav.url);
          }}
          onShouldStartLoadWithRequest={(req): boolean => steer(req.url)}
          allowsBackForwardNavigationGestures
          sharedCookiesEnabled
          startInLoadingState={false}
          keyboardDisplayRequiresUserAction={false}
          contentInsetAdjustmentBehavior="never"
          applicationNameForUserAgent={`CardFlipApp/${APP_HEADER_VALUE}`}
        />
      )}
    </View>
  );
}

/** Web only: cookie handoff by fetch, then the page in an iframe. */
function WebPreview({ path, headers, onLoad, onFail }: { path: string; headers: Record<string, string>; onLoad(): void; onFail(message: string): void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let live = true;
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
  }, [path, headers, onFail]);
  if (!ready) return <View style={styles.center}><ActivityIndicator color={colors.brandSoft} size="large" /></View>;
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
  screen: { flex: 1, backgroundColor: colors.background },
  bar: { height: 44, flexDirection: "row", alignItems: "center", paddingHorizontal: space.sm, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth, backgroundColor: colors.surface },
  backBtn: { width: 76, height: 44, justifyContent: "center" },
  back: { color: colors.brandSoft, fontSize: 17 },
  title: { flex: 1, textAlign: "center", color: colors.white, fontSize: 16, fontWeight: "600" },
  web: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xl },
  message: { color: colors.muted, fontSize: 15, textAlign: "center" },
  retry: { marginTop: space.lg, borderColor: colors.edgeStrong, borderWidth: 1, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 10 },
  retryText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
});
