"use client";

import { apiFetch, apiPath } from "@/lib/client/basePath";
import type { SessionUser } from "@/lib/client/auth";

/**
 * Email confirmation, the browser side (server: lib/server/emailVerify.ts,
 * which is server-only, so the two numbers the screens need are mirrored here).
 *
 * A signup that is walled proves its inbox with a 6-digit code typed in the
 * app, or the button in the same email. Nothing in this file touches
 * SessionProvider: the signup page sits outside it, so every call returns the
 * fresh user and the caller decides what to do with it.
 */

/** How long a code works (emailVerify.CODE_TTL_MS). */
export const CODE_TTL_MS = 60 * 60 * 1000;
/** The gap between codes the server enforces (emailVerify.RESEND_COOLDOWN_SECONDS). */
export const RESEND_COOLDOWN_SECONDS = 30;
export const CODE_LENGTH = 6;

/** Shown when a request never reached the server (offline, timeout). */
export const NETWORK_MESSAGE = "We couldn't reach CardFlip. Check your connection and try again.";
export const SEND_FAILED_MESSAGE = "We couldn't send the email. Tap Send a New Code.";
export const SIGNED_OUT_MESSAGE = "You're signed out. Log in to continue.";
/** The mail server refused the address: the person's typo to fix. */
export const REFUSED_MESSAGE = "That address didn't accept our email. Check it and try again.";

/**
 * What a code box holds: digits only, six at most. "482 913" and "Code: 482913"
 * pasted in both come out as 482913, so the field has no maxLength (a
 * maxLength would cut the paste before the letters were dropped).
 */
export function digitsOnly(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

/** How long to wait before the wall asks again: every 5 s, then every 30 s after about 2 minutes. */
export function pollDelayMs(elapsedMs: number): number {
  return elapsedMs < 120_000 ? 5_000 : 30_000;
}

/**
 * The user the server just described, laid over the one we hold (which may
 * carry fields the verify routes leave out: features, hasCards). The code
 * expiry only exists while walled, so it is dropped once the wall is gone.
 */
export function mergeUser(prev: SessionUser | null, next: SessionUser): SessionUser {
  const merged: SessionUser = { ...prev, ...next };
  if (!next.mustConfirmEmail) delete merged.emailCodeExpiresAt;
  return merged;
}

/** "Wait 24 seconds", "about 40 minutes" or "about 20 hours": never a raw "3421s" (mirrors emailVerify.waitMessage). */
export function waitMessage(seconds: number): string {
  if (seconds < 90) return `Wait ${seconds} second${seconds === 1 ? "" : "s"}, then try again.`;
  if (seconds < 90 * 60) return `Too many tries. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
  return `Too many tries. Try again in about ${Math.ceil(seconds / 3600)} hours.`;
}

/**
 * Did the account end up on the address the waiting change asked for? The
 * server's "already confirmed" only means nothing is waiting any more, which is
 * also what a code that ran out (or a request another screen replaced) looks
 * like, and then users.email is still the old address. The account page shows
 * "Email changed" only when this is true.
 */
export function changeLanded(next: Pick<SessionUser, "email">, pending: { email: string } | null): boolean {
  return pending !== null && next.email.toLowerCase() === pending.email.toLowerCase();
}

/** A refused request, with what the server said about it. */
export class VerifyError extends Error {
  code: string;
  status: number;
  triesLeft?: number;
  retryAfterSeconds?: number;
  /** Set on some refusals (recipient_refused) so the caller can show the current address. */
  user?: SessionUser;
  constructor(message: string, code: string, status: number, extra: { triesLeft?: number; retryAfterSeconds?: number; user?: SessionUser } = {}) {
    super(message);
    this.name = "VerifyError";
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

interface VerifyBody {
  ok?: boolean;
  error?: string;
  message?: string;
  code?: string;
  user?: SessionUser;
  pending?: boolean;
  wasPending?: boolean;
  alreadyConfirmed?: boolean;
  sent?: boolean;
  emailSent?: boolean;
  released?: boolean;
  emailCodeExpiresAt?: number | null;
  cooldownSeconds?: number;
  pendingEmail?: string;
  triesLeft?: number;
  retryAfterSeconds?: number;
  state?: string;
  email?: string | null;
  already?: boolean;
}

async function send(path: string, init?: RequestInit): Promise<{ res: Response; data: VerifyBody }> {
  let res: Response;
  try {
    res = await apiFetch(path, init);
  } catch {
    throw new VerifyError(NETWORK_MESSAGE, "network", 0);
  }
  const data = (await res.json().catch(() => ({}))) as VerifyBody;
  return { res, data };
}

function post(path: string, body: object): Promise<{ res: Response; data: VerifyBody }> {
  return send(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

/** The verify family answers { error: <machine code>, message: <human text> }. */
function refusal(res: Response, data: VerifyBody, fallback: string): VerifyError {
  if (res.status === 401) return new VerifyError(SIGNED_OUT_MESSAGE, "signed_out", 401);
  // A 429 from the plain per-IP limiter has no message, only "try again in 3421s".
  const wait = res.status === 429 && !data.message && data.retryAfterSeconds ? waitMessage(data.retryAfterSeconds) : null;
  return new VerifyError(data.message ?? wait ?? fallback, data.error ?? "failed", res.status, {
    triesLeft: data.triesLeft,
    retryAfterSeconds: data.retryAfterSeconds,
    user: data.user,
  });
}

// --- the wall ----------------------------------------------------------------

export interface VerifyState {
  pending: boolean;
  user: SessionUser;
}

/**
 * The wall's cheap poll. null = signed out. Throws on a network failure or a
 * 5xx: the caller just asks again later.
 */
export async function checkVerifyState(): Promise<VerifyState | null> {
  const res = await apiFetch("/api/auth/verify-email");
  if (res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new Error(`verify-email ${res.status}`);
  const data = (await res.json().catch(() => ({}))) as VerifyBody;
  return data.user ? { pending: Boolean(data.pending), user: data.user } : null;
}

export interface CodeOutcome {
  user: SessionUser;
  /** True when this call is the one that lifted the wall. */
  wasPending: boolean;
  /** The account was already through (link, reset, another tab): just clear the wall. */
  alreadyConfirmed: boolean;
}

/** Type the code. Throws VerifyError: invalid_code, wrong_code, too_many, expired, email_taken, slow_down, signed_out. */
export async function submitCode(code: string): Promise<CodeOutcome> {
  const { res, data } = await post("/api/auth/verify-email", { code });
  if (!res.ok || !data.user) throw refusal(res, data, "That code didn't work. Try again.");
  return { user: data.user, wasPending: Boolean(data.wasPending), alreadyConfirmed: Boolean(data.alreadyConfirmed) };
}

export type SendOutcome =
  /** A code is on its way; emailCodeExpiresAt says when it stops working. */
  | { kind: "sent"; user: SessionUser; expiresAt: number; cooldownSeconds: number; pendingEmail: string | null }
  /** Our mail is down, so the wall was lifted instead of stranding the account. */
  | { kind: "released"; user: SessionUser }
  /** Nothing was waiting: the account is already through. */
  | { kind: "confirmed"; user: SessionUser };

/**
 * Mail a code. No argument: a fresh code to the address on file (or, for an
 * established account, the email change waiting). With an address: Change
 * Email on a walled account. Throws VerifyError: invalid_email,
 * disposable_email, email_taken, recipient_refused (carries user), slow_down,
 * mail_unavailable, use_account, signed_out.
 */
export async function requestCode(email?: string): Promise<SendOutcome> {
  const { res, data } = await post("/api/auth/verify-email/resend", email ? { email } : {});
  if (!res.ok || !data.user) throw refusal(res, data, SEND_FAILED_MESSAGE);
  if (data.alreadyConfirmed) return { kind: "confirmed", user: data.user };
  if (data.released) return { kind: "released", user: data.user };
  return {
    kind: "sent",
    user: data.user,
    expiresAt: data.emailCodeExpiresAt ?? Date.now() + CODE_TTL_MS,
    cooldownSeconds: data.cooldownSeconds ?? RESEND_COOLDOWN_SECONDS,
    pendingEmail: data.pendingEmail ?? null,
  };
}

// --- the Confirm Email button in the mail ------------------------------------

export type LinkState = "valid" | "confirmed" | "replaced" | "expired";

/** Look at a link without using it (safe: a mail scanner's prefetch does the same). Throws on a network or server failure. */
export async function peekConfirmLink(token: string): Promise<{ state: LinkState; email: string | null }> {
  let res: Response;
  try {
    res = await apiFetch(`/api/auth/confirm-email?t=${encodeURIComponent(token)}`);
  } catch {
    throw new VerifyError(NETWORK_MESSAGE, "network", 0);
  }
  const data = (await res.json().catch(() => ({}))) as VerifyBody;
  if (!res.ok) throw refusal(res, data, "We couldn't check this link. Try again.");
  const state: LinkState = data.state === "valid" || data.state === "confirmed" || data.state === "replaced" ? data.state : "expired";
  return { state, email: data.email ?? null };
}

/**
 * Use the link (the button on /confirm-email). Never signs anyone in. Throws
 * VerifyError whose code is replaced, expired, email_taken, slow_down or invalid.
 */
export async function confirmLink(token: string): Promise<{ already: boolean; email: string | null }> {
  const { res, data } = await post("/api/auth/confirm-email", { t: token });
  if (!res.ok || !data.ok) throw refusal(res, data, "That link didn't work. Try again.");
  return { already: Boolean(data.already), email: data.email ?? null };
}

// --- the account page --------------------------------------------------------

export interface EmailChangeOutcome {
  user: SessionUser;
  /** Established account: the new address the code went to (users.email changes when it is typed). */
  pendingEmail: string | null;
  emailCodeExpiresAt: number | null;
  /** Walled account: the address was moved and a code went to it. */
  emailSent: boolean;
  /** Walled account: our mail was down, so the wall was lifted. */
  released: boolean;
}

/**
 * PATCH /api/account with a new email. The account family answers
 * { error: <human text>, code? } (except its 429s, which are the verify
 * family's { error: "slow_down", message }). A walled account needs no
 * password (that address was never proven); an established account does.
 * A name change can ride along in the same call. Throws VerifyError whose
 * message is ready to show.
 */
export async function changeAccountEmail(change: { email: string; currentPassword?: string; name?: string }): Promise<EmailChangeOutcome> {
  const { res, data } = await send("/api/account", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(change),
  });
  if (!res.ok || !data.user) {
    const wait = res.status === 429 && !data.message && data.retryAfterSeconds ? waitMessage(data.retryAfterSeconds) : null;
    throw new VerifyError(data.message ?? wait ?? data.error ?? `Request failed (${res.status})`, data.code ?? (data.message ? data.error : undefined) ?? "failed", res.status, {
      retryAfterSeconds: data.retryAfterSeconds,
      user: data.user,
    });
  }
  return {
    user: data.user,
    pendingEmail: data.pendingEmail ?? null,
    emailCodeExpiresAt: data.emailCodeExpiresAt ?? null,
    emailSent: Boolean(data.emailSent),
    released: Boolean(data.released),
  };
}

/** Where a walled account taps through to when it tries to pay: the wall lives at /app. */
export function walledDestination(): string {
  return apiPath("/app");
}
