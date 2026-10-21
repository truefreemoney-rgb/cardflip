"use client";

import { useState } from "react";
import { apiPath } from "@/lib/client/basePath";

export default function AdminSignOut() {
  const [failed, setFailed] = useState(false);
  async function signOut() {
    setFailed(false);
    const res = await fetch(apiPath("/api/admin/logout"), { method: "POST" }).catch(() => null);
    // A sign-out the server never confirmed must not look done: the session would still be live behind the login page
    // (review 10-19 admin #1). Said in place, not with alert(): native dialogs can be silent in an installed app.
    if (!res?.ok) {
      setFailed(true);
      return;
    }
    // A full load, not a client hop: nothing of the console stays in memory.
    window.location.replace(apiPath("/admin/login"));
  }
  return (
    <button onClick={signOut} className="text-xs text-zinc-500 transition hover:text-zinc-300">
      {failed ? "Sign Out failed, tap to retry" : "Sign Out"}
    </button>
  );
}
