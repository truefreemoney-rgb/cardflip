/**
 * Stand-in for the website's lib/client/basePath.ts when its lib code runs
 * inside the app (tsconfig paths + metro.config.js map "@/lib/client/basePath"
 * here and every other "@/lib/*" to ../src/lib). The site's catalog helpers
 * (lib/cards.ts: searchTyped, fetchSets, fetchSetCards, fetchCardById) call
 * fetch(apiPath(...)); here apiPath makes that an absolute URL on the API.
 * Public catalog routes need no session, so no bearer header is added.
 */
import { API_URL } from "../api";

export const BASE_PATH = API_URL;

export function apiPath(path: string): string {
  return `${API_URL}${path}`;
}

export const API_TIMEOUT_MS = 15_000;

export function apiFetch(path: string, init: RequestInit = {}, timeoutMs = API_TIMEOUT_MS): Promise<Response> {
  const signal = init.signal ?? (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined);
  return fetch(apiPath(path), signal ? { ...init, signal } : init);
}
