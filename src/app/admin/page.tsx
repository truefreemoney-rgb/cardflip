import Link from "next/link";
import { redirect } from "next/navigation";
import Logo from "@/components/Logo";
import RoleToggle from "@/components/admin/RoleToggle";
import ResetLinkButton from "@/components/admin/ResetLinkButton";
import { clearSessionCookie, getCurrentUser } from "@/lib/server/auth";
import { isDemoUser, listAllUsers, setUserRole } from "@/lib/server/users";
import { getPlatformStats, listAllCards } from "@/lib/server/cards";

async function signOutAction() {
  "use server";
  await clearSessionCookie();
  redirect("/");
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const STATUS_STYLE: Record<string, string> = {
  ready: "bg-emerald-400/10 text-emerald-400",
  listed: "bg-ebay/15 text-sky-300",
  sold: "bg-emerald-500/20 text-emerald-300",
};

export default async function AdminPage() {
  // Admin-only: this page shows every user's email and platform revenue.
  // Bootstrap problem: no signup path ever creates an admin, so the operator
  // is recognized by ADMIN_EMAIL (a Fly secret) and promoted on first visit —
  // after that the role lives in the database like any other admin.
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "admin") {
    const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
    if (adminEmail && user.email.toLowerCase() === adminEmail) {
      setUserRole(user.id, "admin");
      user.role = "admin";
    } else {
      redirect("/app");
    }
  }

  const stats = getPlatformStats();
  const users = listAllUsers();
  const cards = listAllCards(50);
  const userById = new Map(users.map((u) => [u.id, u]));

  const tiles = [
    { label: "Users", value: stats.totalUsers.toLocaleString() },
    { label: "eBay connected", value: stats.connectedUsers.toLocaleString() },
    { label: "Cards scanned", value: stats.totalCards.toLocaleString() },
    { label: "Live listings", value: stats.listedCount.toLocaleString() },
    { label: "Sold", value: stats.soldCount.toLocaleString() },
    { label: "Gross revenue", value: `$${stats.grossRevenue.toFixed(2)}` },
    { label: "Est. platform fees", value: `$${stats.estimatedFees.toFixed(2)}` },
    { label: "Net revenue", value: `$${stats.netRevenue.toFixed(2)}`, accent: true },
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-white/5 bg-background/85 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="flex items-center gap-3">
          <Logo size="sm" />
          <span className="rounded-full bg-brand-500/15 px-2.5 py-0.5 text-xs font-medium text-brand-300">
            Admin
          </span>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/app"
            className="text-sm text-zinc-400 transition hover:text-white"
          >
            ← Back to app
          </Link>
          {user ? (
            <>
              <span className="hidden text-sm text-zinc-400 sm:inline">
                {user.name}
              </span>
              <form action={signOutAction}>
                <button className="text-xs text-zinc-500 transition hover:text-zinc-300">
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="text-xs text-zinc-500 transition hover:text-zinc-300"
            >
              Log in
            </Link>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">Platform overview</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Every account and card on CardFlip, in one place.
          </p>
          {!user && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">
              Viewing without login. Role changes below still require an admin
              session.
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="rounded-2xl border border-edge bg-surface-1 p-4"
            >
              <p
                className={`text-xl font-semibold ${tile.accent ? "text-emerald-400" : "text-white"}`}
              >
                {tile.value}
              </p>
              <p className="mt-0.5 text-xs text-zinc-500">{tile.label}</p>
            </div>
          ))}
        </div>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Users ({users.length})
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">eBay</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Password</th>
                  <th className="px-4 py-3 font-medium text-right">Role</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 font-medium text-white">{u.name}</td>
                    <td className="px-4 py-3 text-zinc-400">{u.email}</td>
                    <td className="px-4 py-3">
                      {u.ebayConnected ? (
                        <span className="text-emerald-400">Connected</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-500">
                      {formatDate(u.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <ResetLinkButton userId={u.id} disabled={isDemoUser(u)} />
                    </td>
                    <td className="px-4 py-3">
                      <RoleToggle userId={u.id} role={u.role} isSelf={u.id === user?.id} />
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                      No users yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Recent cards
          </h2>
          <div className="overflow-x-auto rounded-2xl border border-edge bg-surface-1">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-xs uppercase tracking-wide text-zinc-500">
                  <th className="px-4 py-3 font-medium">Card</th>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Price</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {cards.map((c) => {
                  const owner = userById.get(c.userId);
                  const displayPrice = c.status === "sold" ? c.soldPrice : c.price;
                  return (
                    <tr key={c.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3">
                        <span className="font-medium text-white">{c.cardName}</span>
                        <span className="ml-2 text-xs text-zinc-500">
                          {c.setName} · {c.cardNumber}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {owner?.name ?? "Unknown"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}
                        >
                          {c.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-white">
                        ${(displayPrice ?? 0).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {formatDate(c.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
                {cards.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-zinc-500">
                      No cards scanned yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
