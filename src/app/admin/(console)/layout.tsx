import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import AdminNav from "@/components/admin/AdminNav";
import AdminKeepAlive from "@/components/admin/AdminKeepAlive";
import AdminSignOut from "@/components/admin/AdminSignOut";
import { adminUsingDefaults, helperName } from "@/lib/adminAuth";
import { adminRole } from "@/lib/server/adminGate";

export const dynamic = "force-dynamic";

/**
 * The console shell: panel-cookie gate, header with one pill per page, and
 * the page body. Each section is its own route (Chris, 09-09: "all on one
 * page is a mess"). /admin/login lives outside this group so it gets no
 * gate and no nav.
 */
export default async function AdminConsoleLayout({ children }: { children: React.ReactNode }) {
  const role = await adminRole();
  if (!role) redirect("/admin/login");
  // A helper (lib/adminAuth.ts) gets the Tasks page and nothing else; every
  // other console page sends her back there (requireOwnerPage).
  const helper = role === "helper";
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <AdminKeepAlive />
      <header className="sticky top-0 z-40 border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Logo size="sm" />
            <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-medium text-brand-300">{helper ? `${helperName()} · helper` : "Admin console"}</span>
          </div>
          {helper ? <span className="rounded-full border border-edge bg-surface-1 px-3 py-1 text-xs text-white">Tasks</span> : <AdminNav />}
          <div className="flex items-center gap-4 text-sm">
            <Link href="/app" className="text-zinc-400 transition hover:text-white">← App</Link>
            <AdminSignOut />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-6 px-4 py-6 sm:px-6">
        {!helper && adminUsingDefaults() && (
          <p className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2.5 text-xs text-amber-200">
            The console is using the built-in operator credentials. Set <code className="rounded bg-black/30 px-1">ADMIN_PANEL_USER</code> and{" "}
            <code className="rounded bg-black/30 px-1">ADMIN_PANEL_PASSWORD</code> in the Vercel project&apos;s environment variables before real users are on the site.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
