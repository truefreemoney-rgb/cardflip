import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView from "~/components/SiteWebView";

/** Watchlist tab: the website's /app/wishlist inside the app until its native screen lands (docs/APP-PLAN.md "Hybrid"). */
export default function WatchlistTab() {
  return (
    <Screen>
      <AppHeader />
      <SiteWebView path="/app/wishlist" />
    </Screen>
  );
}
