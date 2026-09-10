import AdminUsersTable from "@/components/admin/AdminUsersTable";
import { getAdminOverview } from "@/lib/server/adminStats";
import { listAllUsers, monthlyScans, scanTier } from "@/lib/server/users";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  await requireOwnerPage();
  const [o, all] = await Promise.all([getAdminOverview(), listAllUsers()]);
  const users = all.map((u) => ({
    id: u.id, name: u.name, email: u.email, role: u.role, ebayConnected: u.ebayConnected, createdAt: u.createdAt,
    tier: scanTier(u), plan: u.plan, scansUsed: u.scansUsed, monthlyScans: monthlyScans(u), trialScansUsed: u.trialScansUsed,
    accessOverride: u.accessOverride, subStatus: u.subStatus,
  }));
  return (
    <section>
      <div className="mb-3">
        <h1 className="text-2xl font-semibold text-white">Users <span className="text-sm font-normal text-zinc-500">({users.length})</span></h1>
        <p className="mt-0.5 text-xs text-zinc-500">Tap a row for plan, reset link, role and delete. Add account creates a seller by hand.</p>
      </div>
      <AdminUsersTable users={users} rollups={o.userRollups} />
    </section>
  );
}
