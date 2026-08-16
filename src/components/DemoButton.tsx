"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Spinner from "@/components/Spinner";
import { startDemoSession } from "@/lib/client/auth";

export default function DemoButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function startDemo() {
    setLoading(true);
    try {
      await startDemoSession();
      router.replace("/app");
    } catch {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={startDemo}
      disabled={loading}
      className="flex items-center justify-center gap-2 rounded-full border border-edge-strong px-7 py-3.5 text-sm font-semibold text-zinc-200 transition hover:-translate-y-0.5 hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60"
    >
      {loading && <Spinner className="h-4 w-4" />}
      Try it now — skip login
    </button>
  );
}
