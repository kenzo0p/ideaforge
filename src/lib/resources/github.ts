import type { Resource } from "@/lib/insights/types";

// GitHub repository search. Uses GITHUB_TOKEN for a 5,000/hr authenticated rate
// limit (works unauthenticated too, at a much lower limit).
export function isGithubConfigured(): boolean {
  return !!process.env.GITHUB_TOKEN;
}

export async function searchRepos(
  query: string,
  limit = 4,
  signal?: AbortSignal,
): Promise<Resource[]> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    query,
  )}&sort=stars&order=desc&per_page=${limit}`;
  const res = await fetch(url, { headers, signal });
  if (!res.ok) throw new Error(`GitHub search failed (${res.status})`);

  const data: { items?: Array<{ full_name: string; html_url: string; description?: string; stargazers_count?: number }> } =
    await res.json();

  return (data.items ?? []).map((r) => ({
    title: r.full_name,
    url: r.html_url,
    source: "github.com",
    description: [
      typeof r.stargazers_count === "number" ? `⭐ ${r.stargazers_count.toLocaleString()}` : null,
      r.description,
    ]
      .filter(Boolean)
      .join(" — "),
  }));
}
