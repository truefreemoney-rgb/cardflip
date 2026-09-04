"use client";

import { apiPath } from "@/lib/client/basePath";
import type { SessionUser } from "@/lib/client/auth";

export interface AccountOverview {
  user: SessionUser;
  demo: boolean;
  /** Scan metering; remaining is null when the cap isn't enforced (no subscription). */
  quota?: { used: number; included: number; remaining: number | null };
  data: {
    cards: number;
    listed: number;
    sold: number;
    wishlist: number;
    priceChecks: number;
    sessions: number;
  };
  ebay: {
    available: boolean;
    connected: boolean;
    ebayUsername: string | null;
    connectedAt: number | null;
  };
}

async function readJson(res: Response) {
  return res.json().catch(() => ({}));
}

/** Throws with the server's message so forms can show it verbatim. */
async function expectOk<T>(res: Response): Promise<T> {
  const data = await readJson(res);
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Null on any failure — server or network — so callers show a retry, not a crash. */
export async function fetchAccount(): Promise<AccountOverview | null> {
  try {
    const res = await fetch(apiPath("/api/account"));
    if (!res.ok) return null;
    return (await readJson(res)) as AccountOverview;
  } catch {
    return null;
  }
}

export async function updateProfile(patch: {
  name?: string;
  email?: string;
  currentPassword?: string;
}): Promise<SessionUser> {
  const res = await fetch(apiPath("/api/account"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return (await expectOk<{ user: SessionUser }>(res)).user;
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<number> {
  const res = await fetch(apiPath("/api/account/password"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  return (await expectOk<{ signedOutElsewhere: number }>(res)).signedOutElsewhere;
}

export async function signOutOtherDevices(): Promise<number> {
  const res = await fetch(apiPath("/api/account/sessions"), { method: "DELETE" });
  return (await expectOk<{ signedOut: number }>(res)).signedOut;
}

export async function deleteAccount(password: string): Promise<void> {
  const res = await fetch(apiPath("/api/account"), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  await expectOk(res);
}

// --- Billing (Stripe) -------------------------------------------------------

/** Answers the Stripe Checkout URL to redirect to. */
export async function startCheckout(plan: "standard" | "pro" = "standard"): Promise<string> {
  const res = await fetch(apiPath("/api/billing/checkout"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  return (await expectOk<{ url: string }>(res)).url;
}

/** Answers the Stripe billing-portal URL (cancel, change card, invoices). */
export async function openBillingPortal(): Promise<string> {
  const res = await fetch(apiPath("/api/billing/portal"), { method: "POST" });
  return (await expectOk<{ url: string }>(res)).url;
}

// --- Two-step verification (TOTP) ------------------------------------------

export interface TotpSetup {
  secret: string;
  otpauthUrl: string;
  qrDataUrl: string;
}

async function totpAction<T>(body: Record<string, string>): Promise<T> {
  const res = await fetch(apiPath("/api/account/totp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return expectOk<T>(res);
}

/** Begin enrollment: a fresh secret plus the QR the authenticator app scans. */
export const totpSetup = () => totpAction<TotpSetup>({ action: "setup" });

/** Confirm the first code; two-step is on from the next sign-in. */
export const totpConfirm = (code: string) => totpAction<{ ok: true; backupCodes: string[] }>({ action: "confirm", code });
export const totpBackupCodes = (password: string) => totpAction<{ ok: true; backupCodes: string[] }>({ action: "backup-codes", password });

/** Turn two-step off (needs the account password, not a code). */
export const totpDisable = (password: string) => totpAction<{ ok: true }>({ action: "disable", password });
