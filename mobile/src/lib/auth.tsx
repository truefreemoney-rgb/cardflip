import * as AppleAuthentication from "expo-apple-authentication";
import * as Crypto from "expo-crypto";
import * as Linking from "expo-linking";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { api, ApiError, API_URL, setUnauthorizedHandler } from "./api";
import { deviceId } from "./device";
import { claimGuestScan, getGuestScan } from "./guestScan";
import { readToken, writeToken } from "./tokenStore";

/** The signed-in account as /api/auth/me returns it (the site's lib/client/auth.ts SessionUser). */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "user" | "admin";
  ebayConnected: boolean;
  trialScansLeft?: number;
  tier?: "owner" | "subscribed" | "legacy" | "pack" | "trial";
  appAccess?: boolean;
  mustConfirmEmail?: boolean;
  hasCards?: boolean;
  pricingOnly?: boolean;
  features?: { magic: boolean; mtg?: boolean; lorcana?: boolean; onepiece?: boolean; yugioh?: boolean };
  scans?: { remaining: number | null } & Record<string, unknown>;
}

/** Login needs a 6-digit code: authenticator app, or (byEmail) one the server just mailed. */
export class CodeRequiredError extends Error {
  readonly byEmail: boolean;
  constructor(message: string, byEmail: boolean) {
    super(message);
    this.name = "CodeRequiredError";
    this.byEmail = byEmail;
  }
}

interface AuthState {
  /** undefined = still checking the stored token on launch. */
  user: SessionUser | null | undefined;
  /** The launch check could not reach the server while a token is stored: index.tsx shows "No connection" + Try again. */
  offline: boolean;
  signIn(email: string, password: string, code?: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<SessionUser>;
  /** Apple's sheet, then /api/auth/apple; rejects with code ERR_REQUEST_CANCELED when dismissed. */
  /** Resolves with whether the account was just made (the site then shows its welcome step). */
  signInWithApple(): Promise<{ isNew: boolean }>;
  /** The website's Google login in the system browser sheet, then /api/auth/google/finish; resolves false when dismissed. */
  /** Resolves null when the sheet was closed, else whether the account was just made. */
  signInWithGoogle(mode: "login" | "signup"): Promise<{ isNew: boolean } | null>;
  signOut(): Promise<void>;
  refresh(): Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

/**
 * The free first scan waits in lib/guestScan.ts until an account exists: saved into it here, before the
 * screens swap, so Inventory already has the card. An email still to confirm keeps it waiting (the save
 * is gated), and the next refresh tries again.
 */
async function landGuestScan(me: SessionUser | null): Promise<void> {
  if (!me || me.mustConfirmEmail) return;
  try {
    await claimGuestScan();
  } catch {
    // Still waiting; nothing else changes.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null | undefined>(undefined);
  const [offline, setOffline] = useState(false);

  const refresh = useCallback(async () => {
    const token = await readToken();
    if (!token) {
      setUser(null);
      setOffline(false);
      return;
    }
    try {
      const { user: me } = await api<{ user: SessionUser | null }>("/api/auth/me");
      // A sign-in or sign-out finished while this answer was in flight: theirs wins, this one is stale.
      if ((await readToken()) !== token) return;
      await landGuestScan(me);
      setOffline(false);
      setUser(me);
      if (!me) await writeToken(null); // the server no longer knows this token
    } catch (err) {
      if ((await readToken()) !== token) return;
      if (err instanceof ApiError && err.status === 401) {
        // The server's own word that this session is gone.
        await writeToken(null);
        setUser(null);
        return;
      }
      // No signal, a busy server, a wall (0, 429, 5xx, 403): not a sign-out. Keep the account we had; at
      // launch, with nothing known yet, index.tsx shows "No connection" with Try again instead of the
      // signed-out funnel (review 10-29: a dropped signal used to throw members out to the first-scan page).
      setUser((u) => {
        if (u === undefined) setOffline(true);
        return u ?? null;
      });
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the keychain is read once on launch; every setState inside waits on that await
    refresh();
  }, [refresh]);

  // Waiting on the emailed code: the person taps the link in Mail and comes back, so re-check on return.
  useEffect(() => {
    if (!user?.mustConfirmEmail) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh();
    });
    return () => sub.remove();
  }, [user?.mustConfirmEmail, refresh]);

  // A 401 on any signed-in call (lib/api.ts): the session died behind the app's back, so re-check at once.
  useEffect(() => {
    setUnauthorizedHandler(() => void refresh());
    return () => setUnauthorizedHandler(null);
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string, code?: string) => {
    try {
      const body = await api<{ user: SessionUser }>("/api/auth/login", { body: { email, password, ...(code ? { code } : {}) } });
      await landGuestScan(body.user);
      setUser(body.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && err.body.totpRequired) {
        throw new CodeRequiredError(err.message, Boolean(err.body.emailCode));
      }
      throw err;
    }
  }, []);

  /** POST /api/auth/signup (the website's form, word for word); the token comes back in the body like login. */
  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const body = await api<{ user: SessionUser }>("/api/auth/signup", { body: { name, email, password } });
    await landGuestScan(body.user);
    setUser(body.user);
    return body.user;
  }, []);

  /**
   * Sign in with Apple (docs/APP-PLAN.md step 6): iOS shows Apple's sheet, hands back an identity token
   * (and the name, first time only), and POST /api/auth/apple makes / links / opens the account like Google
   * on the website. The nonce: a random string, hashed here and given to Apple, so the token names this one
   * request and a replayed token is refused. Throws Apple's ERR_REQUEST_CANCELED when the sheet is dismissed.
   */
  const signInWithApple = useCallback(async () => {
    const raw = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
    const nonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
    const cred = await AppleAuthentication.signInAsync({
      requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
      nonce,
    });
    if (!cred.identityToken) throw new Error("Sign in with Apple didn't finish.");
    // Apple hands the name over ONCE, on the first sign-in: keep it on the phone so a retry after a
    // failed POST (no signal) still names the new account instead of "Card Collector".
    const given = [cred.fullName?.givenName, cred.fullName?.familyName].filter(Boolean).join(" ");
    const nameKey = `cardflip_apple_name_${cred.user.replace(/[^A-Za-z0-9._-]/g, "")}`;
    let name = given;
    try {
      if (given) await SecureStore.setItemAsync(nameKey, given);
      else name = (await SecureStore.getItemAsync(nameKey)) ?? "";
    } catch {
      // No keychain = no memory of the name; the server falls back as before.
    }
    const scan = await getGuestScan();
    const body = await api<{ user: SessionUser; isNew?: boolean }>("/api/auth/apple", { body: { identityToken: cred.identityToken, nonce, name, fromScan: Boolean(scan) } });
    await landGuestScan(body.user);
    setUser(body.user);
    return { isNew: Boolean(body.isNew) && !body.user.mustConfirmEmail };
  }, []);

  /**
   * "Continue with Google" (10-29): the website's own Google login, run in the system browser sheet
   * (ASWebAuthenticationSession; a popup on the web preview) against /api/auth/google/start with app=1.
   * No second Google client: an account made with Google on cardflip.io opens here. The sheet comes back
   * to this app's own address (cardflip://auth; exp://… in Expo Go) with a sealed ticket that only the
   * PKCE verifier minted here can open, and /api/auth/google/finish turns it into the session. The
   * install id rides along so the sign-up guards and the waiting first scan see the same device.
   * Resolves false when the sheet was closed; throws with the server's words on anything else.
   */
  const signInWithGoogle = useCallback(async (mode: "login" | "signup") => {
    const verifier = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, "0")).join("");
    const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, { encoding: Crypto.CryptoEncoding.BASE64 });
    const pkce = digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const back = Linking.createURL("auth");
    const scan = await getGuestScan();
    const q = [
      ["app", "1"],
      ["mode", mode],
      ["pkce", pkce],
      ["back", back],
      ["device", await deviceId()],
      ...(scan ? [["from", "scan"]] : []),
    ]
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join("&");
    const result = await WebBrowser.openAuthSessionAsync(`${API_URL}/api/auth/google/start?${q}`, back);
    if (result.type !== "success") return null;
    const params = Linking.parse(result.url).queryParams ?? {};
    const ticket = typeof params.ticket === "string" ? params.ticket : "";
    if (!ticket) {
      throw new Error(params.google_error === "2" ? "That account has extra security. Log in with your email and password." : "Google sign-in didn't finish. Try again or use email.");
    }
    const body = await api<{ user: SessionUser }>("/api/auth/google/finish", { body: { ticket, verifier } });
    await landGuestScan(body.user);
    setUser(body.user);
    // The callback says whether it just made the account (?new=1): the site shows its welcome step then.
    return { isNew: params.new === "1" && !body.user.mustConfirmEmail };
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST", body: {} });
    } catch {
      // Already gone server-side or offline: the phone forgets the token either way.
    }
    await writeToken(null);
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, offline, signIn, signUp, signInWithApple, signInWithGoogle, signOut, refresh }), [user, offline, signIn, signUp, signInWithApple, signInWithGoogle, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
