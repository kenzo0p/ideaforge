import type { VideoResource } from "@/lib/pipeline/types";
import { getSearchProvider, type SearchResult } from "@/lib/search";
import { cleanVideoTitle, youtubeId } from "./youtube-id";

export { youtubeId } from "./youtube-id";

// ---------------------------------------------------------------------------
// Related YouTube videos.
//
// Deliberately no YouTube Data API: that needs another key and a quota, and we
// already have a search provider. We ask it for YouTube pages, then keep only
// results whose URL parses into a real video id — a channel or playlist link
// can't be embedded, so it's dropped rather than shown as a dead card.
// ---------------------------------------------------------------------------

export async function findVideos(
  topic: string,
  limit = 4,
  signal?: AbortSignal,
): Promise<VideoResource[]> {
  const searcher = getSearchProvider();
  let tutorial: SearchResult[] = [];
  let general: SearchResult[] = [];
  try {
    // The tutorial-shaped query goes first and its results are preferred. A bare
    // site-scoped search on a topical phrase returns news coverage — factually
    // related, useless if you're trying to build the thing.
    [tutorial, general] = await Promise.all([
      searcher.search(`${topic} tutorial OR explained OR walkthrough site:youtube.com`, {
        maxResults: limit * 2,
        signal,
      }),
      searcher.search(`${topic} site:youtube.com`, { maxResults: limit * 2, signal }),
    ]);
  } catch {
    return [];
  }

  const seen = new Set<string>();
  const videos: VideoResource[] = [];
  for (const r of [...tutorial, ...general]) {
    const id = youtubeId(r.url);
    if (!id || seen.has(id)) continue;
    // Shorts and breaking-news clips are noise in a research rail.
    if (/#shorts|\bshorts\b|breaking news|live now|watch live/i.test(r.title)) continue;
    seen.add(id);
    videos.push({
      title: cleanVideoTitle(r.title),
      url: `https://www.youtube.com/watch?v=${id}`,
      source: "youtube.com",
      description: r.content?.slice(0, 140),
      videoId: id,
    });
    if (videos.length >= limit) break;
  }
  return videos;
}
