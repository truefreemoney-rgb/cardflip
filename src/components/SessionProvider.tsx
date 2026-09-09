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
  /** Merge a few fields into the signed-in user (e.g. scan usage after a scan). */
  patchUser: (patch: Partial<SessionUser>) => void;
  /** Re-ask the server; bounces to /login if the session is gone. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<SessionStatus>("loading");
  // Set once the first lookup has failed (network down, /api/auth/me 5xx):
  // the app stays on "loading" and says so instead of a silent blank.
  const [unreachable, setUnreachable] = useState(false);

  // The redirect target is wherever the seller is *now*, not where the
  // provider first mounted — but reading pathname inside `load` would make it
  // a new callback on every navigation and re-run the mount effect.
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const mountedRef = useRef(false);
  // The banner's Retry button re-runs the mount effect's loader.
  const retryRef = useRef<(() => void) | null>(null);

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
    // A network failure (offline PWA cold start, flaky cellular) used to
    // reject unhandled and leave status "loading" — a blank app until a
    // manual reload (mobile QA 09-06). Retry with backoff and again the
    // moment the browser reports connectivity; never redirect to /login on a
    // network error, the session cookie may be perfectly valid.
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    const load = () => {
      fetchCurrentUser().then(
        (u) => {
          setUnreachable(false);
          apply(u);
        },
        () => {
          if (!mountedRef.current) return;
          setUnreachable(true);
          attempt += 1;
          timer = setTimeout(load, Math.min(15_000, 2_000 * attempt));
        },
      );
    };
    const onOnline = () => {
      if (timer) clearTimeout(timer);
      load();
    };
    window.addEventListener("online", onOnline);
    retryRef.current = onOnline;
    load();
    return () => {
      mountedRef.current = false;
      retryRef.current = null;
      if (timer) clearTimeout(timer);
      window.removeEventListener("online", onOnline);
    };
  }, [apply]);

  // A refresh that can't reach the server keeps whatever session we have —
  // callers fire-and-forget this (`void refresh()`), so a rejection here
  // would be an unhandled one.
  const refresh = useCallback(async () => {
    try {
      apply(await fetchCurrentUser());
    } catch {
      // Network / 5xx: the current user stays; nothing to bounce.
    }
  }, [apply]);

  const setUser = useCallback((next: SessionUser | null) => {
    setUserState(next);
    if (next) setStatus("ready");
  }, []);
  const patchUser = useCallback((patch: Partial<SessionUser>) => {
    setUserState((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ user, status, setUser, patchUser, refresh }),
    [user, status, setUser, patchUser, refresh],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {unreachable && status === "loading" && (
        <div
          role="alert"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-surface-1 px-4 py-2.5 text-sm text-amber-200 shadow-lg shadow-black/40 sm:inset-x-auto sm:right-4 sm:max-w-sm"
        >
          <span>Can&apos;t reach CardFlip — retrying…</span>
          <button
            type="button"
            onClick={() => retryRef.current?.()}
            className="shrink-0 rounded-full border border-amber-500/40 px-3 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-500/10"
          >
            Retry
          </button>
        </div>
      )}
    </SessionContext.Provider>
  );
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
