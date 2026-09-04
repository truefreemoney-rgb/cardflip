/**
 * Guided walkthroughs the help robot can hand out (Chris, 09-04: "give a
 * link to the page and tutorial them through the question"). Each guide is
 * a few spotlight steps on the real pages, run by the same engine as the
 * first-login tour (TourOverlay). Steps whose anchor isn't on the page yet
 * (the editor only exists after a scan) show as a centred card.
 *
 * Shared by the server (the robot's prompt lists them) and the client (the
 * chat renders "Walk me through it" for a known id). Keep ids stable —
 * they're what the model writes back.
 */

export interface GuideStep {
  /** Page the step lives on (under /app). */
  path: string;
  /** CSS selector of the element to spotlight; none = centred card. */
  sel?: string;
  round?: boolean;
  title: string;
  body: string;
}

export interface Guide {
  id: string;
  title: string;
  /** One line for the robot: when to offer this guide. */
  when: string;
  steps: GuideStep[];
}

export const GUIDES: Guide[] = [
  {
    id: "connect-ebay",
    title: "Connect eBay",
    when: "the seller asks how to connect, link or reconnect eBay, or why publishing says connect first",
    steps: [
      { path: "/app/account", sel: '[data-tour="connect-ebay"]', round: true, title: "Connect eBay", body: "Tap this, approve on eBay's page, and you're back here connected. I never see your eBay password." },
    ],
  },
  {
    id: "publish",
    title: "Publish a card on eBay",
    when: "the seller asks how to list, sell or publish a card, or why the Publish button is locked",
    steps: [
      { path: "/app", sel: '[data-tour="capture"]', round: true, title: "Scan it", body: "Every listing starts from a real photo. Scan the card or upload a photo." },
      { path: "/app", title: "Verify, then Publish", body: "In the editor, check the match and tap Verify match. That unlocks Publish on eBay, photo included." },
    ],
  },
  {
    id: "reprice",
    title: "Change a listed price",
    when: "the seller asks how to change, lower or raise a price, including on a live eBay listing",
    steps: [
      { path: "/app/collection", sel: '[aria-label="Filter cards by name, set or number"]', title: "Find the card", body: "Search by name, set or number." },
      { path: "/app/collection", title: "Tap the price", body: "Tap the price on any unsold card and type a new one. A live listing changes on eBay in the same step." },
    ],
  },
  {
    id: "watchlist-alert",
    title: "Get emailed when a price dips",
    when: "the seller asks about alerts, price drops, or watching a card they don't own",
    steps: [
      { path: "/app/wishlist", sel: 'input[placeholder^="Name or number"]', title: "Add the card", body: "Search it here and tap Add. By set works too." },
      { path: "/app/wishlist", sel: '[data-tour="alert"]', round: true, title: "Set a target", body: "Tap Alert on the card and type the price you'd pay. One email when it dips, then quiet." },
    ],
  },
  {
    id: "two-step",
    title: "Turn on two-step verification",
    when: "the seller asks about security, 2FA, authenticator apps or backup codes",
    steps: [
      { path: "/app/account", sel: '[data-tour="two-step"]', round: true, title: "Set up", body: "Tap Set up, scan the QR with any authenticator app, enter one code. You'll get eight backup codes — save them." },
    ],
  },
  {
    id: "subscribe",
    title: "Subscribe or manage billing",
    when: "the seller asks about paying, plans, the free trial ending, cancelling or invoices",
    steps: [
      { path: "/app/account", sel: '[data-tour="subscribe"]', round: true, title: "Your plan", body: "Subscribe here, or open the billing portal to switch plans, cancel or see invoices. Stripe handles the card." },
    ],
  },
  {
    id: "inventory",
    title: "Find your cards",
    when: "the seller asks where a scanned card went, how to see listed, ended or sold cards, or how to switch Image and Text view",
    steps: [
      { path: "/app/collection", sel: '[aria-label="Card game"]', round: true, title: "Inventory", body: "Every card you scanned. Pokémon and Magic are kept apart." },
      { path: "/app/collection", sel: '[aria-label="Switch view"]', round: true, title: "Image or Text", body: "Pictures or a list. Filters above sort by in play, listed, ended and sold." },
    ],
  },
  {
    id: "search",
    title: "Price a card without scanning",
    when: "the seller asks what a card is worth without having it, or how to browse a whole set",
    steps: [
      { path: "/app/price-check", sel: 'input[placeholder^="Name or number"]', title: "Search cards", body: "Name or number, or switch to By set for every card in a set. Same live pricing." },
    ],
  },
];

export const GUIDE_IDS = GUIDES.map((g) => g.id);
export function guideById(id: string): Guide | undefined {
  return GUIDES.find((g) => g.id === id);
}

/** In-app pages the robot may link to, with the label the chat shows. */
export const HELP_LINKS: Record<string, string> = {
  "/app": "Scanner",
  "/app/collection": "Inventory",
  "/app/price-check": "Search cards",
  "/app/wishlist": "Watchlist",
  "/app/account": "Account",
  "/help": "Help articles",
  "/pricing": "Pricing",
};

/** Tags the model writes: {{guide:id}} and {{link:/path}}. Parsed by the chat. */
export const TAG_RE = /\{\{(guide|link):([^}]+)\}\}/g;
