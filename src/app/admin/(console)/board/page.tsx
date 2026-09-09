import AdminBoard from "@/components/admin/AdminBoard";
import { loadBoard } from "@/lib/server/board";

export const dynamic = "force-dynamic";

export default async function AdminBoardPage() {
  const board = await loadBoard();
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-semibold text-white">Board</h1>
        <p className="text-xs text-zinc-500">
          Live — edit it here{board.updatedAt ? ` · updated ${new Date(board.updatedAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
        </p>
      </div>
      <AdminBoard sections={board.sections} />
    </section>
  );
}
