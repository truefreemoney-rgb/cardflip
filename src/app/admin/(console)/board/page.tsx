import AdminBoard from "@/components/admin/AdminBoard";
import HelperBoard from "@/components/admin/HelperBoard";
import { helperName } from "@/lib/adminAuth";
import { adminRole } from "@/lib/server/adminGate";
import { loadBoard } from "@/lib/server/board";
import { etDateTime } from "@/lib/time";

export const dynamic = "force-dynamic";

export default async function AdminBoardPage() {
  const [board, role] = await Promise.all([loadBoard(), adminRole()]);
  if (role === "helper") {
    return (
      <section>
        <h1 className="mb-3 text-2xl font-semibold text-white">Tasks</h1>
        <HelperBoard sections={board.sections} name={helperName()} />
      </section>
    );
  }
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-white">Tasks</h1>
        <p className="text-xs text-zinc-500">
          Live — edit it here{board.updatedAt ? ` · updated ${etDateTime(board.updatedAt)}` : ""}
        </p>
      </div>
      <AdminBoard sections={board.sections} updatedAt={board.updatedAt} />
    </section>
  );
}
