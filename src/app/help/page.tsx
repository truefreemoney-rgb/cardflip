import type { Metadata } from "next";
import Link from "next/link";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Help",
  description: "How CardFlip works — scanning, pricing, eBay listings, offers, and your account.",
};

/**
 * The help center: one page, one article per topic, each with a stable id so
 * error states and emails can deep-link straight to the answer
 * (e.g. /help#scan-limits). Voice per DESIGN.md: plain, confident, dry — and
 * like the legal pages this stays sober, no holo. Every claim here must match
 * what the product does today (data honesty); update the article when the
 * feature changes.
 */

interface HelpArticle {
  id: string;
  heading: string;
  paragraphs: string[];
}

const articles: HelpArticle[] = [
  {
    id: "scanning",
    heading: "Scanning cards",
    paragraphs: [
      "Point the camera at a card, fill the frame, and tap Capture — the scanner reads the name and number, matches it against the catalogue, and shows the market price. Don't get so close that the edges are cut off; the status pill under the viewfinder tells you when to adjust.",
      "Pokémon and Magic: The Gathering are both supported. English cards only for now — Japanese and Chinese support is built and will be enabled later.",
      "Holos and heavily reflective cards scan fine; tilt the card slightly if glare covers the name or number. You can also add cards without the camera: upload photos, or search the catalogue by name and number.",
    ],
  },
  {
    id: "scan-limits",
    heading: "Scan limits",
    paragraphs: [
      "A subscription includes 500 scans per calendar month; the counter resets at the start of each month (UTC). Failed scans don't count against your allowance.",
      "There are also daily and per-minute caps that protect the service from abuse. If you hit one, wait and try again — a normal scanning session never gets near them.",
    ],
  },
  {
    id: "pricing",
    heading: "Where prices come from",
    paragraphs: [
      "The quote is live market data for your exact printing, adjusted by the condition you set and the selling strategy you pick. \"Market\" asks the going rate; \"Quick sale\" undercuts it by 12% to move the card faster (offered on cards worth $5 or more; cheaper cards just list at market).",
      "Condition adjusts the price like the market does: Near Mint is the baseline, Lightly Played prices at 85%, Moderately Played 70%, Heavily Played 55%, Damaged 40%.",
      "Prices are estimates meant to anchor a listing — not an appraisal, not a guarantee. Card markets move; the price you accept is always your decision.",
    ],
  },
  {
    id: "graded",
    heading: "Graded cards",
    paragraphs: [
      "Mark a card as graded by PSA or CGC and pick the grade — the price then follows real sold listings for that exact company and grade instead of the raw-card market, and the history chart rescales to match.",
      "For PSA slabs you can verify the cert: type the cert number into the Verify field and CardFlip checks it against PSA's records and fills in the grade. If verification is temporarily unavailable, you can still set the grade yourself.",
      "Condition grades you pick for raw cards are informal descriptions, not the equivalent of professional grading.",
    ],
  },
  {
    id: "connect-ebay",
    heading: "Connecting eBay",
    paragraphs: [
      "Click Connect with eBay and approve the connection on eBay's own page — CardFlip never sees your eBay password. The consent screen lists exactly what the connection allows: creating drafts, publishing a listing when you choose to, adjusting prices, sending offers to watchers, and reading your orders so sales are tracked.",
      "You can disconnect at any time from the account page, which removes the authorization and the data that came with it.",
    ],
  },
  {
    id: "listing",
    heading: "Listing on eBay",
    paragraphs: [
      "From a scanned card you can publish a live listing directly, or save it as a draft in My eBay to finish there. Nothing is ever listed without you pressing the button.",
      "For a whole stack of scans, Send all to eBay pushes every ready card to your eBay drafts in one go. There's also a plain CSV export of your collection for spreadsheets.",
    ],
  },
  {
    id: "reprice",
    heading: "Reprice nudges",
    paragraphs: [
      "When a listing is at least a week old and the market has moved 15% or more from your asking price, a nudge appears on the card. Tapping it updates both your ledger and the live eBay listing in one step.",
      "If eBay rejects the price change, CardFlip tells you — your ledger keeps the new price and the live listing keeps the old one until you retry.",
    ],
  },
  {
    id: "offers",
    heading: "Offers to watchers",
    paragraphs: [
      "For any live listing you can send a discount offer (5–50%, optional message) to everyone watching it. eBay allows one offer per buyer per listing, so make it count.",
      "Auto-offers are opt-in: set a discount percentage in the offers panel and CardFlip offers it daily on listings that are two weeks old, have watchers, and have never been offered — at most 10 a day. Turn it off by clearing the percentage.",
    ],
  },
  {
    id: "sales",
    heading: "Sales and fees",
    paragraphs: [
      "When a card sells on eBay it's marked sold in CardFlip automatically, with the real sale price and date — no button needed. Net proceeds start as an estimate of eBay's fees and are replaced with the actual reported fee once eBay publishes it, usually within a day.",
      "Sold a card somewhere else? Mark it sold manually (works in bulk too) and enter what it went for.",
    ],
  },
  {
    id: "wishlist",
    heading: "Wishlist alerts",
    paragraphs: [
      "Set a target price on a wishlist card and CardFlip checks the market once a day. When the price dips to your target, you get one email — then it stays quiet until you change the target.",
    ],
  },
  {
    id: "account",
    heading: "Account and security",
    paragraphs: [
      "Two-step verification is in the account page: scan the QR code with any authenticator app and confirm a code. Disabling it requires your password.",
      "Forgot your password? Use the reset link on the login page. Deleting your account is self-serve from the account page and removes everything under it.",
    ],
  },
  {
    id: "billing",
    heading: "Billing",
    paragraphs: [
      "CardFlip is $9.99 per month, including 500 scans each month. Payment runs through Stripe; CardFlip never sees your card number.",
      "Cancel any time from the billing portal in your account page — you keep access until the end of the period you've paid for.",
    ],
  },
  {
    id: "contact",
    heading: "Still stuck?",
    paragraphs: [
      "Email support@cardflip.io and a human reads it.",
    ],
  },
];

export default function HelpPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <MarketingNav />

      <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-16">
        <h1 className="text-3xl font-semibold text-white sm:text-4xl">Help</h1>
        <p className="mt-6 text-sm leading-relaxed text-zinc-400">
          Everything CardFlip does, explained in the order you&apos;ll meet it.
          Can&apos;t find it here? Email{" "}
          <a href="mailto:support@cardflip.io" className="text-brand-300 transition hover:text-brand-200">
            support@cardflip.io
          </a>
          .
        </p>

        <nav aria-label="Help topics" className="mt-8 rounded-2xl border border-edge bg-surface-1 p-5">
          <ul className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            {articles.map((a) => (
              <li key={a.id}>
                <Link href={`#${a.id}`} className="text-zinc-400 transition hover:text-zinc-200">
                  {a.heading}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-12 space-y-12">
          {articles.map((article) => (
            <section key={article.id} id={article.id} className="scroll-mt-24">
              <h2 className="text-lg font-semibold text-white">{article.heading}</h2>
              {article.paragraphs.map((text) => (
                <p key={text.slice(0, 40)} className="mt-3 text-sm leading-relaxed text-zinc-400">
                  {text}
                </p>
              ))}
            </section>
          ))}
        </div>
      </main>

      <Footer />
    </div>
  );
}
