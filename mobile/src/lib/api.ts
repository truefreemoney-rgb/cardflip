import Constants from "expo-constants";
import { Platform } from "react-native";
import { deviceId } from "./device";
import { readToken, writeToken } from "./tokenStore";

/**
 * One door to the cardflip.io API. Every request announces the app
 * (x-cardflip-app, see the site's lib/server/appSession.ts) and carries the
 * session as a bearer token; the server answers login/signup/me with the
 * token in the body, which is kept here. The website's cookie is never used.
 *
 * API_URL: EXPO_PUBLIC_API_URL when set (local dev server or a tunnel),
 * else the live site.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "https://cardflip.io").replace(/\/$/, "");

const APP_VERSION = Constants.expoConfig?.version ?? "0.0.0";
export const APP_HEADER_VALUE = `${Platform.OS}/${APP_VERSION}`;

export class ApiError extends Error {
  readonly status: number;
  readonly body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.error === "string" ? body.error : `Request failed (${status})`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function readJson(res: Response): Promise<Record<string, unknown>> {
  try {
    const j = await res.json();
    return j && typeof j === "object" ? (j as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A renewed token in any answer (login, signup, me) replaces the stored one. */
async function keepSession(body: Record<string, unknown>) {
  const s = body.session as { token?: unknown } | undefined;
  if (s && typeof s.token === "string") await writeToken(s.token);
}

export interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  /** Seconds before giving up (phones lose signal; a hung request must not hang a screen). */
  timeoutS?: number;
}

/**
 * Told when a request that carried the stored token came back 401 from anywhere but a sign-in
 * route: the session died behind the app's back (signed out everywhere, password changed, expired),
 * and AuthProvider re-checks /api/auth/me so the screens follow instead of showing a signed-in
 * header over failing calls (review 10-29).
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}
const SIGN_IN_PATHS = /^\/api\/auth\/(login|signup|apple|google\/finish|logout)\b/;

/** JSON in, JSON out. Throws ApiError on a non-2xx answer with the server's own message. */
export async function api<T = Record<string, unknown>>(path: string, opts: ApiOptions = {}): Promise<T> {
  const token = await readToken();
  const headers: Record<string, string> = { accept: "application/json", "x-cardflip-app": APP_HEADER_VALUE, "x-cardflip-device": await deviceId() };
  if (token) headers.authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const ctl = new AbortController();
  // The clock covers the whole answer, body included: a reply whose headers arrive and whose body then
  // stalls on a weak signal used to hang the caller for good (the launch check held the splash forever).
  const timer = setTimeout(() => ctl.abort(), (opts.timeoutS ?? 20) * 1000);
  let res: Response;
  let body: Record<string, unknown>;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctl.signal,
    });
    body = await readJson(res);
  } catch (err) {
    throw new ApiError(0, { error: (err as Error)?.name === "AbortError" ? "That took too long. Check your connection and try again." : "No connection. Check your signal and try again." });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    if (res.status === 401 && token && !SIGN_IN_PATHS.test(path)) onUnauthorized?.();
    throw new ApiError(res.status, body);
  }
  await keepSession(body);
  return body as T;
}
