import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/siteUrl";

const BASE = SITE_URL;

// lastModified is the last real copy change on that page — bump it when the
// page changes, not on every deploy (crawlers stop trusting a date that
// always says "today").
const PAGES: { path: string; lastModified: string; changeFrequency: "weekly" | "monthly" | "yearly"; priority: number }[] = [
  { path: "/", lastModified: "2026-09-10", changeFrequency: "weekly", priority: 1 },
  { path: "/pricing", lastModified: "2026-09-04", changeFrequency: "monthly", priority: 0.9 },
  { path: "/help", lastModified: "2026-09-10", changeFrequency: "weekly", priority: 0.8 },
  { path: "/signup", lastModified: "2026-09-04", changeFrequency: "monthly", priority: 0.6 },
  { path: "/login", lastModified: "2026-08-14", changeFrequency: "yearly", priority: 0.3 },
  { path: "/terms", lastModified: "2026-08-14", changeFrequency: "yearly", priority: 0.2 },
  { path: "/privacy", lastModified: "2026-08-14", changeFrequency: "yearly", priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((p) => ({
    url: `${BASE}${p.path}`,
    lastModified: new Date(p.lastModified),
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));
}
