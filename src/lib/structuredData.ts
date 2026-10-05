import { SITE_URL } from "@/lib/siteUrl";
import type { HelpArticle } from "@/lib/helpArticles";
import { PRICING } from "@/lib/pricing";

/**
 * The schema.org graphs the public pages carry (components/JsonLd.tsx).
 * Kept as plain data so a test can pin the shape without rendering.
 */

const ORG_ID = `${SITE_URL}/#organization`;
const APP_ID = `${SITE_URL}/#app`;

export const DESCRIPTION =
  "Scan your Pokémon, Magic, Lorcana, Yu-Gi-Oh! and One Piece cards, get real market prices, and turn a whole binder into eBay listings in minutes.";

const usd = (n: number) => n.toFixed(2);

/** Every way in, from the same ladder the pricing page prints (lib/pricing.ts): the free trial, the Scan Pack, both plans. */
function offers() {
  const offer = (name: string, price: number, description: string, extra: Record<string, unknown> = {}) => ({
    "@type": "Offer",
    name,
    price: usd(price),
    priceCurrency: "USD",
    description,
    url: `${SITE_URL}/pricing`,
    availability: "https://schema.org/InStock",
    ...extra,
  });
  const monthly = (price: number) => ({
    priceSpecification: { "@type": "UnitPriceSpecification", price: usd(price), priceCurrency: "USD", billingIncrement: 1, unitCode: "MON" },
  });
  return [
    offer("Free trial", 0, `${PRICING.trial.scans} card scans, no card needed`),
    offer("Scan Pack", PRICING.pack.price, `${PRICING.pack.scans.toLocaleString("en-US")} card scans, one time, no subscription`),
    offer("CardFlip", PRICING.standard.price, `${PRICING.standard.scans.toLocaleString("en-US")} card scans a month`, monthly(PRICING.standard.price)),
    offer("CardFlip Pro", PRICING.pro.price, `${PRICING.pro.scans.toLocaleString("en-US")} card scans a month`, monthly(PRICING.pro.price)),
  ];
}

/** Landing page only (it was on every page, /app and /login included): who we are, the site, and the product with its plans. */
export function siteGraph() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: "CardFlip",
        url: SITE_URL,
        logo: `${SITE_URL}/icon.png`,
        email: "support@cardflip.io",
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        url: SITE_URL,
        name: "CardFlip",
        description: DESCRIPTION,
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "SoftwareApplication",
        "@id": APP_ID,
        name: "CardFlip",
        url: SITE_URL,
        description: DESCRIPTION,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web, iOS, Android",
        image: `${SITE_URL}/opengraph-image`,
        publisher: { "@id": ORG_ID },
        offers: offers(),
      },
    ],
  };
}

/** /help: every article as a question + answer (FAQ rich result). */
export function faqGraph(articles: HelpArticle[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: articles.map((a) => ({
      "@type": "Question",
      name: a.heading,
      url: `${SITE_URL}/help/${a.id}`,
      acceptedAnswer: { "@type": "Answer", text: a.paragraphs.join(" ") },
    })),
  };
}

// Card pages carry NO Product graph (10-05, Search Console "Either offers, review, or aggregateRating should be specified"
// on every card page): Google requires one of the three on a Product, an Offer would promise a card we do not sell, and
// a Product without one is a critical error that earns nothing. Card pages keep the breadcrumb graph only.

/** The crumbs a sub-page sits under. */
export function breadcrumbGraph(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: `${SITE_URL}${it.path}`,
    })),
  };
}
