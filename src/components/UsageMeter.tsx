"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";

interface Usage {
  used: number;
  limit: number;
  resetInSec: number;
}

/** Fire after a copilot call so the meter refreshes immediately. */
export const USAGE_EVENT = "ideaforge:usage";

// Slim per-user quota indicator in the sidebar. Refreshes on the custom event
// and, while quota is in use, on a light interval so it drains back to zero.
export default function UsageMeter() {
  const [usage, setUsage] = useState<Usage | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setUsage((await res.json()) as Usage);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onEvent = () => void refresh();
    window.addEventListener(USAGE_EVENT, onEvent);
    return () => window.removeEventListener(USAGE_EVENT, onEvent);
  }, [refresh]);

  // Poll only while quota is actually consumed, so idle sessions stay quiet.
  useEffect(() => {
    if (!usage || usage.used === 0) return;
    const t = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(t);
  }, [usage, refresh]);

  if (!usage) return null;

  const pct = Math.min(100, Math.round((usage.used / usage.limit) * 100));
  const tone =
    pct >= 90 ? "bg-rose-500" : pct >= 60 ? "bg-amber-500" : "bg-brand";

  return (
    <div className="px-3 py-2" title={`${usage.used} of ${usage.limit} copilot requests this minute`}>
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted">
        <span className="inline-flex items-center gap-1">
          <Gauge className="size-3" /> Copilot usage
        </span>
        <span>
          {usage.used}/{usage.limit}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-border">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
      {usage.used > 0 && (
        <p className="mt-1 text-[10px] text-muted">resets in {usage.resetInSec}s</p>
      )}
    </div>
  );
}
