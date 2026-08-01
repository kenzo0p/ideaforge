"use client";

import { useState } from "react";
import { Database, ExternalLink, FileText, GitBranch, MonitorPlay, Play } from "lucide-react";
import type { Resource, ResearchResources, VideoResource } from "@/lib/insights/types";

/**
 * A YouTube result rendered as a thumbnail that becomes a player on click.
 *
 * Embedding every video up front would pull YouTube's player script for each
 * card — slow, and it sets cookies before anyone asks to watch. The thumbnail
 * is a plain image; the iframe only appears once you press play, and uses the
 * nocookie host.
 */
function VideoCard({ video }: { video: VideoResource }) {
  const [playing, setPlaying] = useState(false);

  if (playing) {
    return (
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="aspect-video w-full">
          <iframe
            src={`https://www.youtube-nocookie.com/embed/${video.videoId}?autoplay=1&rel=0`}
            title={video.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
            allowFullScreen
            className="size-full"
          />
        </div>
        <p className="line-clamp-2 px-2.5 py-2 text-xs">{video.title}</p>
      </div>
    );
  }

  return (
    <button
      onClick={() => setPlaying(true)}
      className="group w-full overflow-hidden rounded-lg border border-border text-left transition hover:border-border-strong"
    >
      <span className="relative block aspect-video w-full bg-surface">
        {/* eslint-disable-next-line @next/next/no-img-element -- remote YouTube
            thumbnail; next/image would need the domain allow-listed for no gain. */}
        <img
          src={`https://i.ytimg.com/vi/${video.videoId}/hqdefault.jpg`}
          alt=""
          loading="lazy"
          className="size-full object-cover"
        />
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-10 items-center justify-center rounded-full bg-danger/90 transition group-hover:scale-110">
            <Play className="size-4 fill-white text-white" />
          </span>
        </span>
      </span>
      <span className="line-clamp-2 block px-2.5 py-2 text-xs">{video.title}</span>
    </button>
  );
}

function LinkRow({ r }: { r: Resource }) {
  return (
    <li>
      <a
        href={r.url}
        target="_blank"
        rel="noopener noreferrer"
        className="group block rounded-lg px-2 py-1.5 transition hover:bg-hover"
      >
        <span className="flex items-start gap-1.5">
          <span className="line-clamp-2 text-xs font-medium group-hover:text-brand">{r.title}</span>
          <ExternalLink className="mt-0.5 size-3 shrink-0 text-muted" />
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{r.source}</span>
      </a>
    </li>
  );
}

function Group({
  icon: Icon,
  label,
  items,
}: {
  icon: typeof FileText;
  label: string;
  items: Resource[];
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        <Icon className="size-3.5" /> {label}
      </h3>
      <ul className="space-y-0.5">
        {items.map((r, i) => (
          <LinkRow key={i} r={r} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The resources rail beside the briefing.
 *
 * Order is deliberate and matches the wireframe: research papers sit at the top
 * because they're the evidence you check while reading the summary. Code,
 * datasets and videos follow — those matter once you've decided to build.
 */
export default function ResourceAside({ resources }: { resources: ResearchResources }) {
  const { papers, repos, datasets, videos } = resources;
  const empty =
    papers.length === 0 && repos.length === 0 && datasets.length === 0 && videos.length === 0;

  if (empty) {
    return (
      <aside className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs text-muted">
          No resources found for this topic yet. They appear here once DeepSearch turns some up.
        </p>
      </aside>
    );
  }

  return (
    <aside className="space-y-5 rounded-2xl border border-border bg-card p-4">
      <Group icon={FileText} label="Research papers" items={papers} />
      <Group icon={GitBranch} label="Repositories" items={repos} />
      <Group icon={Database} label="Datasets" items={datasets} />

      {videos.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <MonitorPlay className="size-3.5" /> Related videos
          </h3>
          <div className="space-y-2">
            {videos.map((v) => (
              <VideoCard key={v.videoId} video={v} />
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
