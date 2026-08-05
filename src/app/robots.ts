import type { MetadataRoute } from "next";
import { publicOrigin } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

/**
 * Crawl rules.
 *
 * Allow-listing would be simpler, but it fails open the moment a new public
 * route is added. This disallows the whole signed-in surface by prefix instead,
 * so a new page under /projects or /org is private by default and only what is
 * deliberately public stays crawlable.
 *
 * Individual briefs carry their own `noindex` unless listed (see the share
 * page's metadata) — robots.txt governs crawling, not indexing, and the two are
 * not the same thing.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await publicOrigin();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard",
          "/projects/",
          "/org",
          "/admin",
          "/settings",
          "/notifications",
          "/sign-in",
          "/sign-up",
          "/verify-email",
          "/reset-password",
          "/forgot-password",
        ],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
