import type { Resource } from "@/lib/pipeline/types";
import { isGithubConfigured, searchRepos } from "./github";
import { isKaggleConfigured, searchDatasets } from "./kaggle";
import { isCoreConfigured, searchPapers } from "./core";

// ---------------------------------------------------------------------------
// Resource discovery — real repos / datasets / papers for Project HUB.
//
// GitHub (repos), Kaggle (datasets), and CORE (papers) run in parallel, each
// isolated: a missing key or a failed/slow call yields [] for that bucket, so
// Project HUB always degrades gracefully to the search-based fallback.
// ---------------------------------------------------------------------------

export interface DiscoveredResources {
  repos: Resource[];
  datasets: Resource[];
  papers: Resource[];
}

export function anyResourceProviderConfigured(): boolean {
  return isGithubConfigured() || isKaggleConfigured() || isCoreConfigured();
}

export async function discoverResources(topic: string, limit = 4): Promise<DiscoveredResources> {
  // Cap each provider so a slow API can't stall plan generation.
  const signal = AbortSignal.timeout(9000);
  const [repos, datasets, papers] = await Promise.all([
    searchRepos(topic, limit, signal).catch(() => [] as Resource[]),
    searchDatasets(topic, limit, signal).catch(() => [] as Resource[]),
    searchPapers(topic, limit, signal).catch(() => [] as Resource[]),
  ]);
  return { repos, datasets, papers };
}
