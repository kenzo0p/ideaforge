import type { Resource } from "@/lib/insights/types";

// CORE (core.ac.uk) research-paper search — v3 works endpoint (POST + Bearer).
export function isCoreConfigured(): boolean {
  return !!process.env.CORE_API_KEY;
}

interface CoreWork {
  id?: number;
  title?: string;
  doi?: string | null;
  downloadUrl?: string | null;
  authors?: Array<{ name?: string }>;
  yearPublished?: number;
}

export async function searchPapers(
  query: string,
  limit = 4,
  signal?: AbortSignal,
): Promise<Resource[]> {
  const key = process.env.CORE_API_KEY;
  if (!key) return [];

  const res = await fetch("https://api.core.ac.uk/v3/search/works", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ q: query, limit }),
    signal,
  });
  if (!res.ok) throw new Error(`CORE search failed (${res.status})`);

  const data: { results?: CoreWork[] } = await res.json();

  return (data.results ?? []).slice(0, limit).map((r) => {
    const url = r.doi
      ? `https://doi.org/${r.doi}`
      : r.id
        ? `https://core.ac.uk/works/${r.id}`
        : r.downloadUrl || "https://core.ac.uk";
    const authors = (r.authors ?? [])
      .map((a) => a.name)
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    return {
      title: r.title || "Untitled paper",
      url,
      source: r.doi ? "doi.org" : "core.ac.uk",
      description: [authors, r.yearPublished].filter(Boolean).join(" · ") || undefined,
    };
  });
}
