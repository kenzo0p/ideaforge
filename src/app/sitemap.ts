import type { MetadataRoute } from "next";
import { listPublicBriefs } from "@/lib/db/projects";
import { publicOrigin } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

/**
 * Sitemap: the marketing pages plus every brief whose owner opted in.
 *
 * Built from the same query the directory renders, so a brief can never be
 * advertised to a crawler while being absent from the page a visitor lands on.
 *
 * A database failure returns the static pages rather than throwing. A sitemap
 * that 500s is treated as a site-level problem by crawlers; a short one is just
 * a short one.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await publicOrigin();

  const staticPages: MetadataRoute.Sitemap = [
    { url: `${origin}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${origin}/explore`, changeFrequency: "daily", priority: 0.8 },
    { url: `${origin}/pricing`, changeFrequency: "monthly", priority: 0.6 },
  ];

  try {
    const briefs = await listPublicBriefs(500);
    return [
      ...staticPages,
      ...briefs.map((b) => ({
        url: `${origin}/share/${b.token}`,
        lastModified: new Date(b.updatedAt),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      })),
    ];
  } catch (err) {
    console.error("Sitemap: could not list public briefs —", err instanceof Error ? err.message : err);
    return staticPages;
  }
}
