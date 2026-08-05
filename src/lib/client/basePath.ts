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
