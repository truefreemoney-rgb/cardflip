"use client";

import { useRouter } from "next/navigation";
import { apiPath } from "@/lib/client/basePath";

export default function AdminSignOut() {
  const router = useRouter();
  async function signOut() {
    await fetch(apiPath("/api/admin/logout"), { method: "POST" }).catch(() => {});
    router.replace("/admin/login");
    router.refresh();
  }
  return (
    <button onClick={signOut} className="text-xs text-zinc-500 transition hover:text-zinc-300">
      Sign out
    </button>
  );
}
