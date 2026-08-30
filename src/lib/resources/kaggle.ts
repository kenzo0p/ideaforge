import type { Resource } from "@/lib/pipeline/types";

// Kaggle dataset search. The KGAT_* API token authenticates as a Bearer token.
export function isKaggleConfigured(): boolean {
  return !!process.env.KAGGLE_API_KEY;
}

export async function searchDatasets(
  query: string,
  limit = 4,
  signal?: AbortSignal,
): Promise<Resource[]> {
  const key = process.env.KAGGLE_API_KEY;
  if (!key) return [];

  let results = await runKaggle(key, query, limit, signal);
  // Kaggle's search is strict; if a multi-word query is empty, retry with the
  // two most salient keywords (e.g. "food waste college hostels" → "food waste").
  const words = query.split(/\s+/).filter(Boolean);
  if (results.length === 0 && words.length > 2) {
    results = await runKaggle(key, words.slice(0, 2).join(" "), limit, signal);
  }
  return results;
}

async function runKaggle(
  key: string,
  query: string,
  limit: number,
  signal?: AbortSignal,
): Promise<Resource[]> {
  const url = `https://www.kaggle.com/api/v1/datasets/list?search=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal });
  if (!res.ok) throw new Error(`Kaggle search failed (${res.status})`);

  const data = await res.json();
  const list: Array<{ ref?: string; title?: string; url?: string; subtitle?: string; description?: string }> =
    Array.isArray(data) ? data : (data.datasets ?? []);

  return list.slice(0, limit).map((d) => ({
    title: d.title || d.ref || "Kaggle dataset",
    url: d.url || (d.ref ? `https://www.kaggle.com/datasets/${d.ref}` : "https://www.kaggle.com/datasets"),
    source: "kaggle.com",
    description: d.subtitle || d.description || undefined,
  }));
}
