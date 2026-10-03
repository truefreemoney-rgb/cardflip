import type { Metadata } from "next";
import { DESCRIPTION } from "@/lib/structuredData";
import { LADDER_SENTENCE, PRICE, PRICE_LINE } from "@/lib/pricing";
import type { HelpArticle } from "@/lib/helpArticles";
import { clipDescription, noindexMetadata, pageMetadata } from "@/lib/seo";

/**
 * The static pages' metadata, as plain objects a test can import (the page
 * and layout files are TSX, which plain node cannot load). Public pages carry
 * a canonical, the share picture and the site name (lib/seo.ts pageMetadata);
 * private ones are noindex. Dynamic pages (help articles, card pages, /u/…)
 * build theirs with the same helper.
 */

export const HOME_TITLE = "CardFlip: card scanner and price checker for Pokémon, Magic, Lorcana, One Piece and Yu-Gi-Oh!";

export const PUBLIC_META = {
  home: pageMetadata({ title: HOME_TITLE, absoluteTitle: true, description: DESCRIPTION, path: "/", ogTitle: "CardFlip — Scan. Price. List." }),
  pricing: pageMetadata({
    title: "Pricing",
    // Just the ladder: the old two extra sentences pushed it to 248 characters, and search cuts a description near 155.
    description: clipDescription(LADDER_SENTENCE),
    path: "/pricing",
    ogTitle: `CardFlip pricing — ${PRICE_LINE.standard}, or a ${PRICE.pack} Scan Pack`,
  }),
  features: pageMetadata({
    title: "Features",
    description: "Everything CardFlip does: scan five games, price the exact printing, track your collection, and list on your own eBay in one tap.",
    path: "/features",
    ogTitle: "Everything CardFlip does",
  }),
  help: pageMetadata({
    title: "Help",
    description: "How CardFlip works — scanning, pricing, eBay listings, offers, and your account.",
    path: "/help",
    ogTitle: "CardFlip help",
  }),
  terms: pageMetadata({ title: "Terms of Service", description: "The terms that govern your use of CardFlip.", path: "/terms", ogTitle: "CardFlip terms of service" }),
  privacy: pageMetadata({ title: "Privacy Policy", description: "What data CardFlip collects and what happens to it.", path: "/privacy", ogTitle: "CardFlip privacy policy" }),
  signup: pageMetadata({
    title: "Sign up",
    description: "Create a CardFlip account: scan your cards, see real market prices, and list them on eBay in minutes.",
    path: "/signup",
  }),
} satisfies Record<string, Metadata>;

export const PRIVATE_META = {
  // Sign-in is a door, not a page to find: out of the index, but its links (to Sign Up) are followed.
  login: { ...noindexMetadata("Log in", { follow: true }), description: "Log in to CardFlip to scan, price and list your cards." },
  forgotPassword: noindexMetadata("Forgot password"),
  resetPassword: noindexMetadata("Reset password"),
  confirmEmail: noindexMetadata("Confirm email"),
  connectEbay: noindexMetadata("Connect eBay"),
  app: noindexMetadata("Scanner"),
  admin: noindexMetadata("Admin"),
  adminLogin: noindexMetadata("Admin sign-in"),
  egg: noindexMetadata("Skeleton theater"),
  notFound: noindexMetadata("Page not found", { follow: true }),
} satisfies Record<string, Metadata>;

/** One help article on its own page (/help/<id>): its heading, the opening of its text, its own canonical. */
export function helpArticleMetadata(article: Pick<HelpArticle, "id" | "heading" | "paragraphs">): Metadata {
  return pageMetadata({
    title: article.heading,
    description: clipDescription(article.paragraphs[0] ?? ""),
    path: `/help/${article.id}`,
    ogTitle: `${article.heading} · CardFlip help`,
  });
}
