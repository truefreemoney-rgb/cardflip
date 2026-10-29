import { router } from "expo-router";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
 * session, which shows the app's sign-in when it is gone); a link to the
 * website's scanner page (/app) switches to the Scanner tab, which shows that
 * page (and the page's "Add Cards" opens the app's camera over the bridge);
 * mailto:/tel: links go to the phone's apps.
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
export function safeSitePath(raw: string | string[] | undefined): string {
  const p = Array.isArray(raw) ? raw[0] : raw;
  return p && p.startsWith("/") && !p.startsWith("//") ? p : "/app/account";
}

/** What a screen holding a ref can do with the page: run script in it (the Scanner tab's in-place resume). */
export type SiteWebViewHandle = { inject(js: string): void };

const SiteWebView = forwardRef<SiteWebViewHandle, { path: string; onLeave?: () => void; onLoading?: (loading: boolean) => void; scanner?: boolean }>(function SiteWebView(
  { path, onLeave, onLoading, scanner = false },
  ref,
) {
  const { refresh } = useAuth();
  const web = useRef<React.ComponentRef<typeof WebView>>(null);
  useImperativeHandle(ref, () => ({ inject: (js: string) => web.current?.injectJavaScript(js) }), []);
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

  function leave(): void {
    if (leaving.current) return;
    leaving.current = true;
    void refresh();
    if (onLeave) onLeave();
    else leaving.current = false; // a tab stays; the next sign-out can steer again
  }

  /** False = the app takes over instead of the page (see the file comment). */
  function steer(url: string): boolean {
    if (/^(mailto|tel|sms):/i.test(url)) {
      void Linking.openURL(url);
      return false;
    }
    try {
      const u = new URL(url);
      if (u.origin !== new URL(API_URL).origin) return true;
      // The website's scanner page (/app) is the app's Scanner tab ((app)/scanTab.tsx, 10-29): a link to it
      // from another page switches tabs; the Scanner tab itself loads it, with or without ?resume=.
      if (u.pathname === "/app" && !scanner) {
        router.navigate("/(app)/scanTab");
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

  if (token === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.brandSoft} size="large" />
      </View>
    );
  }
  if (!token) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>Sign in again to open this page.</Text>
      </View>
    );
  }
  if (failed) {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{failed}</Text>
        <Pressable
          onPress={() => {
            setFailed(null);
            setAttempt((a) => a + 1);
          }}
          style={styles.retry}
        >
          <Text style={styles.retryText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const headers = { authorization: `Bearer ${token}`, "x-cardflip-app": APP_HEADER_VALUE };
  if (Platform.OS === "web") {
    return <WebPreview key={attempt} path={path} headers={headers} onLoad={() => onLoading?.(false)} onFail={setFailed} />;
  }
  return (
    <WebView
      ref={web}
      key={attempt}
      style={styles.web}
      source={{ uri: `${API_URL}/api/auth/app-cookie?next=${encodeURIComponent(path)}`, headers }}
      onLoadStart={() => onLoading?.(true)}
      onLoadEnd={() => onLoading?.(false)}
      onError={() => setFailed("Couldn't load the page. Check your connection and try again.")}
      onHttpError={(e) => {
        if (e.nativeEvent.statusCode === 401) leave();
      }}
      onNavigationStateChange={(nav: WebViewNavigation): void => {
        steer(nav.url);
      }}
      onShouldStartLoadWithRequest={(req): boolean => steer(req.url)}
      // The page's own bridge (the site's lib/appMode.ts postToApp): the scanner page's "Add Cards" asks for
      // the app's camera instead of the web one.
      onMessage={(e) => {
        try {
          const msg = JSON.parse(e.nativeEvent.data) as { type?: string };
          if (msg.type === "scan") router.push("/scan");
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
