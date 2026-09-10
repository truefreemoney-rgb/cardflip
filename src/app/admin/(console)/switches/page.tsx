import FeatureToggles from "@/components/admin/FeatureToggles";
import { magicPublic } from "@/lib/server/settings";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

export default async function AdminSwitchesPage() {
  await requireOwnerPage();
  const magicOn = await magicPublic();
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">Switches</h1>
      <div className="rounded-2xl border border-edge bg-surface-1 p-4">
        <FeatureToggles magicPublic={magicOn} />
      </div>
    </section>
  );
}
