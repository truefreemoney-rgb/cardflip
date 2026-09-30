import UsersTabs from "@/components/admin/UsersTabs";
import { requireOwnerPage } from "@/lib/server/adminPage";

/**
 * Users section shell: the All Users / Active Users tabs over whichever
 * view is open. Owner only, like every page in it; the console layout only
 * checks for a panel session, so a helper is sent back to Tasks here too.
 */
export default async function AdminUsersLayout({ children }: { children: React.ReactNode }) {
  await requireOwnerPage();
  return (
    <div>
      <UsersTabs />
      {children}
    </div>
  );
}
