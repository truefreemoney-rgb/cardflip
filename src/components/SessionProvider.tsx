"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { fetchCurrentUser, loginPathFor, type SessionUser } from "@/lib/client/auth";

/**
 * One session lookup for the whole signed-in app. Every page under /app used
 * to call /api/auth/me itself and render nothing until it answered, which
 * meant a blank flash on each tab switch and a duplicate fetch per page.
 * Now the layout mounts this once; pages read `user` from context and only
 * their own data loads wait on it.
 */

export type SessionStatus = "loading" | "ready" | "anon";

interface SessionContextValue {
  user: SessionUser | null;
  status: SessionStatus;
  /** Replace the cached user (after a profile save, an eBay connect, …). */
  setUser: (user: SessionUser | null) => void;
  /** Re-ask the server; bounces to /login if the session is gone. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");

  // The redirect target is wherever the seller is *now*, not where the
  // provider first mounted — but reading pathname inside `load` would make it
  // a new callback on every navigation and re-run the mount effect.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const mountedRef = useRef(false);

  const apply = useCallback(
    (current: SessionUser | null) => {
      if (!mountedRef.current) return;
      if (!current) {
        setUserState(null);
        setStatus("anon");
        router.replace(loginPathFor(pathnameRef.current));
        return;
      }
      setUserState(current);
      setStatus("ready");
    },
    [router],
  );

  useEffect(() => {
    mountedRef.current = true;
    fetchCurrentUser().then(apply);
    return () => {
      mountedRef.current = false;
    };
  }, [apply]);

  const refresh = useCallback(async () => {
    apply(await fetchCurrentUser());
  }, [apply]);

  const setUser = useCallback((next: SessionUser | null) => {
    setUserState(next);
    if (next) setStatus("ready");
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ user, status, setUser, refresh }),
    [user, status, setUser, refresh],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/** Same as useSession, but null outside the provider (marketing pages). */
export function useOptionalSession(): SessionContextValue | null {
  return useContext(SessionContext);
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used inside <SessionProvider>");
  return ctx;
}
