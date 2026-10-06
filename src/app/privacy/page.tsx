import LegalArticle, { type LegalSection } from "@/components/LegalArticle";
import { PUBLIC_META } from "@/lib/pageMeta";

export const metadata = PUBLIC_META.privacy;

const sections: LegalSection[] = [
  {
    heading: "What we collect",
    paragraphs: [
      "Account details: your name, email address, and password. Passwords are stored hashed — we cannot read them. We also record when you last opened the app, so we can see which accounts are in use.",
      "Your selling data: the card photos you take, the cards you match, the conditions, grades, and prices you set, your watchlist, and the status of each item (draft, listed, sold). This is the product — it is what the app stores so your inventory is there when you come back.",
      "Billing details, if you subscribe: payments are processed by Stripe, which holds your card details — CardFlip never sees your card number, only your subscription status.",
      "Basic technical logs: requests to our servers, with timestamps and IP addresses, kept for debugging and abuse prevention.",
      "Visit counts: we count how many people visit each day using a one-way hash of your connection that changes every day, so it cannot identify you or follow you between days. We also use Google Analytics on the public pages (not inside your account) to see which pages people read, and when we advertise CardFlip on TikTok, TikTok’s pixel on those same pages tells TikTok whether an ad led to a signup. When you sign up, the pixel also sends TikTok a scrambled (hashed) copy of your email address so it can match the signup to the ad; your actual email is never sent. On those pages the pixel also records how you use them (pages viewed, buttons tapped and time spent) to measure and improve our ads. Each company’s own policy covers what it collects. Visitors in the UK and Ireland are asked before either loads.",
      "If you arrive through a tagged link or another site, we remember that source in your browser and save it with your account at signup, so we know which posts bring people. It holds no personal details.",
      "Your country: CardFlip is open in the United States, Canada, the United Kingdom, Ireland, Australia and New Zealand. We record the country your account was created in (from your connection, never typed by you) so you can use your account while travelling and see prices in your home currency. If CardFlip is not open where you are, you can leave your email on the waitlist; we save that email with your country and the date, use it only to email you once when CardFlip opens there, and delete it on request.",
      "That is the list. There are no ads on CardFlip, no selling of data, and no profile built about you. The only cookies CardFlip itself sets are the session cookie that keeps you logged in, a signed cookie holding your account’s home country (so you can use CardFlip while travelling), a device cookie set at signup so the free trial goes to one account per device, a cookie remembering your analytics choice if you were asked, and Google Analytics’ measurement cookies. In the United Kingdom and Ireland, Google Analytics only runs after you accept it.",
    ],
  },
  {
    heading: "How your data is used",
    paragraphs: [
      "To run the service: identifying the cards in your photos, quoting prices, generating listings, and keeping your ledger. Nothing else — we do not sell your data, share it with advertisers, or use it to build profiles.",
      "When you use photo scanning, the card photo is sent to our AI image-reading provider (Anthropic) to read the card's name, number, and visible condition. Photos are sent for that reading only; under the provider's API terms they are not used to train their models.",
      "Card names and numbers you search are matched against our own card catalogue, which is built from open catalogue sources (TCGdex and pokemontcg.io for Pokémon, Scryfall for Magic: The Gathering, and TCGplayer's public catalogue for Disney Lorcana, Yu-Gi-Oh! and One Piece). Price data comes from public market sources (such as TCGplayer's published prices); your personal information is never sent to any of them.",
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

// The games were named per site switch until 09-30; the lineup is closed at
// five (Chris), so the copy is static.
export default function PrivacyPage() {
  return (
    <LegalArticle
      title="Privacy Policy"
      effectiveDate="September 30, 2026"
      intro="CardFlip collects the minimum it needs to identify, price, and track the cards you sell. This page lists exactly what that is, where it goes, and how to get it deleted."
      sections={sections}
    />
  );
}
