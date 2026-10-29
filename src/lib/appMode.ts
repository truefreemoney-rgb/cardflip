/**
 * App mode (docs/APP-PLAN.md "Hybrid", 10-28): the iPhone app shows some
 * website pages inside itself (account, packs, wishlist, rewards, help, price
 * check, subscribe). Those pages must not look like a website in there: no
 * marketing menu, no app header, no tab bar, no footer, no "add to your Home
 * Screen" words. The app opens every page with `?app=1`, and the sign-in
 * handoff (api/auth/app-cookie) also sets this cookie, so a reload inside the
 * app keeps the mode.
 *
 * How it hides: a tiny inline script in the root layout sets
 * `<html data-app="1">` before the first paint (globals.css then hides every
 * element carrying `data-app-hide`). Done on the client so the marketing pages
 * stay static — reading the cookie on the server would make every page render
 * per request.
 */
export const APP_MODE_COOKIE = "cardflip_app";
export const APP_MODE_QUERY = "app";
/** The attribute the script sets on <html>; CSS keys off it. */
export const APP_MODE_ATTR = "data-app";

/** Runs before paint; must stay plain ES5 and never throw (an old WebView is still a customer). */
export const APP_MODE_SCRIPT =
  `(function(){try{if(/[?&]${APP_MODE_QUERY}=1(?:&|$)/.test(location.search)||/(?:^|; )${APP_MODE_COOKIE}=1(?:;|$)/.test(document.cookie)){document.documentElement.setAttribute("${APP_MODE_ATTR}","1")}}catch(e){}})()`;

/** Client-side check for components that need to know (e.g. to skip a redirect); false on the server. */
export function inAppMode(): boolean {
  return typeof document !== "undefined" && document.documentElement.getAttribute(APP_MODE_ATTR) === "1";
}
