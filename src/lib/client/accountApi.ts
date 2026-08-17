"use client";

import { apiPath } from "@/lib/client/basePath";
import type { SessionUser } from "@/lib/client/auth";

export interface AccountOverview {
  user: SessionUser;
  demo: boolean;
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

export async function fetchAccount(): Promise<AccountOverview | null> {
  const res = await fetch(apiPath("/api/account"));
  if (!res.ok) return null;
  return (await readJson(res)) as AccountOverview;
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
