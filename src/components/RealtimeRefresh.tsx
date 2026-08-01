"use client";

import { useRealtime } from "@/components/useRealtime";

/** Mount-only: opens the SSE stream and refreshes server components on events. */
export default function RealtimeRefresh({ projectId }: { projectId?: string }) {
  useRealtime(projectId);
  return null;
}
