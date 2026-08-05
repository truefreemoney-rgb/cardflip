"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";
import type { Role } from "@/lib/server/users";

interface Props {
  userId: string;
  role: Role;
  isSelf: boolean;
}

export default function RoleToggle({ userId, role, isSelf }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    const nextRole: Role = role === "admin" ? "user" : "admin";
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPath(`/api/admin/users/${userId}/role`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: nextRole }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update role.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update role.");
      setPending(false);
    }
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-[11px] text-red-400">{error}</span>}
      <button
        onClick={toggle}
        disabled={pending || (isSelf && role === "admin")}
        title={isSelf && role === "admin" ? "You can't remove your own admin access" : undefined}
        className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${
          role === "admin"
            ? "bg-brand-500/15 text-brand-300 hover:bg-brand-500/25"
            : "bg-white/5 text-zinc-400 hover:bg-white/10"
        }`}
      >
        {pending ? "…" : role === "admin" ? "Admin" : "Make admin"}
      </button>
    </div>
  );
}
