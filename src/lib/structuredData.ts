import { SITE_URL } from "@/lib/siteUrl";
import type { HelpArticle } from "@/lib/helpArticles";

/**
 * The schema.org graphs the public pages carry (components/JsonLd.tsx).
 * Kept as plain data so a test can pin the shape without rendering.
 */

const ORG_ID = `${SITE_URL}/#organization`;
const APP_ID = `${SITE_URL}/#app`;

export const DESCRIPTION =
  "Scan your Pokémon cards, get real market prices, and turn a whole binder into eBay listings in minutes.";

/** Landing page: who we are, the site, and the product with its plans. */
export function siteGraph(plans: { name: string; priceUsd: number; scans: number }[]) {
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
        offers: plans.map((p) => ({
          "@type": "Offer",
          name: p.name,
          price: p.priceUsd.toFixed(2),
          priceCurrency: "USD",
          description: `${p.scans.toLocaleString("en-US")} card scans a month`,
          url: `${SITE_URL}/pricing`,
          availability: "https://schema.org/InStock",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: p.priceUsd.toFixed(2),
            priceCurrency: "USD",
            billingIncrement: 1,
            unitCode: "MON",
          },
        })),
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
      url: `${SITE_URL}/help#${a.id}`,
      acceptedAnswer: { "@type": "Answer", text: a.paragraphs.join(" ") },
    })),
  };
}

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
