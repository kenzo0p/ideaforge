"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribe to live collaboration events and refresh server components when
 * something changes.
 *
 * `router.refresh()` rather than local state: the data already comes from
 * server components, so re-rendering them is both the least code and the least
 * chance of the two copies drifting. EventSource reconnects by itself, so
 * there's no retry logic here.
 */
export function useRealtime(projectId?: string) {
  const router = useRouter();

  useEffect(() => {
    const url = projectId
      ? `/api/realtime?projectId=${encodeURIComponent(projectId)}`
      : "/api/realtime";
    const source = new EventSource(url);

    source.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as { type: string };
        if (event.type === "ready") return;
        router.refresh();
      } catch {
        /* ignore malformed frames */
      }
    };

    // Errors are usually a transient disconnect; EventSource retries on its own.
    source.onerror = () => {};

    return () => source.close();
  }, [projectId, router]);
}
