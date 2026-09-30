import type { Metadata } from "next";

/**
 * Page metadata, built one way (SEO sweep 09-30). A page that sets its own
 * `openGraph` REPLACES the root layout's: before this, /pricing, /help, /login,
 * /signup, /terms, /privacy and /u/<handle> all lost the share image, the site
 * name and the card type, and Twitter fell back to the small summary card.
 * Every public page now goes through pageMetadata, so each one carries its own
 * canonical (the root sets none: a private page must never point at the
 * landing page) plus the full OG and Twitter block; every private page goes
 * through noindexMetadata. scripts/test-card-pages.mjs pins both.
 */

export const SITE_NAME = "CardFlip";

/** The branded share card (app/opengraph-image.tsx); used whenever a page has no picture of its own. */
export const DEFAULT_OG_IMAGE = "/opengraph-image";

export interface PageMetaInput {
  /** The page's own title; the root template adds " · CardFlip" unless `absoluteTitle`. */
  title: string;
  absoluteTitle?: boolean;
  description: string;
  /** Canonical path, site-relative ("/pricing"). Resolved against metadataBase. */
  path: string;
  /** Share picture: an absolute URL or a site path. Default = the branded card. */
  image?: string | null;
  /** Alt text for a page-specific picture. */
  imageAlt?: string;
  /** Title for link previews; default = the page title with the site name. */
  ogTitle?: string;
  /** Keep the page out of the index (still followed). */
  noindex?: boolean;
}

export function pageMetadata(input: PageMetaInput): Metadata {
  const { title, absoluteTitle = false, description, path, image, imageAlt, noindex = false } = input;
  const ogTitle = input.ogTitle ?? (absoluteTitle ? title : `${title} · ${SITE_NAME}`);
  const picture = image || DEFAULT_OG_IMAGE;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: ogTitle,
      description,
      images: [{ url: picture, ...(imageAlt ? { alt: imageAlt } : {}) }],
    },
    twitter: { card: "summary_large_image", title: ogTitle, description, images: [picture] },
    ...(noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** A page that must stay out of search: sign-in, account flows, the admin, the 404. */
export function noindexMetadata(title: string, opts: { follow?: boolean } = {}): Metadata {
  return { title, robots: { index: false, follow: opts.follow ?? false } };
}

/** The first sentence(s) of `text` that fit in `max` characters, for a meta description. */
export function clipDescription(text: string, max = 155): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  // A sentence ends at . ! ? followed by a space: the dot in "$12.46" is not one.
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let out = "";
  for (const s of sentences) {
    const next = `${out}${out ? " " : ""}${s}`;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = clean.slice(0, max - 1).replace(/\s+\S*$/, "");
  return `${cut}…`;
}
