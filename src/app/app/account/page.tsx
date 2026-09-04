"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import PageSkeleton from "@/components/PageSkeleton";
import { useSession } from "@/components/SessionProvider";
import type { SessionUser } from "@/lib/client/auth";
import { requestTourReplay } from "@/lib/client/tour";
import {
  changePassword,
  deleteAccount,
  fetchAccount,
  openBillingPortal,
  startCheckout,
  signOutOtherDevices,
  totpConfirm,
  totpDisable,
  totpSetup,
  updateProfile,
  type AccountOverview,
  type TotpSetup,
} from "@/lib/client/accountApi";

/**
 * Account settings: who you are (name / sign-in email), password, eBay
 * link, devices, your data, and the exit. One page, sections stacked, each
 * form self-contained with its own busy/error/success state so a failed
 * password change doesn't blank the profile form.
 *
 * The demo account sees everything but can change nothing — it's shared and
 * wiped on entry, so every mutation is disabled with a note saying why.
 */

const inputCls =
  "w-full rounded-lg border border-edge bg-black/40 px-3 py-2.5 text-base text-white outline-none transition placeholder:text-zinc-600 focus:border-brand-400 disabled:opacity-50 sm:text-sm";
const labelCls = "block text-xs font-medium text-zinc-400";
const primaryBtn =
  "rounded-lg bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-400 disabled:opacity-60";

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
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
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
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
  const [billingReturn] = useState<"success" | "canceled" | null>(() => {
    if (typeof window === "undefined") return null;
    const b = new URLSearchParams(window.location.search).get("billing");
    return b === "success" || b === "canceled" ? b : null;
  });
  const [billingPhase, setBillingPhase] = useState<"waiting" | "confirmed" | "stalled">("waiting");
  useEffect(() => {
    if (billingReturn) window.history.replaceState(null, "", window.location.pathname);
  }, [billingReturn]);
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
        if (o.user.subStatus === "active" || o.user.subStatus === "trialing") {
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
  }, [billingReturn, setUser, refresh]);

  // --- Profile -----------------------------------------------------------
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [emailPassword, setEmailPassword] = useState("");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

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
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const demo = overview?.demo ?? false;

  const emailChanged = email.trim().toLowerCase() !== user.email;
  const nameChanged = name.trim() !== user.name;

  async function saveProfile(e: FormEvent) {
    e.preventDefault();
    if (!nameChanged && !emailChanged) return;
    setProfileBusy(true);
    setProfileMsg(null);
    try {
      const next = await updateProfile({
        ...(nameChanged ? { name } : {}),
        ...(emailChanged ? { email, currentPassword: emailPassword } : {}),
      });
      setUser(next);
      setEmailPassword("");
      setProfileMsg({ kind: "ok", text: emailChanged ? "Saved — sign in with your new email next time." : "Saved." });
    } catch (err) {
      setProfileMsg({ kind: "err", text: err instanceof Error ? err.message : "Couldn't save" });
    } finally {
      setProfileBusy(false);
    }
  }

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
    if (newPw.length < 6) return setPwMsg({ kind: "err", text: "New password must be at least 6 characters" });
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
      await totpConfirm(totpCode.trim());
      setTotpEnroll(null);
      setTotpCode("");
      setUser({ ...user, totpEnabled: true });
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
      setUser({ ...user, totpEnabled: false });
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
            {subscribed ? "CardFlip · $9.99/mo" : "Early access"}
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
              Admin console
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

      {demo && (
        <p className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          You&apos;re on the shared demo account — settings are read-only here.{" "}
          <Link href="/signup" className="font-semibold underline">Create your own account</Link> to keep your cards and connect eBay.
        </p>
      )}

      {loading && !overview && (
        <div className="flex items-center gap-2 text-sm text-zinc-500"><Spinner /> Loading…</div>
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
        <Row
          title="eBay"
          status={
            overview ? (
              overview.ebay.connected ? (
                <>
                  <Dot on />Connected{overview.ebay.ebayUsername ? ` as ${overview.ebay.ebayUsername}` : ""}
                  {overview.ebay.connectedAt && <> · since {formatDate(overview.ebay.connectedAt)}</>}
                </>
              ) : demo ? (
                "The demo account can't link an eBay account."
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
            overview && !demo && overview.ebay.available ? (
              <Link
                href="/connect-ebay"
                className={overview.ebay.connected ? rowBtn : "shrink-0 rounded-full bg-ebay px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-ebay-hover"}
              >
                {overview.ebay.connected ? "Manage" : "Connect eBay"}
              </Link>
            ) : undefined
          }
        />
        <PlanSection
          user={overview?.user ?? user}
          quota={overview?.quota}
          demo={demo}
          billingReturn={billingReturn}
          billingPhase={billingPhase}
        />
      </Group>

      <Group label="Security">
        <Row
          title="Password"
          status={demo ? "The demo account can't change its password." : pwOpen ? "Changing it signs out every other device." : "Change it any time; every other device is signed out."}
          action={
            <button type="button" className={rowBtn} onClick={() => (pwOpen ? closePw() : setPwOpen(true))} disabled={demo || pwBusy}>
              {pwOpen ? "Cancel" : "Change"}
            </button>
          }
          open={pwOpen}
        >
          <form onSubmit={savePassword} className="flex flex-col gap-3">
            <label className={labelCls}>
              Current password
              <input type={showPw ? "text" : "password"} className={`${inputCls} mt-1`} value={curPw} onChange={(e) => setCurPw(e.target.value)} disabled={demo || pwBusy} required autoComplete="current-password" />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                New password
                <input type={showPw ? "text" : "password"} className={`${inputCls} mt-1`} value={newPw} onChange={(e) => setNewPw(e.target.value)} disabled={demo || pwBusy} required minLength={6} autoComplete="new-password" />
                <span className={`mt-1 block text-[11px] ${newPw.length === 0 ? "text-zinc-600" : newPw.length >= 6 ? "text-emerald-400" : "text-amber-300"}`}>
                  {newPw.length === 0 ? "At least 6 characters" : newPw.length >= 6 ? "Long enough" : `${6 - newPw.length} more character${6 - newPw.length === 1 ? "" : "s"}`}
                </span>
              </label>
              <label className={labelCls}>
                Repeat new password
                <input type={showPw ? "text" : "password"} className={`${inputCls} mt-1`} value={newPw2} onChange={(e) => setNewPw2(e.target.value)} disabled={demo || pwBusy} required minLength={6} autoComplete="new-password" />
                {newPw2.length > 0 && newPw2 !== newPw && <span className="mt-1 block text-[11px] text-amber-300">Doesn&apos;t match yet</span>}
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" className={primaryBtn} disabled={demo || pwBusy || !curPw || !newPw || !newPw2}>
                {pwBusy ? "Changing…" : "Change password"}
              </button>
              <label className="flex items-center gap-2 text-xs text-zinc-500">
                <input type="checkbox" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} className="accent-brand-500" />
                Show passwords
              </label>
              {!demo && <Link href="/forgot-password" className="ml-auto text-xs text-zinc-500 hover:text-zinc-300">Forgot it?</Link>}
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
            ) : demo ? (
              "The demo account can't use two-step verification."
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
              <button type="button" className={rowPrimary} onClick={startTotp} disabled={demo || totpBusy}>
                {totpBusy ? "Starting…" : "Set up"}
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
                  {totpBusy ? "Turning off…" : "Turn off two-step"}
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
                  {totpBusy ? "Checking…" : "Turn on two-step"}
                </button>
                <button type="button" className="text-sm text-zinc-500 hover:text-zinc-300" onClick={() => { setTotpEnroll(null); setTotpCode(""); setTotpMsg(null); }} disabled={totpBusy}>
                  Cancel
                </button>
              </div>
            </form>
          ) : null}
          {totpMsg && <Notice kind={totpMsg.kind}>{totpMsg.text}</Notice>}
        </Row>

        <Row
          title="Devices"
          status={
            demo
              ? "The shared demo account stays signed in everywhere."
              : d
                ? `Signed in on ${d.sessions} device${d.sessions === 1 ? "" : "s"}, including this one.`
                : "Signed in on a shared or lost phone? Sign it out from here."
          }
          action={
            <button type="button" className={rowBtn} onClick={signOutElsewhere} disabled={demo || devBusy}>
              {devBusy ? "Signing out…" : "Sign out others"}
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
          status={demo ? "The demo account's name and email are fixed." : profileOpen ? "Your name shows in the app header; the email is what you sign in with." : `${user.name} · ${user.email}`}
          action={
            <button type="button" className={rowBtn} onClick={() => (profileOpen ? closeProfile() : setProfileOpen(true))} disabled={demo || profileBusy}>
              {profileOpen ? "Cancel" : "Edit"}
            </button>
          }
          open={profileOpen}
        >
          <form onSubmit={saveProfile} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={labelCls}>
                Name
                <input className={`${inputCls} mt-1`} value={name} onChange={(e) => setName(e.target.value)} disabled={demo || profileBusy} maxLength={80} required autoComplete="name" />
              </label>
              <label className={labelCls}>
                Email
                <input type="email" className={`${inputCls} mt-1`} value={email} onChange={(e) => setEmail(e.target.value)} disabled={demo || profileBusy} required autoComplete="email" inputMode="email" />
              </label>
            </div>
            {emailChanged && (
              <label className={labelCls}>
                Current password <span className="text-zinc-600">(required to change email)</span>
                <input type="password" className={`${inputCls} mt-1`} value={emailPassword} onChange={(e) => setEmailPassword(e.target.value)} disabled={demo || profileBusy} required autoComplete="current-password" />
              </label>
            )}
            <div className="flex items-center gap-3">
              <button type="submit" className={primaryBtn} disabled={demo || profileBusy || (!nameChanged && !emailChanged)}>
                {profileBusy ? "Saving…" : "Save changes"}
              </button>
            </div>
            {profileMsg && <Notice kind={profileMsg.kind}>{profileMsg.text}</Notice>}
          </form>
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
                disabled={demo}
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
                  {delBusy ? "Deleting…" : "Permanently delete"}
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
  demo,
  billingReturn,
  billingPhase,
}: {
  user: SessionUser;
  quota?: { used: number; included: number; remaining: number | null };
  demo: boolean;
  billingReturn: "success" | "canceled" | null;
  billingPhase: "waiting" | "confirmed" | "stalled";
}) {
  const [busy, setBusy] = useState(false);
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

  const status = subscribed ? (
    <>
      <Dot on />
      {user.subStatus === "past_due"
        ? "Last payment failed — update your card."
        : `${user.plan === "pro" ? "Pro · 2,000" : "500"} scans a month${user.subPeriodEnd ? ` · renews ${formatDate(user.subPeriodEnd)}` : ""}.${
            user.plan === "pro" ? "" : " Pro is 2,000 for $24.99 — switch in Manage billing."
          }`}
    </>
  ) : user.tier === "owner" ? (
    <>
      <Dot on />
      Owner account · unlimited scans.
    </>
  ) : user.tier === "legacy" ? (
    <>
      <Dot on />
      {`Early account · ${Math.max(0, 100 - (quota?.used ?? 0))} of 100 scans left today. Subscribe for a monthly allowance: 500 at $9.99 or 2,000 at $24.99.`}
    </>
  ) : user.subStatus === "canceled" ? (
    "Your subscription has ended. Resubscribe to keep scanning."
  ) : demo ? (
    "The demo account can't subscribe."
  ) : (
    `Free trial: ${user.trialScansLeft ?? 0} of 10 scans left. Subscribe for 500 a month at $9.99, or Pro at 2,000 for $24.99.`
  );
  const showBody = billingReturn !== null || (subscribed && !!quota) || !!msg;

  return (
    <Row
      title="Plan"
      status={status}
      action={
        subscribed ? (
          <button type="button" className={rowBtn} onClick={() => go(openBillingPortal)} disabled={busy}>
            {busy ? "Opening…" : "Manage billing"}
          </button>
        ) : (
          <button type="button" className={rowPrimary} onClick={() => go(() => startCheckout("standard"))} disabled={busy || demo}>
            {busy ? "Opening…" : "Subscribe · $9.99/mo"}
          </button>
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
      {subscribed && quota && (
        <div className="max-w-sm">
          <p className="text-xs text-zinc-400">
            {quota.used} of {quota.included} scans used this month
          </p>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full rounded-full ${quota.remaining !== null && quota.remaining <= 0 ? "bg-red-400" : "bg-brand-400"}`}
              style={{ width: `${Math.min(100, (quota.used / quota.included) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-xs text-zinc-600">Your allowance resets at the start of each month.</p>
        </div>
      )}
      {msg && <Notice kind="err">{msg}</Notice>}
    </Row>
  );
}
