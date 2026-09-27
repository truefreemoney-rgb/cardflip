import SupportTickets from "@/components/admin/SupportTickets";
import { listAllTickets } from "@/lib/server/supportTickets";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

/**
 * Support tickets (Chris 09-26): everything sellers opened from the robot.
 * The conversation happens here: click a ticket, reply in its chat (the
 * seller sees it in Help and gets a "You Received a Reply" mail), close it
 * when done (which emails the seller). support@cardflip.io only gets the
 * alerts. Tabs, search and the counter live in the client list.
 */
export default async function AdminSupportPage({ searchParams }: { searchParams: Promise<{ ticket?: string }> }) {
  await requireOwnerPage();
  // ?ticket=<id> opens that thread straight away (the overview links here).
  const [{ ticket }, tickets] = await Promise.all([searchParams, listAllTickets()]);
  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold text-white">Support</h1>
      <p className="mb-3 text-xs text-zinc-500">
        Click a ticket to read the thread and reply. The seller gets an email for each reply and when you close it. support@cardflip.io only gets the alerts.
      </p>
      <SupportTickets initial={tickets} initialOpen={ticket ?? null} />
    </section>
  );
}
