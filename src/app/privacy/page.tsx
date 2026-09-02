import type { Metadata } from "next";
import LegalArticle, { type LegalSection } from "@/components/LegalArticle";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What data CardFlip collects and what happens to it.",
};

const sections: LegalSection[] = [
  {
    heading: "What we collect",
    paragraphs: [
      "Account details: your name, email address, and password. Passwords are stored hashed — we cannot read them.",
      "Your selling data: the card photos you upload, the cards you match, the conditions, grades, and prices you set, your watchlist, and the status of each item (draft, listed, sold). This is the product — it is what the app stores so your inventory is there when you come back.",
      "Billing details, if you subscribe: payments are processed by Stripe, which holds your card details — CardFlip never sees your card number, only your subscription status.",
      "Basic technical logs: requests to our servers, with timestamps and IP addresses, kept for debugging and abuse prevention.",
      "That is the list. There is no advertising, no analytics profile, and no tracking across other sites. The only cookie CardFlip sets is the session cookie that keeps you logged in.",
    ],
  },
  {
    heading: "How your data is used",
    paragraphs: [
      "To run the service: identifying the cards in your photos, quoting prices, generating listings, and keeping your ledger. Nothing else — we do not sell your data, share it with advertisers, or use it to build profiles.",
      "When you use photo scanning, the card photo is sent to our AI image-reading provider (Anthropic) to read the card's name, number, and visible condition. Photos are sent for that reading only; under the provider's API terms they are not used to train their models.",
      "Card names and numbers you search are matched against our own card catalogue, which is built from open catalogue sources (TCGdex and pokemontcg.io for Pokémon, Scryfall for Magic: The Gathering). Price data comes from public market sources (such as TCGplayer's published prices); your personal information is never sent to any of them.",
    ],
  },
  {
    heading: "Where it lives",
    paragraphs: [
      "CardFlip runs on Vercel infrastructure and stores its database with Turso, both in the United States. By using CardFlip you consent to your data being processed in the United States.",
      "Your data is kept while your account exists. Delete your account (or ask us to) and your account details, photos, and ledger are removed from the live system; residual copies in server backups age out on their own schedule.",
    ],
  },
  {
    heading: "What we share, and with whom",
    paragraphs: [
      "Service providers only, and only what they need to do their job: hosting (Vercel), database storage (Turso), payments (Stripe), and AI card reading (Anthropic), as described above. When eBay listing integration is connected, listing content will go to eBay under your own eBay account — at your explicit direction each time.",
      "We would disclose data if legally required to. We have never been required to.",
    ],
  },
  {
    heading: "eBay data",
    paragraphs: [
      "When you connect your eBay account, CardFlip stores the authorization you grant and the listing and sale records needed to keep your ledger accurate — nothing more. That data is kept only while your eBay connection is active, is deleted when you disconnect eBay or delete your CardFlip account, and is handled in line with eBay's API License Agreement.",
      "If eBay notifies us that an eBay account has been closed, any data tied to that account is deleted as well.",
    ],
  },
  {
    heading: "Your rights",
    paragraphs: [
      "You can see everything CardFlip holds about you — it is visible in the app itself. Email us to get a copy of your data, correct something, or delete your account entirely, and we will do it. If you are in a jurisdiction with formal data-protection rights (GDPR, CCPA, and similar), these are the same rights those laws describe, and they apply to every user regardless of location.",
    ],
  },
  {
    heading: "Children",
    paragraphs: [
      "CardFlip is not directed at children under 13, and we do not knowingly collect their data. If you believe a child has created an account, contact us and it will be deleted.",
    ],
  },
  {
    heading: "Changes to this policy",
    paragraphs: [
      "If what we collect or how we use it ever changes, this page changes first and the effective date above moves. Material changes will be announced in the app before they take effect.",
    ],
  },
  {
    heading: "Contact",
    paragraphs: [
      "Privacy questions and data requests: support@cardflip.io.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalArticle
      title="Privacy Policy"
      effectiveDate="September 2, 2026"
      intro="CardFlip collects the minimum it needs to identify, price, and track the cards you sell. This page lists exactly what that is, where it goes, and how to get it deleted."
      sections={sections}
    />
  );
}
