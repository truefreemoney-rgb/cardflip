import SupportTickets from "@/components/admin/SupportTickets";
import { listAllTickets } from "@/lib/server/supportTickets";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

/**
 * Support tickets (Chris 09-26): everything sellers opened from the robot.
 * The mail in support@cardflip.io is where the conversation happens; this
 * page is where a ticket is closed (which emails the seller) or reopened.
 * Tabs, search and the counter live in the client list so they follow a close.
 */
export default async function AdminSupportPage() {
  await requireOwnerPage();
  const tickets = await listAllTickets();
  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold text-white">Support</h1>
      <p className="mb-3 text-xs text-zinc-500">
        Each ticket is also an email in support@cardflip.io (subject SUPPORT TICKET #n). Reply there; close here. Closing emails the seller.
      </p>
      <SupportTickets initial={tickets} />
    </section>
  );
}
