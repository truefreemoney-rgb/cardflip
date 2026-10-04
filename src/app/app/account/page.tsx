"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import PricingModeToggle from "@/components/PricingModeToggle";
import PageSkeleton from "@/components/PageSkeleton";
import ConfirmEmailPanel from "@/components/ConfirmEmailPanel";
import { toast } from "@/components/Toaster";
import { useSession } from "@/components/SessionProvider";
import { logout, type SessionUser } from "@/lib/client/auth";
import { changeAccountEmail, changeLanded, mergeUser } from "@/lib/client/emailConfirm";
import { FROZEN_SENTENCE, PRICE, PRICE_SHORT, ROLLOVER_SENTENCE, SCANS } from "@/lib/pricing";
import { PASSWORD_MIN } from "@/lib/passwordRules";
import type { ScanQuota } from "@/lib/quotaTypes";
import { frozenSentence, hasPlanBalance, paymentCredited, planEndsSentence, shortDate } from "@/lib/scanCopy";
import { requestTourReplay } from "@/lib/client/tour";
import { HANDLE_MAX, handleProblem, normalizeHandle, publicCollectionPath } from "@/lib/handle";
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from "@/lib/client/push";
import {
  changePassword,
  deleteAccount,
  fetchAccount,
  fetchInvite,
  openBillingPortal,
  startCheckout,
  signOutOtherDevices,
  totpBackupCodes,
  totpConfirm,
  totpDisable,
  totpSetup,
  updateProfile,
  type AccountOverview,
  type InviteInfo,
  type TotpSetup,
} from "@/lib/client/accountApi";
import { etDate } from "@/lib/time";

/**
 * Account settings: who you are (name / sign-in email), password, eBay
 * link, devices, your data, and the exit. One page, sections stacked, each
 * form self-contained with its own busy/error/success state so a failed
 * password change doesn't blank the profile form.
 */

const inputCls =
  "w-full rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 disabled:opacity-50 sm:text-sm";
const labelCls = "block text-xs font-medium text-zinc-400";
const primaryBtn =
  "rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60";

/** "Sep 30, 2026" — the Eastern calendar day for every viewer (Chris 09-30). */
function formatDate(ts: number): string {
  return etDate(ts);
}

/** A labelled cluster of rows (Selling / Security / ...). */
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{label}</h2>
      <div className="divide-y divide-edge overflow-hidden rounded-2xl border border-edge bg-surface-1">{children}</div>
    </section>
  );
}

/**
 * One settings row: title + current state on the left, the action on the
 * right, and an optional form that unfolds underneath (Chris, 09-04 makeover:
 * a settings page is a list of rows, not five open forms).
 */
function Row({
  title,
  status,
  action,
  open = false,
  hint,
  children,
}: {
  title: string;
  status?: React.ReactNode;
  action?: React.ReactNode;
  open?: boolean;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="px-4 py-3.5 sm:px-5">
      {/* Wraps: on a phone the trial Plan row's two buttons squeezed the text
          into a one-word column (10-01); they drop under it instead. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-[10rem] flex-1">
          <p className="text-sm font-medium text-white">{title}</p>
          {status && <div className="mt-0.5 text-xs text-zinc-500">{status}</div>}
        </div>
        {action}
      </div>
      {open && children && (
        <div className="mt-4 border-t border-edge pt-4">
          {hint && <p className="mb-3 text-xs text-zinc-500">{hint}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

const rowBtn =
  "shrink-0 rounded-full border border-edge px-3.5 py-1.5 text-xs font-semibold text-zinc-200 transition hover:border-edge-strong hover:text-white disabled:cursor-not-allowed disabled:opacity-50";
const rowPrimary =
  "shrink-0 rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50";

function Dot({ on }: { on: boolean }) {
  return <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle ${on ? "bg-emerald-400" : "bg-zinc-600"}`} />;
}

function Notice({ kind, children }: { kind: "ok" | "err"; children: React.ReactNode }) {
  return (
    <p
      role={kind === "err" ? "alert" : "status"}
      className={`mt-3 rounded-lg px-3 py-2 text-sm ${
        kind === "err" ? "bg-red-500/10 text-red-300" : "bg-emerald-400/10 text-emerald-300"
      }`}
    >
      {children}
    </p>
  );
}

export default function AccountPage() {
  const { user, setUser } = useSession();
  // The settings forms seed their inputs from the user, so they only mount
  // once the session has answered.
  if (!user) return <PageSkeleton />;
  return <AccountSettings user={user} setUser={setUser} />;
}

function AccountSettings({
  user,
  setUser,
}: {
  user: SessionUser;
  setUser: (next: SessionUser) => void;
}) {
  const router = useRouter();
  // A confirmed checkout refreshes the session so SubscriptionGate opens.
  const { refresh } = useSession();
  const [overview, setOverview] = useState<AccountOverview | null>(null);
  const [loading, setLoading] = useState(true);

  // Stripe Checkout returns to ?billing=success|canceled. The webhook is the
  // only writer of subStatus, so a single fetch races it — on success we poll
  // the overview until the badge flips. Read at first render (no
  // useSearchParams — that would force a Suspense boundary on the whole page).
  const [billingReturn] = useState<"success" | "canceled" | "ending" | null>(() => {
    if (typeof window === "undefined") return null;
    const b = new URLSearchParams(window.location.search).get("billing");
    return b === "success" || b === "canceled" || b === "ending" ? b : null;
  });
  const [billingPhase, setBillingPhase] = useState<"waiting" | "confirmed" | "stalled">("waiting");
  useEffect(() => {
    if (billingReturn) window.history.replaceState(null, "", window.location.pathname);
  }, [billingReturn]);
  // A plan credit written after this moment is the payment that brought them
  // back (slack for a slow checkout); older ones are past months'.
  const [since] = useState(() => Date.now() - 10 * 60_000);
  useEffect(() => {
    if (billingReturn !== "success") return;
    let cancelled = false;
    let tries = 0;
    const id = setInterval(async () => {
      tries += 1;
      const o = await fetchAccount();
      if (cancelled) return;
      if (o) {
        setOverview(o);
        // Active AND the payment's scans credited: the webhook flips the status
        // first, so "active" alone can still show 0 scans for a moment.
        if ((o.user.subStatus === "active" || o.user.subStatus === "trialing") && paymentCredited(o.quota ?? o.user.scans, since)) {
          setBillingPhase("confirmed");
          void refresh();
          setUser(o.user);
          clearInterval(id);
          return;
        }
      }
      // ~30s of patience; past that the webhook is late enough that hammering
      // the API won't help — the badge still flips on the next visit.
      if (tries >= 15) {
        setBillingPhase("stalled");
        clearInterval(id);
      }
    }, 2000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [billingReturn, setUser, refresh, since]);

  // --- Profile -----------------------------------------------------------
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // An email change waiting for its code (confirmation on): the code goes to
  // the NEW address and the sign-in email switches only when it is typed.
  const [pendingChange, setPendingChange] = useState<{ email: string; expiresAt: number | null } | null>(null);

  // fetchAccount answers null on any failure; without a retry the page used
  // to sit half-rendered forever (no data section, eBay stuck on "Loading…").
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetchAccount()
      .then((o) => {
        if (cancelled) return;
        setOverview(o);
        setOverviewFailed(o === null);
        // A reload (or the phone killing the app while the person was in
        // Mail) must not lose the waiting change: bring the code box back.
        if (o?.pendingEmail) {
          setPendingChange(o.pendingEmail);
          setProfileOpen(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // A walled account fixes its address in the code box above (Change Email),
  // so the profile form leaves the email alone until it is confirmed.
  const walled = Boolean(user.mustConfirmEmail);
  const emailChanged = !walled && email.trim().toLowerCase() !== user.email;
  const nameChanged = name.trim() !== user.name;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!nameChanged && !emailChanged) return;
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      if (emailChanged) {
        // With confirmation on, this mails a code to the new address and does
        // not change users.email yet; with it off, the address is written now.
        const out = await changeAccountEmail({ email, currentPassword: emailPassword, ...(nameChanged ? { name } : {}) });
        setUser(mergeUser(user, out.user));
        setEmailPassword("");
        if (out.pendingEmail) {
          setPendingChange({ email: out.pendingEmail, expiresAt: out.emailCodeExpiresAt });
        } else {
          setProfileMsg({ kind: "ok", text: "Saved — sign in with your new email next time." });
        }
      } else {
        setUser(mergeUser(user, await updateProfile({ name })));
        setProfileMsg({ kind: "ok", text: "Saved." });
      }
    } catch (err) {
      setProfileMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setProfileBusy(false);
    }
  }

  // The code box is done (the wall never comes back: this account was already
  // past it). Only an address that really moved is a change: "already
  // confirmed" from the server means nothing is waiting, which is also what a
  // code that ran out or a request another screen replaced looks like, and
  // then the sign-in email is still the old one. Say so and bring the form back.
  function emailChangeConfirmed(next: SessionUser) {
    const landed = changeLanded(next, pendingChange);
    setUser(mergeUser(user, next));
    setEmail(next.email);
    setPendingChange(null);
    setProfileMsg(
      landed
        ? { kind: "ok", text: "Email changed — sign in with your new email next time." }
        : { kind: "err", text: "That code ran out, so your email didn't change. Enter your new email again to get a new code." },
    );
  }

  // A mistyped new address: drop the code box and show the form again. The
  // code already sent stays good for its hour, and the next address submitted
  // retires it.
  function pickDifferentEmail() {
    setPendingChange(null);
    setEmail(user.email);
    setEmailPassword("");
    setProfileMsg(null);
  }

  // --- Public collection page (Tier 2 #10) --------------------------------
  const [handleOpen, setHandleOpen] = useState(false);
  const [handleDraft, setHandleDraft] = useState(user.handle ?? "");
  const [handleBusy, setHandleBusy] = useState(false);
  const [handleMsg, setHandleMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const handleNorm = normalizeHandle(handleDraft);
  const handleHint = handleNorm ? handleProblem(handleNorm) : null;
  const handleChanged = handleNorm !== (user.handle ?? "");
  const publicUrl = user.handle ? `${typeof window !== "undefined" ? window.location.origin : ""}${publicCollectionPath(user.handle)}` : "";

  async function savePublicPage(patch: { handle?: string; handlePublic?: boolean }) {
    setHandleBusy(true);
    setHandleMsg(null);
    try {
      const next = await updateProfile(patch);
      setUser(next);
      setHandleDraft(next.handle ?? "");
      setHandleMsg({ kind: "ok", text: patch.handlePublic === true ? "Your page is live." : patch.handlePublic === false ? "Your page is private again." : "Saved." });
    } catch (err) {
      setHandleMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setHandleBusy(false);
    }
  }

  async function copyPublicUrl() {
    try {
      await navigator.clipboard.writeText(publicUrl);
      setHandleMsg({ kind: "ok", text: "Link copied." });
    } catch {
      setHandleMsg({ kind: "err", text: publicUrl });
    }
  }

  // --- Phone notifications (Tier 2 #9) -------------------------------------
  const [push, setPush] = useState<PushState | "loading">("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const [pushMsg, setPushMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  useEffect(() => {
    let live = true;
    void pushState().then((s) => {
      if (live) setPush(s);
    });
    return () => {
      live = false;
    };
  }, []);

  async function togglePush() {
    setPushBusy(true);
    setPushMsg(null);
    try {
      if (push === "on") {
        await disablePush();
        setPush("off");
        setPushMsg({ kind: "ok", text: "Notifications are off on this phone." });
      } else {
        await enablePush();
        setPush("on");
        const shown = await sendTestPush();
        setPushMsg({ kind: "ok", text: shown ? "On. A test banner is on its way." : "On. Dips, sales, alerts and support replies will show up here." });
      }
    } catch (err) {
      setPush(await pushState());
      setPushMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't change that" });
    } finally {
      setPushBusy(false);
    }
  }

  const pushStatus =
    push === "loading"
      ? "Checking…"
      : push === "on"
        ? "On for this phone — dips, sales, price alerts and support replies as banners."
        : push === "needs-install"
          ? "Not available in Safari. Add CardFlip to your Home Screen to turn this on."
          : push === "denied"
            ? "Blocked in your phone's settings for CardFlip. Allow it there, then come back."
            : push === "unsupported"
              ? "This browser can't show notifications."
              : "Off. Get dips, sales, price alerts and support replies as phone banners.";

  // --- Password ----------------------------------------------------------
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    setPwMsg(null);
    if (newPw.length < PASSWORD_MIN) return setPwMsg({ kind: "err", text: `New password must be at least ${PASSWORD_MIN} characters` });
    if (newPw !== newPw2) return setPwMsg({ kind: "err", text: "New passwords don't match" });
    setPwBusy(true);
    try {
      const n = await changePassword(curPw, newPw);
      setCurPw(""); setNewPw(""); setNewPw2("");
      setPwMsg({
        kind: "ok",
        text: n > 0 ? `Password changed. ${n} other device${n === 1 ? " was" : "s were"} signed out.` : "Password changed.",
      });
      setOverview((o) => (o ? { ...o, data: { ...o.data, sessions: 1 } } : o));
    } catch (err) {
      setPwMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't change password" });
    } finally {
      setPwBusy(false);
    }
  }

  // --- Two-step verification ---------------------------------------------
  const [totpEnroll, setTotpEnroll] = useState<TotpSetup | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpOffOpen, setTotpOffOpen] = useState(false);
  const [totpOffPw, setTotpOffPw] = useState("");
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpMsg, setTotpMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  // Backup codes (09-04): shown once after setup or a regenerate; the
  // server only keeps hashes, so closing the panel loses them on purpose.
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPw, setBackupPw] = useState("");
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [codesCopied, setCodesCopied] = useState(false);
  function copyCodes() {
    if (!backupCodes) return;
    // The codes are on screen as selectable text, so a failed copy needs no
    // prompt() — which is a no-op in an installed PWA anyway.
    const text = backupCodes.join("\n");
    const write = navigator.clipboard?.writeText?.(text);
    if (!write) return;
    write
      .then(() => {
        setCodesCopied(true);
        setTimeout(() => setCodesCopied(false), 2000);
      })
      .catch(() => {});
  }
  async function regenerateBackupCodes(e: FormEvent) {
    e.preventDefault();
    setBackupBusy(true);
    setBackupMsg(null);
    try {
      const r = await totpBackupCodes(backupPw);
      setBackupCodes(r.backupCodes);
      setBackupOpen(false);
      setBackupPw("");
      setUser({ ...user, totpBackupCodesLeft: r.backupCodes.length });
      setBackupMsg({ kind: "ok", text: "New codes. The old ones no longer work." });
    } catch (err) {
      setBackupMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't make new codes" });
    } finally {
      setBackupBusy(false);
    }
  }

  async function startTotp() {
    setTotpBusy(true);
    setTotpMsg(null);
    try {
      setTotpEnroll(await totpSetup());
      setTotpCode("");
    } catch (err) {
      setTotpMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't start setup" });
    } finally {
      setTotpBusy(false);
    }
  }

  async function confirmTotp(e: FormEvent) {
    e.preventDefault();
    setTotpBusy(true);
    setTotpMsg(null);
    try {
      const r = await totpConfirm(totpCode.trim());
      setTotpEnroll(null);
      setTotpCode("");
      setBackupCodes(r.backupCodes);
      setUser({ ...user, totpEnabled: true, totpBackupCodesLeft: r.backupCodes.length });
      setTotpMsg({ kind: "ok", text: "Two-step verification is on. You'll be asked for a code at every sign-in." });
    } catch (err) {
      setTotpMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't confirm the code" });
    } finally {
      setTotpBusy(false);
    }
  }

  async function disableTotpNow(e: FormEvent) {
    e.preventDefault();
    setTotpBusy(true);
    setTotpMsg(null);
    try {
      await totpDisable(totpOffPw);
      setTotpOffOpen(false);
      setTotpOffPw("");
      setBackupCodes(null);
      setUser({ ...user, totpEnabled: false, totpBackupCodesLeft: 0 });
      setTotpMsg({ kind: "ok", text: "Two-step verification is off." });
    } catch (err) {
      setTotpMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't turn it off" });
    } finally {
      setTotpBusy(false);
    }
  }

  // --- Devices -----------------------------------------------------------
  const [devBusy, setDevBusy] = useState(false);
  const [devMsg, setDevMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  async function signOutElsewhere() {
    setDevBusy(true);
    setDevMsg(null);
    try {
      const n = await signOutOtherDevices();
      setDevMsg({ kind: "ok", text: n > 0 ? `Signed out ${n} other device${n === 1 ? "" : "s"}.` : "No other devices were signed in." });
      setOverview((o) => (o ? { ...o, data: { ...o.data, sessions: 1 } } : o));
    } catch (err) {
      setDevMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't sign out other devices" });
    } finally {
      setDevBusy(false);
    }
  }

  // --- Delete ------------------------------------------------------------
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState("");
  const [delConfirm, setDelConfirm] = useState("");
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState<string | null>(null);
  async function confirmDelete(e: FormEvent) {
    e.preventDefault();
    if (delConfirm.trim().toUpperCase() !== "DELETE") {
      setDelMsg("Type DELETE to confirm");
      return;
    }
    setDelBusy(true);
    setDelMsg(null);
    try {
      await deleteAccount(delPw);
      router.replace("/");
    } catch (err) {
      setDelMsg(err instanceof Error ? err.message : "Couldn't delete the account");
      setDelBusy(false);
    }
  }

  const d = overview?.data;
  const initial = (user.name || user.email || "?").trim().charAt(0).toUpperCase();
  const subscribed = user.subStatus === "active" || user.subStatus === "trialing" || user.subStatus === "past_due";
  const closeProfile = () => {
    setProfileOpen(false);
    setName(user.name);
    setEmail(user.email);
    setEmailPassword("");
    setProfileMsg(null);
  };
  const closePw = () => {
    setPwOpen(false);
    setCurPw("");
    setNewPw("");
    setNewPw2("");
    setPwMsg(null);
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8 sm:px-6">
      {/* Identity card: who this is, plan, and the numbers that matter. */}
      <section className="rounded-2xl border border-edge bg-surface-1 p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-500/20 font-display text-xl font-bold text-brand-200 ring-1 ring-brand-400/30">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-xl font-semibold text-white">{user.name || "Your account"}</h1>
            <p className="truncate text-sm text-zinc-500">{user.email}</p>
          </div>
          <span
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${
              subscribed ? "bg-emerald-400/15 text-emerald-300" : "bg-holo-violet/15 text-holo-violet"
            }`}
          >
            {subscribed ? `${user.plan === "pro" ? "Pro" : "CardFlip"} · ${user.plan === "pro" ? PRICE_SHORT.pro : PRICE_SHORT.standard}` : user.tier === "pack" ? "Scan Pack" : "Free trial"}
          </span>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500">
          <span>Member since {formatDate(user.createdAt)}</span>
          {overview && (
            <span>
              <Dot on={overview.ebay.connected} />
              {overview.ebay.connected ? "eBay connected" : "eBay not connected"}
            </span>
          )}
          <span>
            <Dot on={!!user.totpEnabled} />
            {user.totpEnabled ? "Two-step on" : "Two-step off"}
          </span>
          {user.role === "admin" && (
            <Link href="/admin" className="text-brand-300 hover:underline">
              Admin Console
            </Link>
          )}
        </div>
        {d && (
          <dl className="mt-4 grid grid-cols-4 gap-px overflow-hidden rounded-xl border border-edge bg-edge">
            {[
              ["Cards", d.cards],
              ["Listed", d.listed],
              ["Sold", d.sold],
              ["Watchlist", d.wishlist],
            ].map(([k, v]) => (
              <div key={k} className="bg-black/30 px-3 py-2.5">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{k}</dt>
                <dd className="font-display text-lg font-semibold tabular-nums text-white">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {/* Still waiting on the emailed code: the same screen the app shows,
          here too so the address can be fixed and the code typed from Account. */}
      {user.mustConfirmEmail && (
        <section className="rounded-2xl border border-edge bg-surface-1 p-5">
          <ConfirmEmailPanel
            mode="wall"
            heading="h2"
            compact
            user={user}
            onUser={(next) => setUser(mergeUser(user, next))}
            onConfirmed={(next, how) => {
              setUser(mergeUser(user, next));
              setEmail(next.email);
              if (how !== "released") toast("Email confirmed");
              void refresh();
            }}
          />
        </section>
      )}

      {loading && !overview && (
        <div className="flex items-center gap-2 text-sm text-zinc-500"><Spinner className="h-4 w-4" /> Loading…</div>
      )}

      {overviewFailed && !loading && (
        <div className="flex items-center gap-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">
          <span>Couldn&apos;t load your account details — check your connection.</span>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setOverviewFailed(false);
              setReloadKey((k) => k + 1);
            }}
            className="rounded-md border border-red-400/30 px-3 py-1 text-xs font-medium text-red-200 transition hover:bg-red-500/15"
          >
            Try again
          </button>
        </div>
      )}

      <Group label="Selling">
        {/* Selling · Pricing only (10-04): same switch as Inventory. */}
        <Row
          title="How you use CardFlip"
          status={user.pricingOnly ? "Scan and price only. Nothing about eBay shows." : "Scan, price, and list cards on eBay."}
          action={<PricingModeToggle />}
        />
        {!user.pricingOnly && <Row
          title="eBay"
          status={
            overview ? (
              overview.ebay.connected ? (
                <>
                  <Dot on />Connected{overview.ebay.ebayUsername ? ` as ${overview.ebay.ebayUsername}` : ""}
                  {overview.ebay.connectedAt && <> · since {formatDate(overview.ebay.connectedAt)}</>}
                </>
              ) : user.role !== "admin" && user.tier === "trial" ? (
                "Selling on eBay comes with a plan."
              ) : overview.ebay.available ? (
                "Not connected — drafts you push from the editor land in the eBay account linked here."
              ) : (
                "eBay sign-in isn't configured on this server."
              )
            ) : overviewFailed ? (
              "Couldn't load — use Try again above."
            ) : (
              "Loading…"
            )
          }
          action={
            overview && !overview.ebay.connected && user.role !== "admin" && user.tier === "trial" ? (
              <Link href="/pricing" className="shrink-0 rounded-full bg-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-brand-400">
                Subscribe Now
              </Link>
            ) : overview && overview.ebay.available ? (
              <Link
                href="/connect-ebay"
                data-tour="connect-ebay"
                className={overview.ebay.connected ? rowBtn : "shrink-0 rounded-full bg-ebay px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-ebay-hover"}
              >
                {overview.ebay.connected ? "Manage" : "Connect eBay"}
              </Link>
            ) : undefined
          }
        />}
        <PlanSection
          user={overview?.user ?? user}
          quota={overview?.quota}
          billingReturn={billingReturn}
          billingPhase={billingPhase}
        />
        <div id="invite" className="scroll-mt-24">
          <InviteRow subscribed={subscribed} />
        </div>
      </Group>

      <Group label="Security">
        <Row
          title="Password"
          status={pwOpen ? "Changing it signs out every other device." : "Change it any time; every other device is signed out."}
          action={
            <button type="button" className={rowBtn} onClick={() => (pwOpen ? closePw() : setPwOpen(true))} disabled={pwBusy}>
              {pwOpen ? "Cancel" : "Change"}
            </button>
          }
          open={pwOpen}
        >
          <form onSubmit={savePassword} className="flex flex-col gap-3">
            <label className={labelCls}>
              Current password
              <input type={showPw ? "text" : "password"} className={`${inputCls} mt-1`} value={curPw} onChange={(e) => setCurPw(e.target.value)} disabled={pwBusy} required autoComplete="current-password" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                New password
                <input type={showPw ? "text" : "password"} className={`${inputCls} mt-1`} value={newPw} onChange={(e) => setNewPw(e.target.value)} disabled={pwBusy} required minLength={PASSWORD_MIN} autoComplete="new-password" />
                <span className={`mt-1 block text-[11px] ${newPw.length === 0 ? "text-zinc-600" : newPw.length >= PASSWORD_MIN ? "text-emerald-400" : "text-amber-300"}`}>
                  {newPw.length === 0 ? `At least ${PASSWORD_MIN} characters` : newPw.length >= PASSWORD_MIN ? "Long enough" : `${PASSWORD_MIN - newPw.length} more character${PASSWORD_MIN - newPw.length === 1 ? "" : "s"}`}
                </span>
              </label>
              <label className={labelCls}>
                Repeat new password
                <input type={showPw ? "text" : "password"} className={`${inputCls} mt-1`} value={newPw2} onChange={(e) => setNewPw2(e.target.value)} disabled={pwBusy} required minLength={PASSWORD_MIN} autoComplete="new-password" />
                {newPw2.length > 0 && newPw2 !== newPw && <span className="mt-1 block text-[11px] text-amber-300">Doesn&apos;t match yet</span>}
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={primaryBtn} disabled={pwBusy || !curPw || !newPw || !newPw2}>
                {pwBusy ? "Changing…" : "Change Password"}
              </button>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} className="accent-brand-500" />
                Show passwords
              </label>
              <Link href="/forgot-password" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">Forgot It?</Link>
            </div>
            {pwMsg && <Notice kind={pwMsg.kind}>{pwMsg.text}</Notice>}
          </form>
        </Row>

        <Row
          title="Two-step verification"
          status={
            user.role === "admin" ? (
              "Admin accounts sign in with password only."
            ) : user.totpEnabled ? (
              <><Dot on />On — a code from your authenticator app is asked for at every sign-in.</>
            ) : (
              <><Dot on={false} />Off — only your password protects this account.</>
            )
          }
          action={
            user.totpEnabled ? (
              !totpOffOpen ? (
                <button type="button" className={rowBtn} onClick={() => { setTotpOffOpen(true); setTotpMsg(null); }} disabled={totpBusy}>
                  Turn off
                </button>
              ) : undefined
            ) : !totpEnroll ? (
              <button type="button" data-tour="two-step" className={rowPrimary} onClick={startTotp} disabled={totpBusy}>
                {totpBusy ? "Starting…" : "Set Up"}
              </button>
            ) : undefined
          }
          open={!!totpEnroll || totpOffOpen || !!totpMsg}
        >
          {user.totpEnabled && totpOffOpen ? (
            <form onSubmit={disableTotpNow} className="flex flex-col gap-3">
              <label className={labelCls}>
                Your password <span className="text-zinc-600">(required to turn two-step off)</span>
                <input type="password" className={`${inputCls} mt-1`} value={totpOffPw} onChange={(e) => setTotpOffPw(e.target.value)} required autoComplete="current-password" disabled={totpBusy} />
              </label>
              <div className="flex items-center gap-3">
                <button type="submit" className={primaryBtn} disabled={totpBusy || !totpOffPw}>
                  {totpBusy ? "Turning Off…" : "Turn Off Two-Step"}
                </button>
                <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => { setTotpOffOpen(false); setTotpOffPw(""); }} disabled={totpBusy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : totpEnroll ? (
            <form onSubmit={confirmTotp} className="flex flex-col gap-4">
              <ol className="list-decimal space-y-1 pl-5 text-sm text-zinc-400">
                <li>Open your authenticator app (Google Authenticator, Authy, 1Password…).</li>
                <li>Scan this QR code, or type the setup key below into the app.</li>
                <li>Enter the 6-digit code the app shows to finish.</li>
              </ol>
              <div className="flex flex-wrap items-center gap-5">
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL QR, no optimizer involved */}
                <img src={totpEnroll.qrDataUrl} alt="QR code for your authenticator app" width={160} height={160} className="rounded-lg bg-white p-2" />
                <div className="min-w-0 flex-1">
                  <p className={labelCls}>Setup key (if you can&apos;t scan)</p>
                  <p className="mt-1 break-all font-mono text-xs text-zinc-300">{totpEnroll.secret}</p>
                </div>
              </div>
              <label className={labelCls}>
                6-digit code from the app
                <input
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  autoComplete="one-time-code"
                  className={`${inputCls} mt-1 max-w-40 text-center tracking-[0.4em]`}
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  required
                  disabled={totpBusy}
                />
              </label>
              <div className="flex items-center gap-3">
                <button type="submit" className={primaryBtn} disabled={totpBusy || totpCode.length !== 6}>
                  {totpBusy ? "Checking…" : "Turn on Two-Step"}
                </button>
                <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => { setTotpEnroll(null); setTotpCode(""); setTotpMsg(null); }} disabled={totpBusy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {totpMsg && <Notice kind={totpMsg.kind}>{totpMsg.text}</Notice>}
        </Row>

        {user.totpEnabled && user.role !== "admin" && (
          <Row
            title="Backup codes"
            status={
              backupCodes
                ? "Save these now — they show once. Each works one time in place of an authenticator code."
                : `${user.totpBackupCodesLeft ?? 0} of 8 left. Use one at sign-in if your phone isn't around.`
            }
            action={
              !backupOpen && !backupCodes ? (
                <button type="button" className={rowBtn} onClick={() => { setBackupOpen(true); setBackupMsg(null); }} disabled={backupBusy}>
                  New codes
                </button>
              ) : undefined
            }
            open={backupOpen || !!backupCodes || !!backupMsg}
          >
            {backupCodes ? (
              <div className="flex flex-col gap-3">
                <ul className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-sm text-white sm:grid-cols-4">
                  {backupCodes.map((code) => (
                    <li key={code}>{code}</li>
                  ))}
                </ul>
                <div className="flex items-center gap-3">
                  <button type="button" className={rowBtn} onClick={copyCodes}>
                    {codesCopied ? "Copied ✓" : "Copy All"}
                  </button>
                  <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => setBackupCodes(null)}>
                    I saved them
                  </button>
                </div>
              </div>
            ) : backupOpen ? (
              <form onSubmit={regenerateBackupCodes} className="flex flex-col gap-3">
                <label className={labelCls}>
                  Your password <span className="text-zinc-600">(new codes replace the old ones)</span>
                  <input type="password" className={`${inputCls} mt-1`} value={backupPw} onChange={(e) => setBackupPw(e.target.value)} required autoComplete="current-password" disabled={backupBusy} />
                </label>
                <div className="flex items-center gap-3">
                  <button type="submit" className={primaryBtn} disabled={backupBusy || !backupPw}>
                    {backupBusy ? "Making Codes…" : "Make New Codes"}
                  </button>
                  <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => { setBackupOpen(false); setBackupPw(""); }} disabled={backupBusy}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
            {backupMsg && <p className={`mt-2 text-xs ${backupMsg.kind === "ok" ? "text-emerald-400" : "text-red-400"}`}>{backupMsg.text}</p>}
          </Row>
        )}

        <Row
          title="Devices"
          status={
            d
              ? `Signed in on ${d.sessions} device${d.sessions === 1 ? "" : "s"}, including this one.`
              : "Signed in on a shared or lost phone? Sign it out from here."
          }
          action={
            <button type="button" className={rowBtn} onClick={signOutElsewhere} disabled={devBusy}>
              {devBusy ? "Signing Out…" : "Sign Out Others"}
            </button>
          }
          open={!!devMsg}
        >
          {devMsg && <Notice kind={devMsg.kind}>{devMsg.text}</Notice>}
        </Row>
      </Group>

      <Group label="Profile">
        <Row
          title="Name & email"
          status={
            profileOpen
              ? "Your name shows in the app header; the email is what you sign in with."
              : pendingChange
                ? `${user.name} · ${user.email} · ${pendingChange.email} is waiting for its code`
                : `${user.name} · ${user.email}`
          }
          action={
            <button type="button" className={rowBtn} onClick={() => (profileOpen ? closeProfile() : setProfileOpen(true))} disabled={profileBusy}>
              {profileOpen ? "Cancel" : "Edit"}
            </button>
          }
          open={profileOpen}
        >
          {pendingChange ? (
            <ConfirmEmailPanel
              key={pendingChange.email}
              mode="change"
              user={user}
              pending={pendingChange}
              onConfirmed={emailChangeConfirmed}
              onCancel={pickDifferentEmail}
            />
          ) : (
            <form onSubmit={saveProfile} className="flex flex-col gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  Name
                  <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} disabled={profileBusy} maxLength={80} required autoComplete="name" />
                </label>
                {walled ? (
                  <div className={labelCls}>
                    Email
                    <p className="mt-1 break-all text-sm text-zinc-300">{user.email}</p>
                    <p className="mt-0.5 text-[11px] text-zinc-500">Not confirmed yet. Use Change Email in the box at the top of this page.</p>
                  </div>
                ) : (
                  <label className={labelCls}>
                    Email
                    <input type="email" className={`${inputCls} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} disabled={profileBusy} required autoComplete="email" inputMode="email" />
                  </label>
                )}
              </div>
              {emailChanged && (
                <label className={labelCls}>
                  Current password <span className="text-zinc-600">(required to change email)</span>
                  <input type="password" className={`${inputCls} mt-1`} value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} disabled={profileBusy} required autoComplete="current-password" />
                </label>
              )}
              <div className="flex items-center gap-3">
                <button type="submit" className={primaryBtn} disabled={profileBusy || (!nameChanged && !emailChanged)}>
                  {profileBusy ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </form>
          )}
          {profileMsg && <Notice kind={profileMsg.kind}>{profileMsg.text}</Notice>}
        </Row>
        <Row
          title="Public collection page"
          status={
            user.handlePublic && user.handle ? (
              <>
                <Dot on />
                Live at{" "}
                <a href={publicCollectionPath(user.handle)} target="_blank" rel="noopener noreferrer" className="text-brand-300 underline-offset-2 hover:underline">
                  cardflip.io{publicCollectionPath(user.handle)}
                </a>
              </>
            ) : (
              <>
                <Dot on={false} />
                Private. Share your cards, today&apos;s prices and Buy on eBay links at one address.
              </>
            )
          }
          action={
            <button type="button" className={rowBtn} onClick={() => setHandleOpen((v) => !v)} disabled={handleBusy}>
              {handleOpen ? "Close" : user.handle ? "Edit" : "Set Up"}
            </button>
          }
          open={handleOpen}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (handleChanged && !handleHint) void savePublicPage({ handle: handleNorm });
            }}
            className="flex flex-col gap-3"
          >
            <label className={labelCls}>
              Your address
              <div className="mt-1 flex items-center rounded-lg border border-edge bg-black/40 focus-within:border-brand-400">
                <span className="pl-3 text-sm text-zinc-500">cardflip.io/u/</span>
                <input
                  className="w-full bg-transparent px-1 py-2.5 text-base text-white outline-none placeholder:text-zinc-600 sm:text-sm"
                  value={handleDraft}
                  onChange={(e) => setHandleDraft(e.target.value)}
                  disabled={handleBusy}
                  maxLength={HANDLE_MAX}
                  placeholder="your-name"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </div>
              {handleHint && handleDraft && <span className="mt-1 block text-xs text-amber-300">{handleHint}</span>}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={primaryBtn} disabled={handleBusy || !handleChanged || Boolean(handleHint) || !handleNorm}>
                {handleBusy ? "Saving…" : user.handle ? "Save Address" : "Claim Address"}
              </button>
              {user.handle && (
                <button
                  type="button"
                  className={user.handlePublic ? rowBtn : rowPrimary}
                  disabled={handleBusy || handleChanged}
                  onClick={() => void savePublicPage({ handlePublic: !user.handlePublic })}
                >
                  {user.handlePublic ? "Make Private" : "Make Public"}
                </button>
              )}
              {user.handle && user.handlePublic && (
                <button type="button" className={rowBtn} onClick={() => void copyPublicUrl()}>
                  Copy Link
                </button>
              )}
            </div>
            <p className="text-xs text-zinc-500">Visitors see the cards you own that are not sold, with today&apos;s prices. Your name shows; your email never does. Turn it off any time.</p>
            {handleMsg && <Notice kind={handleMsg.kind}>{handleMsg.text}</Notice>}
          </form>
        </Row>
        <Row
          title="Phone notifications"
          status={
            <>
              <Dot on={push === "on"} />
              {pushStatus}
            </>
          }
          action={
            push === "on" || push === "off" ? (
              <button type="button" className={push === "on" ? rowBtn : rowPrimary} onClick={() => void togglePush()} disabled={pushBusy}>
                {pushBusy ? "…" : push === "on" ? "Turn Off" : "Turn On"}
              </button>
            ) : push === "needs-install" ? (
              <button type="button" className={installOpen ? rowBtn : rowPrimary} onClick={() => setInstallOpen((v) => !v)}>
                {installOpen ? "Close" : "Show Me How"}
              </button>
            ) : undefined
          }
          open={Boolean(pushMsg) || (push === "needs-install" && installOpen)}
        >
          {push === "needs-install" && installOpen && (
            <ol className="list-decimal space-y-2 pl-5 text-sm text-zinc-300">
              <li>Tap the Share button at the bottom of Safari (the square with an arrow pointing up).</li>
              <li>Scroll down and tap <span className="font-semibold text-white">Add to Home Screen</span>, then <span className="font-semibold text-white">Add</span>.</li>
              <li>Open CardFlip from your Home Screen, come back to Account, and tap <span className="font-semibold text-white">Turn On</span>.</li>
            </ol>
          )}
          {pushMsg && <Notice kind={pushMsg.kind}>{pushMsg.text}</Notice>}
        </Row>
      </Group>

      <Group label="Support">
        <Row
          title="Tutorial"
          status="The walk through the scanner, Inventory, Search cards and the watchlist, one page after another."
          action={
            <button
              onClick={() => {
                requestTourReplay();
                router.push("/app");
              }}
              className={rowBtn}
            >
              Replay
            </button>
          }
        />
        <Row
          title="Features"
          status="Everything CardFlip does, on one page, with a link into each screen."
          action={
            <Link href="/features" className={rowBtn}>
              Open
            </Link>
          }
        />
        <Row
          title="Help center"
          status="Short articles on how every part of CardFlip works."
          action={
            <Link href="/help" className={rowBtn}>
              Open
            </Link>
          }
        />
        <Row
          title="Contact"
          status={
            <a href="mailto:support@cardflip.io" className="transition hover:text-zinc-300">
              support@cardflip.io
            </a>
          }
          action={
            /* Build stamp: which deploy this phone is actually running (09-03:
               Chris's iPhone kept an hours-old bundle through a refresh). */
            <span className="shrink-0 font-mono text-[11px] text-zinc-600">
              build {process.env.NEXT_PUBLIC_BUILD_SHA?.slice(0, 7) || "dev"}
            </span>
          }
        />
        {/* Phones have no Sign out in the header (two-row header, 09-07). */}
        <Row
          title="Sign out"
          status="Signs this device out of CardFlip."
          action={
            <button
              onClick={async () => {
                await logout();
                router.push("/");
              }}
              className={rowBtn}
            >
              Sign out
            </button>
          }
        />
      </Group>

      <section>
        <h2 className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-red-400/80">Danger zone</h2>
        <div className="rounded-2xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-red-200">Delete account</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                Removes your cards, photos, watchlist, price checks and eBay link. Anything already on eBay stays on eBay. Can&apos;t be undone.
              </p>
            </div>
            {!delOpen && (
              <button
                type="button"
                className="shrink-0 rounded-full border border-red-500/30 px-3.5 py-1.5 text-xs font-semibold text-red-300 transition hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => setDelOpen(true)}
              >
                Delete…
              </button>
            )}
          </div>
          {delOpen && (
            <form onSubmit={confirmDelete} className="mt-4 flex flex-col gap-3 border-t border-red-500/15 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className={labelCls}>
                  Your password
                  <input type="password" className={`${inputCls} mt-1`} value={delPw} onChange={(e) => setDelPw(e.target.value)} required autoComplete="current-password" disabled={delBusy} />
                </label>
                <label className={labelCls}>
                  Type <span className="font-mono text-zinc-200">DELETE</span> to confirm
                  <input className={`${inputCls} mt-1`} value={delConfirm} onChange={(e) => setDelConfirm(e.target.value)} required disabled={delBusy} autoCapitalize="characters" />
                </label>
              </div>
              <div className="flex items-center gap-3">
                <button type="submit" className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400 disabled:opacity-60" disabled={delBusy || !delPw || delConfirm.trim().toUpperCase() !== "DELETE"}>
                  {delBusy ? "Deleting…" : "Permanently Delete"}
                </button>
                <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => { setDelOpen(false); setDelPw(""); setDelConfirm(""); setDelMsg(null); }} disabled={delBusy}>
                  Cancel
                </button>
              </div>
              {delMsg && <Notice kind="err">{delMsg}</Notice>}
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

/**
 * Billing. Nobody is required to subscribe yet — subscribing is opt-in while
 * early access lasts; enforcement is a later, separate decision. The webhook
 * is the only writer of subStatus, so after checkout the badge updates on the
 * next overview fetch (the ?billing=success return hits a fresh page load).
 */
function PlanSection({
  user,
  quota,
  billingReturn,
  billingPhase,
}: {
  user: SessionUser;
  quota?: ScanQuota;
  billingReturn: "success" | "canceled" | "ending" | null;
  billingPhase: "waiting" | "confirmed" | "stalled";
}) {
  const [busy, setBusy] = useState(false);
  // Back from Stripe restores this page from the back-forward cache with
  // `busy` still true — the button stayed a spinner (mobile QA 09-06).
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);
  const [msg, setMsg] = useState<string | null>(null);
  const subscribed = user.subStatus === "active" || user.subStatus === "trialing" || user.subStatus === "past_due";

  async function go(fn: () => Promise<string>) {
    setBusy(true);
    setMsg(null);
    try {
      window.location.assign(await fn());
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  }

  // Waiting on the emailed code: nothing can be scanned or bought yet (the
  // header hides Subscribe and the counter for the same reason), so no plan
  // buttons that would bounce to the wall.
  const walled = Boolean(user.mustConfirmEmail);

  // Scans roll over (Chris, 09-30): the balance, when the next payment credits
  // more, and, once the plan is set to end, that the banked plan scans pause
  // then. Dates are Eastern. `q` is the same snapshot as the header counter.
  const q = quota ?? user.scans;
  // Only a real rollover subscriber has a plan balance to describe. A subscriber
  // on an admin override (legacy day counter, comp month counter, unlimited, trial)
  // keeps the wording of that tier: the rollover promise is not theirs.
  const rollover = hasPlanBalance(q);
  const scansLeft = (q?.remaining ?? 0).toLocaleString("en-US");
  const scansLeftText =
    q?.remaining === null
      ? "Unlimited scans"
      : rollover
        ? `${scansLeft} scans left`
        : user.tier === "legacy"
          ? `${scansLeft} of ${q?.included.toLocaleString("en-US")} scans left today`
          : user.tier === "trial"
            ? `${scansLeft} of ${q?.included.toLocaleString("en-US")} free scans left`
            : `${scansLeft} scans left`;
  const nextDate = rollover ? shortDate(q?.nextCreditAt) : "";
  const endsDate = shortDate(q?.endsAt);
  const ending = Boolean(user.cancelAtPeriodEnd) || Boolean(endsDate);
  // Plan scans that are banked but cannot be spent (canceled, or the plan ended).
  const pausedNote = q && frozenSentence(q) ? ` ${frozenSentence(q)}.` : "";

  const status = walled ? (
    "Confirm your email to start scanning. Plans open up right after."
  ) : subscribed ? (
    <>
      <Dot on />
      {user.subStatus === "past_due"
        ? `Last payment failed — update your card. ${scansLeftText}.`
        : `${user.plan === "pro" ? "Pro" : "CardFlip"} · ${scansLeftText}${
            ending ? (endsDate ? ` · plan ends ${endsDate}` : "") : nextDate ? ` · next scans on ${nextDate}` : ""
          }.${user.plan === "pro" || ending ? "" : ` Pro is ${SCANS.pro} for ${PRICE.pro} — switch in Manage Billing.`}`}
    </>
  ) : user.tier === "owner" ? (
    <>
      <Dot on />
      Owner account · unlimited scans.
    </>
  ) : user.tier === "legacy" ? (
    <>
      <Dot on />
      {`Early account · ${Math.max(0, 100 - (quota?.used ?? 0))} of 100 scans left today. Subscribe for ${SCANS.standard} scans a month at ${PRICE.standard}, or ${SCANS.pro} at ${PRICE.pro}.${pausedNote}`}
    </>
  ) : user.tier === "pack" ? (
    <>
      <Dot on />
      {`Scan Pack · ${(user.packScans ?? 0).toLocaleString("en-US")} scans left, they never expire. Another pack is ${PRICE.pack}; a subscription is ${SCANS.standard} a month at ${PRICE.standard}.${pausedNote}`}
    </>
  ) : user.subStatus === "canceled" ? (
    `Your subscription has ended. Resubscribe, or buy a ${PRICE.pack} Scan Pack, to keep scanning.${pausedNote}`
  ) : (
    `Free trial: ${user.trialScansLeft ?? 0} of ${SCANS.trial} scans left. A Scan Pack is ${SCANS.pack} scans for ${PRICE.pack} one time; a subscription is ${SCANS.standard} a month at ${PRICE.standard}, or Pro at ${SCANS.pro} for ${PRICE.pro}.${pausedNote}`
  );
  const showBody = billingReturn !== null || (subscribed && !!q) || !!msg;

  return (
    <Row
      title="Plan"
      status={status}
      action={
        walled ? null : subscribed ? (
          <button type="button" data-tour="subscribe" className={rowBtn} onClick={() => go(openBillingPortal)} disabled={busy}>
            {busy ? "Opening…" : "Manage Billing"}
          </button>
        ) : (
          <span className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className={rowBtn} onClick={() => go(() => startCheckout("pack"))} disabled={busy}>
              {busy ? "Opening…" : `Scan Pack · ${PRICE.pack}`}
            </button>
            <button type="button" data-tour="subscribe" className={rowPrimary} onClick={() => go(() => startCheckout("standard"))} disabled={busy}>
              {busy ? "Opening…" : `Subscribe · ${PRICE_SHORT.standard}`}
            </button>
          </span>
        )
      }
      open={showBody}
    >
      {billingReturn === "success" &&
        (billingPhase === "confirmed" ? (
          <Notice kind="ok">Subscription active — thanks for supporting the build!</Notice>
        ) : billingPhase === "stalled" ? (
          <Notice kind="ok">
            Payment received. Stripe is taking longer than usual to confirm — your plan will show as
            active shortly; check back in a minute.
          </Notice>
        ) : (
          <Notice kind="ok">
            <span className="inline-flex items-center gap-2">
              <Spinner className="h-3.5 w-3.5" /> Payment received — confirming your subscription…
            </span>
          </Notice>
        ))}
      {billingReturn === "canceled" && <p className="text-sm text-zinc-400">Checkout canceled — nothing was charged.</p>}
      {billingReturn === "ending" && (
        <Notice kind="ok">
          Your plan stays active until the end of this billing period, then ends. Nothing more will be
          charged.
          {q && (q.plan ?? 0) > 0
            ? ` Your ${(q.plan ?? 0).toLocaleString("en-US")} banked plan scans pause then and come back if you resubscribe.`
            : ""}{" "}
          Changed your mind? Manage Billing can undo it.
        </Notice>
      )}
      {subscribed && q && (
        <div className="max-w-sm">
          <p className="font-display text-2xl font-semibold tabular-nums text-white">
            {q.remaining === null ? (
              "Unlimited scans"
            ) : (
              <>
                {scansLeft}{" "}
                <span className="font-sans text-sm font-normal text-zinc-400">
                  {rollover ? "scans left" : user.tier === "legacy" ? "scans left today" : user.tier === "trial" ? "free scans left" : "scans left"}
                </span>
              </>
            )}
          </p>
          {hasPlanBalance(q) && (
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs text-zinc-400">
              <dt>Plan scans</dt>
              <dd className="text-right tabular-nums text-zinc-200">{q.plan.toLocaleString("en-US")}</dd>
              {q.carried ? (
                <>
                  <dt className="pl-3 text-zinc-500">Carried over from earlier payments</dt>
                  <dd className="text-right tabular-nums text-zinc-400">{q.carried.toLocaleString("en-US")}</dd>
                </>
              ) : null}
              {q.bonus ? (
                <>
                  <dt>Bonus scans from friends</dt>
                  <dd className="text-right tabular-nums text-zinc-200">{q.bonus.toLocaleString("en-US")}</dd>
                </>
              ) : null}
              {q.pack ? (
                <>
                  <dt>Scan Pack scans</dt>
                  <dd className="text-right tabular-nums text-zinc-200">{q.pack.toLocaleString("en-US")}</dd>
                </>
              ) : null}
              {nextDate && (
                <>
                  <dt>Next scans arrive</dt>
                  <dd className="text-right tabular-nums text-zinc-200">{nextDate}</dd>
                </>
              )}
            </dl>
          )}
          {rollover && ending && billingReturn !== "ending" && planEndsSentence(q) && (
            <p role="status" className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              {planEndsSentence(q)}. Changed your mind? Manage Billing can undo it.
            </p>
          )}
          {rollover && (
            <p className="mt-3 text-xs text-zinc-600">
              {ROLLOVER_SENTENCE}
              {ending ? "" : ` ${FROZEN_SENTENCE}`}
            </p>
          )}
          {billingReturn !== "ending" && !ending && (
            <button
              type="button"
              onClick={() => go(() => openBillingPortal("cancel"))}
              disabled={busy}
              className="mt-3 text-xs text-zinc-500 underline decoration-zinc-700 underline-offset-2 transition hover:text-zinc-300 disabled:opacity-60"
            >
              Cancel Plan
            </button>
          )}
        </div>
      )}
      {msg && <Notice kind="err">{msg}</Notice>}
    </Row>
  );
}

/**
 * Invite a friend (Chris, 09-06): subscribers only. Share the link; when the
 * friend subscribes, SCANS.referral bonus scans land here and are spent after the
 * plan scans. Trial accounts see the pitch, not a link.
 */
function InviteRow({ subscribed }: { subscribed: boolean }) {
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!subscribed) return;
    let live = true;
    void fetchInvite().then((i) => {
      if (live) setInfo(i);
    });
    return () => {
      live = false;
    };
  }, [subscribed]);

  async function copy() {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Older iOS: the link is visible below to long-press.
    }
  }

  if (!subscribed) {
    return (
      <Row
        title="Invite a friend"
        status={`Subscribers earn ${SCANS.referral} bonus scans for every friend who subscribes.`}
        action={
          <Link href="/app/rewards" className={rowBtn}>
            How It Works
          </Link>
        }
      />
    );
  }
  return (
    <Row
      title="Invite a friend"
      status={
        info
          ? info.friendsSubscribed > 0
            ? `${info.friendsSubscribed} friend${info.friendsSubscribed === 1 ? "" : "s"} subscribed · ${info.scansEarned.toLocaleString("en-US")} scans earned${info.bonusScans > 0 ? ` · ${info.bonusScans.toLocaleString("en-US")} left` : ""}`
            : `Send your link. When a friend subscribes, you get ${SCANS.referral} bonus scans.`
          : "Loading…"
      }
      action={
        <button type="button" className={rowPrimary} onClick={copy} disabled={!info}>
          {copied ? "Copied" : "Copy Link"}
        </button>
      }
      open={!!info}
    >
      {info && (
        <div className="max-w-md">
          <p className="select-all break-all rounded-lg border border-edge bg-surface-2 px-3 py-2 font-mono text-xs text-zinc-300">{info.url}</p>
          <p className="mt-2 text-xs text-zinc-500">
            {info.friendsJoined} joined so far. Bonus scans are used after your plan scans and never expire.{" "}
            <Link href="/app/rewards" className="text-zinc-400 underline-offset-2 hover:underline">
              How It Works
            </Link>
          </p>
        </div>
      )}
    </Row>
  );
}
