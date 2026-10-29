import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView from "~/components/SiteWebView";

/**
 * Inventory tab: the website's /app/collection inside the app, 1:1 (Chris 10-29 1:21am: the native list
 * "is opening up the card pages, not the pages for the inventory card itself, lots of things wrong"). Seller /
 * Collector, Set Completion, Insights, Packs, the game counts, Unsold / Sold, Search Sort & Filter, Select all,
 * Verify Match, the card's own view and Resume all come from the site. The native list this replaced is in git
 * (this file before 10-29) for when the screen goes native again.
 */
export default function InventoryTab() {
  return (
    <Screen>
      <AppHeader />
      <SiteWebView path="/app/collection" />
    </Screen>
  );
}
