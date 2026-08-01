// Pure YouTube URL parsing — no imports, so it can be unit-tested on its own
// without dragging in the search provider (and its network dependencies).

const isVideoId = (s: string) => /^[A-Za-z0-9_-]{11}$/.test(s);

/** Pull the 11-character video id out of any YouTube URL shape, or null. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, "");

    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return isVideoId(id) ? id : null;
    }
    // Exact-suffix check: evil.com/watch?v=… must never look like YouTube.
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;

    const v = u.searchParams.get("v");
    if (v && isVideoId(v)) return v;

    const m = u.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/?#]+)/);
    return m && isVideoId(m[1]) ? m[1] : null;
  } catch {
    return null;
  }
}

/** Strip the trailing " - YouTube" the search index usually appends. */
export function cleanVideoTitle(title: string): string {
  return title.replace(/\s*[-–|]\s*YouTube\s*$/i, "").trim();
}
