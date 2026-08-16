import type { Metadata } from "next";
import LegalArticle, { type LegalSection } from "@/components/LegalArticle";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms that govern your use of CardFlip.",
};

const sections: LegalSection[] = [
  {
    heading: "What CardFlip is",
    paragraphs: [
      "CardFlip is a tool for people selling Pokémon and Magic: The Gathering trading cards. It identifies cards from photos or search, shows market price information for the matched printing, generates listing titles and descriptions, and keeps a ledger of what you have drafted, listed, and sold. Listings are placed on eBay under your own eBay account — CardFlip is not a marketplace, does not host sales, and never handles the money from your sales.",
    ],
  },
  {
    heading: "Your account",
    paragraphs: [
      "You need an account to use the app. Keep your password confidential and give us accurate information — the account belongs to the person who created it, and you are responsible for activity that happens under it.",
      "You must be old enough to form a binding contract where you live (in most places, 18) to sell through CardFlip, since selling on eBay requires the same.",
    ],
  },
  {
    heading: "Early access and billing",
    paragraphs: [
      "CardFlip is currently in early access and free to use. When early access ends, the service will cost $4.99 per month. You will be told clearly before any billing starts — no card is collected during early access and nothing is charged without your explicit sign-up.",
      "Once paid subscriptions exist: they renew monthly, you can cancel at any time, and cancellation takes effect at the end of the period you have already paid for. Fees paid to eBay for your listings are always between you and eBay.",
    ],
  },
  {
    heading: "Prices are estimates, not appraisals",
    paragraphs: [
      "Price suggestions come from live market data for the matched printing, adjusted by the condition and selling strategy you choose. They are estimates meant to anchor a listing, not a professional appraisal, a guarantee of sale price, or financial advice. Card markets move; the price you accept for a card is always your decision and your responsibility.",
      "Condition grades you select, and condition estimates the app reads from photos, are informal descriptions — they are not equivalent to professional grading by PSA, CGC, or any other grading company.",
    ],
  },
  {
    heading: "Your content",
    paragraphs: [
      "The photos you upload and the listings you create are yours. You give CardFlip permission to store and process them solely to provide the service — for example, sending a card photo to our image-reading provider to identify the card. We claim no ownership of your content.",
      "You are responsible for what you list. Only list cards you actually own and may sell, describe them honestly, and do not use CardFlip to sell counterfeit or stolen items.",
    ],
  },
  {
    heading: "Acceptable use",
    paragraphs: [
      "Do not attempt to break, overload, scrape, or reverse-engineer the service; do not access other users' accounts or data; and do not use CardFlip for anything illegal. We may suspend or close accounts that do.",
      "When you list through CardFlip, you are also bound by eBay's User Agreement and listing policies — keeping your listings inside eBay's rules is your responsibility.",
    ],
  },
  {
    heading: "Third-party services",
    paragraphs: [
      "CardFlip works alongside services we do not control, including eBay (where your listings are placed under your account and eBay's own terms), market-data sources such as TCGplayer, and the open card catalogues our card database is built from (TCGdex and pokemontcg.io). Their availability and accuracy are not ours to guarantee, and your relationship with them is governed by their terms.",
      "Pokémon, Magic: The Gathering, and all card names and images are trademarks of their respective owners, including Nintendo, Creatures Inc., Game Freak, and Wizards of the Coast LLC. CardFlip is not affiliated with, endorsed by, or sponsored by Nintendo, The Pokémon Company, Wizards of the Coast, Scryfall, TCGplayer, or eBay Inc. Card data and images are used to identify cards for resale purposes.",
    ],
  },
  {
    heading: "The service is provided as-is",
    paragraphs: [
      "CardFlip is provided \"as is\" and \"as available\", without warranties of any kind, express or implied. We do not guarantee the service will be uninterrupted, error-free, or that any card identification or price is correct.",
      "To the maximum extent permitted by law, CardFlip and its operator are not liable for indirect, incidental, or consequential damages, or for lost profits — including money lost on a sale priced with the app's suggestions. Our total liability for any claim is limited to the amount you paid CardFlip in the twelve months before the claim (which, during free early access, is zero).",
    ],
  },
  {
    heading: "Ending service",
    paragraphs: [
      "You can stop using CardFlip and ask us to delete your account at any time. We may suspend or terminate accounts that violate these terms, and may modify or discontinue the service; if the service is discontinued while you have an active paid subscription, the unused portion will be refunded.",
    ],
  },
  {
    heading: "Governing law",
    paragraphs: [
      "These terms are governed by the laws of the United States and of the U.S. state where CardFlip's operator resides, without regard to conflict-of-law rules. If we ever have a dispute, we ask that you raise it with us by email first — most problems are fixable without anyone involving a court.",
    ],
  },
  {
    heading: "Changes to these terms",
    paragraphs: [
      "We may update these terms as the service evolves — for example, when paid subscriptions launch. The effective date above always reflects the current version, and material changes will be announced in the app before they take effect. Continuing to use CardFlip after a change means you accept the updated terms.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      "Questions about these terms: support@superiormarketing.com.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalArticle
      title="Terms of Service"
      effectiveDate="August 14, 2026"
      intro="These terms are an agreement between you and CardFlip covering your use of the CardFlip website and app. They are written to be read — if anything is unclear, ask us before relying on it."
      sections={sections}
    />
  );
}
