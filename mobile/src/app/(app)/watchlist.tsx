import WebTab from "~/components/WebTab";

/** Watchlist tab: the website's /app/wishlist inside the app until its native screen lands (docs/APP-PLAN.md "Hybrid"). */
export default function WatchlistTab() {
  return <WebTab path="/app/wishlist" />;
}
