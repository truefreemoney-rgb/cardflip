import SupportTickets from "@/components/admin/SupportTickets";
import { listAllTickets } from "@/lib/server/supportTickets";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

/**
 * Support tickets (Chris 09-26): everything sellers opened from the robot.
 * The mail in support@cardflip.io is where the conversation happens; this
 * page is where a ticket is closed (which emails the seller) or reopened.
 */
export default async function AdminSupportPage() {
  await requireOwnerPage();
  const tickets = await listAllTickets();
  const open = tickets.filter((t) => t.status === "open").length;
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold text-white">Support</h1>
        <span className={`text-xs ${open ? "text-amber-300" : "text-zinc-500"}`}>
          {open ? `${open} in progress` : "nothing in progress"} · {tickets.length} total
        </span>
      </div>
      <p className="mb-3 text-xs text-zinc-500">
        Each ticket is also an email in support@cardflip.io (subject SUPPORT TICKET #n). Reply there; close here. Closing emails the seller.
      </p>
      <SupportTickets initial={tickets} />
    </section>
  );
}
