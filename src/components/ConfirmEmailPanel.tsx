"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { logout, type SessionUser } from "@/lib/client/auth";
import {
  CODE_LENGTH,
  CODE_TTL_MS,
  REFUSED_MESSAGE,
  SEND_FAILED_MESSAGE,
  RESEND_COOLDOWN_SECONDS,
  VerifyError,
  checkVerifyState,
  digitsOnly,
  pollDelayMs,
  requestCode,
  submitCode,
} from "@/lib/client/emailConfirm";

/**
 * The one email-confirmation screen: signup step 2, the wall in /app, and the
 * code box under an account-page email change.
 *
 *   signup / wall  the account is walled; the panel shows where the code went,
 *                  takes it, and can send a new one, change the address or log out
 *   change         an established account moved its email; the code goes to the
 *                  NEW address and users.email switches only when it is typed
 *
 * It never reads SessionProvider: the signup page is outside it (useSession
 * throws there). Every call returns the fresh user, so the caller gets it
 * through onUser / onConfirmed and decides what to do (the wall calls refresh(),
 * signup moves to its last step, the account page merges it into the session).
 *
 * The code box takes any paste ("482 913", "Code: 482913"), so it has no
 * maxLength and strips non-digits itself, and it submits on the sixth digit.
 * The Confirm Email button stays for anyone who wants to tap it. autoFocus is a
 * convenience, not a promise: iOS only raises the keyboard from a tap.
 *
 * The wall also watches for the account being let in from elsewhere (the
 * button in the mail opens in Safari, a different cookie jar from the
 * installed app): a cheap poll every 5 s, 30 s after about two minutes, and an
 * immediate look whenever the app comes back to the front.
 */

export type ConfirmHow = "code" | "poll" | "already" | "released";
type PanelMode = "signup" | "wall" | "change";

const FIELD =
  "w-full rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";
const CODE_FIELD =
  "w-full rounded-lg border border-edge bg-black/40 px-3 py-3 text-center text-2xl font-semibold tabular-nums tracking-[0.4em] text-white outline-none transition placeholder:text-zinc-700 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/20";
const QUIET = "py-2 text-sm text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline disabled:cursor-default disabled:opacity-60 disabled:no-underline";

interface Message {
  kind: "ok" | "err" | "info";
  text: string;
}

export default function ConfirmEmailPanel({
  mode,
  user,
  pending,
  refused: refusedAtStart = false,
  heading = "h1",
  compact = false,
  onUser,
  onConfirmed,
  onCancel,
}: {
  mode: PanelMode;
  /** The account as the server last described it (walled for signup / wall; established for change). */
  user: SessionUser;
  /** change: the address the code went to and when it stops working. */
  pending?: { email: string; expiresAt: number | null };
  /** signup: the mail server refused the address, so ask for a corrected one first. */
  refused?: boolean;
  /** The heading tag: h1 where the panel is the page (signup, the wall), h2 inside another page. */
  heading?: "h1" | "h2";
  /** Leave out Log Out and the Help link (the page around it already has them). */
  compact?: boolean;
  /** A newer snapshot of the same account (a new address, a new code). */
  onUser?: (user: SessionUser) => void;
  /** The account is through: a code, the link elsewhere, or our mail was down and it was let in. */
  onConfirmed: (user: SessionUser, how: ConfirmHow) => void;
  /** change: "Use a Different Email", the way out of a mistyped new address. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const inputId = useId();
  const emailId = useId();
  const codeRef = useRef<HTMLInputElement>(null);

  const [address, setAddress] = useState(pending?.email ?? user.email);
  const [expiresAt, setExpiresAt] = useState<number | null>(pending ? pending.expiresAt : (user.emailCodeExpiresAt ?? null));
  // A code just went out at signup or a resend; the server allows the next one 30 s after the last.
  const [cooldownUntil, setCooldownUntil] = useState(() => {
    const at = pending ? pending.expiresAt : user.emailCodeExpiresAt;
    return at ? at - CODE_TTL_MS + RESEND_COOLDOWN_SECONDS * 1000 : 0;
  });
  // The Change Email form's own gap. It is set only from a real server answer
  // (a code just sent, or a 429), never worked out from the code's expiry as
  // above: a signup mails its first code without touching the account's resend
  // allowance, so a person fixing a typo right after signup can send at once.
  const [changeGapUntil, setChangeGapUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"code" | "send" | "change" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [dead, setDead] = useState(false);
  const [refused, setRefused] = useState(refusedAtStart);
  const [changing, setChanging] = useState(refusedAtStart);
  const [newEmail, setNewEmail] = useState(refusedAtStart ? user.email : "");
  const [signedOut, setSignedOut] = useState(false);

  // Latest callbacks, so the poll effect below does not re-subscribe on every render.
  const latest = useRef({ onUser, onConfirmed });
  useEffect(() => {
    latest.current = { onUser, onConfirmed };
  });
  const working = useRef(false);
  const settled = useRef(false);
  const autoSent = useRef(false);

  const cooling = cooldownUntil > now;
  const cooldownLeft = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const changeCooling = changeGapUntil > now;
  const changeGapLeft = Math.max(0, Math.ceil((changeGapUntil - now) / 1000));
  const noLiveCode = dead || expiresAt === null || expiresAt <= now;

  // Wake the clock only when something on screen changes with it: each second
  // while a resend gap runs, otherwise at the moment the code runs out.
  useEffect(() => {
    const t = Date.now();
    const gaps = [cooldownUntil, changeGapUntil].filter((at) => at > t);
    const next = [...gaps, expiresAt ?? 0].filter((at) => at > t);
    if (next.length === 0) return;
    const wait = gaps.length > 0 ? Math.min(1000, Math.min(...next) - t) : Math.min(...next) - t + 50;
    const id = setTimeout(() => setNow(Date.now()), Math.max(50, wait));
    return () => clearTimeout(id);
  }, [now, cooldownUntil, changeGapUntil, expiresAt]);

  function settle(next: SessionUser, how: ConfirmHow) {
    if (settled.current) return;
    settled.current = true;
    latest.current.onConfirmed(next, how);
  }

  function failMessage(err: unknown, fallback: string): Message {
    return { kind: "err", text: err instanceof VerifyError ? err.message : fallback };
  }

  // --- typing the code ---------------------------------------------------------

  async function submit(raw: string) {
    const digits = digitsOnly(raw);
    if (working.current) return;
    if (digits.length !== CODE_LENGTH) {
      setMessage({ kind: "err", text: "Enter the 6-digit code." });
      codeRef.current?.focus();
      return;
    }
    working.current = true;
    setBusy("code");
    setMessage(null);
    try {
      const out = await submitCode(digits);
      settle(out.user, out.alreadyConfirmed ? "already" : "code");
    } catch (err) {
      setCode("");
      if (err instanceof VerifyError && err.code === "signed_out") {
        setSignedOut(true);
      } else if (err instanceof VerifyError && (err.code === "expired" || err.code === "too_many")) {
        // Nothing left to type into: the next step is a new code.
        setDead(true);
        setMessage({ kind: "err", text: err.message });
      } else {
        setMessage(failMessage(err, "That code didn't work. Try again."));
        codeRef.current?.focus();
      }
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  function onCodeInput(raw: string) {
    const digits = digitsOnly(raw);
    setCode(digits);
    if (digits.length === CODE_LENGTH) void submit(digits);
  }

  // --- sending a code ------------------------------------------------------------

  async function sendCode(to?: string, auto = false) {
    if (working.current) return;
    working.current = true;
    setBusy(to ? "change" : "send");
    setMessage(null);
    try {
      const out = await requestCode(to);
      if (out.kind !== "sent") {
        settle(out.user, out.kind === "released" ? "released" : "already");
        return;
      }
      const where = out.pendingEmail ?? out.user.email;
      setAddress(where);
      setExpiresAt(out.expiresAt);
      setCooldownUntil(Date.now() + out.cooldownSeconds * 1000);
      setChangeGapUntil(Date.now() + out.cooldownSeconds * 1000);
      setNow(Date.now());
      setDead(false);
      setRefused(false);
      setChanging(false);
      setCode("");
      setMessage({ kind: "ok", text: to ? `Code sent to ${where}.` : auto ? "Your last code ran out, so we sent a new one." : "New code sent." });
      latest.current.onUser?.(out.user);
    } catch (err) {
      if (err instanceof VerifyError && err.code === "signed_out") {
        setSignedOut(true);
      } else if (err instanceof VerifyError && err.code === "recipient_refused") {
        if (err.user) {
          setAddress(err.user.email);
          latest.current.onUser?.(err.user);
        }
        setMessage({ kind: "err", text: REFUSED_MESSAGE });
        if (mode !== "change") {
          setRefused(true);
          setChanging(true);
          setNewEmail(err.user?.email ?? address);
        }
      } else {
        if (err instanceof VerifyError && err.code === "slow_down" && err.retryAfterSeconds && err.retryAfterSeconds < 90) {
          setCooldownUntil(Date.now() + err.retryAfterSeconds * 1000);
          setChangeGapUntil(Date.now() + err.retryAfterSeconds * 1000);
          setNow(Date.now());
        }
        setMessage(failMessage(err, SEND_FAILED_MESSAGE));
      }
    } finally {
      working.current = false;
      setBusy(null);
    }
  }

  // The wall came up with no live code (the last one ran out while the app was
  // closed): send one, once, instead of claiming "we sent a code". A code that
  // is still good is never replaced, and a screen that mounts again does not
  // send again, because the new code is live by then.
  useEffect(() => {
    if (mode !== "wall" || refused || (expiresAt !== null && expiresAt > Date.now())) return;
    const id = setTimeout(() => {
      if (autoSent.current) return;
      autoSent.current = true;
      void sendCode(undefined, true);
    }, 0);
    return () => clearTimeout(id);
    // Runs for the state at mount; sendCode reads current state itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- notice being let in from elsewhere -------------------------------------

  useEffect(() => {
    if (mode === "change") return;
    let cancelled = false;
    let checking = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => void check(), pollDelayMs(Date.now() - started));
    };
    const check = async () => {
      if (cancelled || checking || settled.current) return;
      checking = true;
      try {
        const state = await checkVerifyState();
        if (cancelled) return;
        if (!state) {
          setSignedOut(true);
          return;
        }
        if (!state.pending) {
          settle(state.user, "poll");
          return;
        }
        // Another tab may have resent or moved the address: follow the server.
        setAddress(state.user.email);
        setExpiresAt(state.user.emailCodeExpiresAt ?? null);
      } catch {
        // Offline or a hiccup: the next look tries again.
      } finally {
        checking = false;
      }
      if (timer) clearTimeout(timer);
      schedule();
    };
    const lookNow = () => {
      if (document.visibilityState === "hidden") return;
      if (timer) clearTimeout(timer);
      void check();
    };
    schedule();
    document.addEventListener("visibilitychange", lookNow);
    window.addEventListener("focus", lookNow);
    window.addEventListener("pageshow", lookNow);
    window.addEventListener("online", lookNow);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", lookNow);
      window.removeEventListener("focus", lookNow);
      window.removeEventListener("pageshow", lookNow);
      window.removeEventListener("online", lookNow);
    };
  }, [mode]);

  function leave() {
    const go = () => router.replace("/login");
    void logout().then(go, go);
  }

  const sendLabel = cooling ? `Send a New Code (${cooldownLeft}s)` : "Send a New Code";
  const showCodeForm = !noLiveCode && !refused;
  const Heading = heading;
  const standalone = mode !== "change" && !compact;
  const helpLink = !standalone ? null : (
    <Link href="/app/help" className="mt-1 inline-block py-2 text-xs text-zinc-500 underline-offset-4 transition hover:text-zinc-300 hover:underline">
      Still nothing? Ask Us in Help
    </Link>
  );

  let body: React.ReactNode;
  if (refused) {
    body = (
      <>
        We couldn&apos;t send a code to <strong className="break-words font-semibold text-zinc-200">{address}</strong>. Fix the address and we&apos;ll send a new one.
      </>
    );
  } else if (noLiveCode) {
    body = (
      <>
        Tap Send a New Code and we&apos;ll email a fresh 6-digit code to <strong className="break-words font-semibold text-zinc-200">{address}</strong>.
      </>
    );
  } else if (mode === "change") {
    body = (
      <>
        We sent a 6-digit code to <strong className="break-words font-semibold text-zinc-200">{address}</strong>. Your sign-in email changes when you enter it.
      </>
    );
  } else {
    body = (
      <>
        We sent a 6-digit code to <strong className="break-words font-semibold text-zinc-200">{address}</strong>.
      </>
    );
  }

  return (
    <div className={mode === "change" ? "" : "text-center"}>
      {mode !== "change" && (
        <Heading className="text-xl font-semibold text-white">{refused ? "Check the address" : "Check your email"}</Heading>
      )}
      <p className={`text-sm leading-relaxed text-zinc-400 ${mode === "change" ? "" : "mt-2"}`}>{body}</p>

      {signedOut ? (
        <div className="mt-5">
          <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-xs font-medium text-red-400">
            You&apos;re signed out. Log in to continue.
          </p>
          <Link href="/login" className="mt-4 inline-flex rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400">
            Log In
          </Link>
        </div>
      ) : (
        <>
          {showCodeForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit(code);
              }}
              noValidate
              className="mt-5 flex flex-col gap-3"
            >
              <label htmlFor={inputId} className="sr-only">
                6-digit code
              </label>
              <input
                ref={codeRef}
                id={inputId}
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]*"
                enterKeyHint="go"
                autoFocus
                value={code}
                onChange={(e) => onCodeInput(e.target.value)}
                className={CODE_FIELD}
                placeholder="123456"
              />
              <button
                type="submit"
                disabled={busy !== null}
                className="flex items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
              >
                {busy === "code" && <Spinner className="h-4 w-4" />}
                {busy === "code" ? "Confirming…" : "Confirm Email"}
              </button>
            </form>
          )}

          <p role="alert" aria-live="polite" className="min-h-0">
            {message && (
              <span
                className={`mt-3 block rounded-lg px-3 py-2 text-xs font-medium ${
                  message.kind === "err" ? "bg-red-500/10 text-red-400" : message.kind === "ok" ? "bg-emerald-400/10 text-emerald-300" : "bg-white/5 text-zinc-300"
                }`}
              >
                {message.text}
              </span>
            )}
          </p>

          {showCodeForm && (
            <p className="mt-3 text-xs text-zinc-500">The code works for 1 hour. You can also tap the button in the email.</p>
          )}

          {noLiveCode && !refused && (
            <button
              type="button"
              onClick={() => void sendCode()}
              disabled={busy !== null || cooling}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-brand-500/25 transition hover:bg-brand-400 disabled:opacity-60"
            >
              {busy === "send" && <Spinner className="h-4 w-4" />}
              {busy === "send" ? "Sending…" : sendLabel}
            </button>
          )}

          {changing && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void sendCode(newEmail.trim());
              }}
              noValidate
              className="mt-5 flex flex-col gap-2 text-left"
            >
              <label htmlFor={emailId} className="text-sm font-medium text-zinc-300">
                Email
              </label>
              <input
                id={emailId}
                name="email"
                type="email"
                autoComplete="email"
                inputMode="email"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="send"
                autoFocus
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className={FIELD}
                placeholder="you@example.com"
              />
              <div className="flex items-center gap-4">
                <button
                  type="submit"
                  disabled={busy !== null || changeCooling || !newEmail.trim()}
                  className="flex items-center justify-center gap-2 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60"
                >
                  {busy === "change" && <Spinner className="h-4 w-4" />}
                  {busy === "change" ? "Sending…" : changeCooling ? `Send Code (${changeGapLeft}s)` : "Send Code"}
                </button>
                {!refused && (
                  <button type="button" className={QUIET} onClick={() => setChanging(false)} disabled={busy !== null}>
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          <div className={`mt-3 flex flex-wrap items-center gap-x-5 gap-y-0 text-sm ${mode === "change" ? "" : "justify-center"}`}>
            {showCodeForm && (
              <button type="button" className={QUIET} onClick={() => void sendCode()} disabled={busy !== null || cooling}>
                {sendLabel}
              </button>
            )}
            {mode !== "change" && !changing && (
              <button
                type="button"
                className={QUIET}
                onClick={() => {
                  setChanging(true);
                  setNewEmail(address);
                  setMessage(null);
                }}
                disabled={busy !== null}
              >
                Change Email
              </button>
            )}
            {standalone && (
              <button type="button" className={QUIET} onClick={leave}>
                Log Out
              </button>
            )}
            {mode === "change" && onCancel && (
              // The way out of a mistyped new address: the box goes away and the
              // form comes back. The code already sent stays good for its hour
              // (a different address kills it when it is submitted).
              <button type="button" className={QUIET} onClick={onCancel}>
                Use a Different Email
              </button>
            )}
          </div>
          {helpLink}
        </>
      )}
    </div>
  );
}
