"use client";

import { useEffect } from "react";
import { BASE_PATH } from "@/lib/client/basePath";

/**
 * Registers the service worker (public/sw.js) for the "No signal" page. It is
 * the same file and scope the push row registers (lib/client/push.ts), so the
 * browser keeps one registration; this only makes it exist before push is
 * turned on. Renders nothing.
 */
export default function OfflineWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {});
  }, []);
  return null;
}
