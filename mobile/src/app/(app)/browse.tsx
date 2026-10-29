import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView from "~/components/SiteWebView";

/** Search tab: the website's /app/price-check (its Search tab) inside the app, 1:1 (10-29). The native browse it replaced is in git. */
export default function SearchTab() {
  return (
    <Screen>
      <AppHeader />
      <SiteWebView path="/app/price-check" />
    </Screen>
  );
}
