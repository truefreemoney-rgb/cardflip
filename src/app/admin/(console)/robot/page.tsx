import RobotChats from "@/components/admin/RobotChats";
import { listRobotChats } from "@/lib/server/helpChat";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

/**
 * Robot chats (10-14): every help-robot conversation of the last 7 days, the ones a seller marked
 * "Not helpful" first. Read them like tickets: each one is a place the product failed before a
 * human saw it (docs/LESSONS.md).
 */
export default async function AdminRobotPage() {
  await requireOwnerPage();
  const chats = await listRobotChats(7);
  const down = chats.reduce((n, c) => n + c.thumbsDown, 0);
  return (
    <section>
      <h1 className="mb-1 text-2xl font-semibold text-white">Robot chats</h1>
      <p className="mb-3 text-xs text-zinc-500">
        Last 7 days, {chats.length} conversation{chats.length === 1 ? "" : "s"}, {down} repl{down === 1 ? "y" : "ies"} marked not helpful. Not-helpful first, then where the robot got stuck.
      </p>
      <RobotChats chats={chats} />
    </section>
  );
}
