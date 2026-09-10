import FeatureToggles from "@/components/admin/FeatureToggles";
import { GATED_GAMES, gamePublic } from "@/lib/server/settings";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

export default async function AdminSwitchesPage() {
  await requireOwnerPage();
  const games = { mtg: false, lorcana: false, onepiece: false };
  for (const g of GATED_GAMES) games[g] = await gamePublic(g);
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">Switches</h1>
      <div className="rounded-2xl border border-edge bg-surface-1 p-4">
        <FeatureToggles games={games} />
      </div>
    </section>
  );
}
