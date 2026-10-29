import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, ApiError } from "./api";
import { claimGuestScan } from "./guestScan";
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
  signIn(email: string, password: string, code?: string): Promise<void>;
  signUp(name: string, email: string, password: string): Promise<void>;
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

  const refresh = useCallback(async () => {
    if (!(await readToken())) {
      setUser(null);
      return;
    }
    try {
      const { user: me } = await api<{ user: SessionUser | null }>("/api/auth/me");
      await landGuestScan(me);
      setUser(me);
      if (!me) await writeToken(null); // the server no longer knows this token
    } catch (err) {
      // A server hiccup is not a sign-out: keep whatever we had, or show the sign-in if nothing yet.
      if (err instanceof ApiError && err.status >= 500) setUser((u) => u ?? null);
      else setUser(null);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the keychain is read once on launch; every setState inside waits on that await
    refresh();
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

  const value = useMemo(() => ({ user, signIn, signUp, signOut, refresh }), [user, signIn, signUp, signOut, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}
