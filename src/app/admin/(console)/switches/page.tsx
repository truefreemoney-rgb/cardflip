import FeatureToggles from "@/components/admin/FeatureToggles";
import EmailConfirmSwitch from "@/components/admin/EmailConfirmSwitch";
import EbayLocalMarketsSwitch from "@/components/admin/EbayLocalMarketsSwitch";
import { GATED_GAMES, ebayLocalMarketsOn, gamePublic } from "@/lib/server/settings";
import { emailConfirmStats } from "@/lib/server/emailVerify";
import { requireOwnerPage } from "@/lib/server/adminPage";

export const dynamic = "force-dynamic";

export default async function AdminSwitchesPage() {
  await requireOwnerPage();
  const games = { mtg: false, lorcana: false, onepiece: false, yugioh: false };
  for (const g of GATED_GAMES) games[g] = await gamePublic(g);
  const email = await emailConfirmStats();
  const localMarkets = await ebayLocalMarketsOn();
  return (
    <section>
      <h1 className="mb-3 text-2xl font-semibold text-white">Switches</h1>
      <div className="space-y-4 rounded-2xl border border-edge bg-surface-1 p-4">
        <FeatureToggles games={games} />
        <div className="border-t border-edge pt-4">
          <EmailConfirmSwitch stats={email} />
        </div>
        <div className="border-t border-edge pt-4">
          <EbayLocalMarketsSwitch on={localMarkets} />
        </div>
      </div>
    </section>
  );
}
