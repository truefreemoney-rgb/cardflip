"use client";

/**
 * next/link and the router prepend `basePath` automatically, but a raw
 * `fetch()` to an absolute path does not — so every client-side fetch to our
 * own API needs to go through this, or it'll 404 once the app is mounted
 * under a subpath (e.g. superiormarketing.com/cards).
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export function apiPath(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** Default ceiling for an API call; a phone on bad cellular otherwise spins forever. */
export const API_TIMEOUT_MS = 15_000;

/**
 * fetch() to our own API with basePath applied and a timeout attached. Every
 * busy/loading flag in the app waits on one of these promises settling; a
 * stalled socket used to leave the button spinning for good (mobile QA
 * 09-06). A caller's own signal wins; iOS < 16 (no AbortSignal.timeout) just
 * gets a plain fetch.
 */
export function apiFetch(path: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const signal =
    init.signal ?? (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined);
  return fetch(apiPath(path), signal ? { ...init, signal } : init);
}
