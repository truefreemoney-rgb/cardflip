import AppHeader from "~/components/AppHeader";
import Screen from "~/components/Screen";
import SiteWebView from "~/components/SiteWebView";

/** Account tab: the website's /app/account inside the app (plan, billing, eBay, password, rewards) until its native screen lands. */
export default function AccountTab() {
  return (
    <Screen>
      <AppHeader />
      <SiteWebView path="/app/account" />
    </Screen>
  );
}
