import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

const BASE = SITE_URL;

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/terms", "/privacy", "/login", "/signup"].map((path) => ({
    url: `${BASE}${path}`,
    lastModified: new Date("2026-08-14"),
  }));
}
