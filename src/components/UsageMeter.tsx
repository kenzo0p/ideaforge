"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";

interface Quota {
  used: number;
  limit: number;
  resetInSec: number;
  dailyUsed: number;
  dailyLimit: number;
  dailyResetInSec: number;
}

/** Fire after a copilot call so the meter refreshes immediately. */
export const USAGE_EVENT = "scrutan:usage";

/**
 * Quota indicator in the sidebar.
 *
 * Shows the DAILY figure, because that's the one that actually runs out and the
 * one that costs money. The per-minute burst limit only surfaces when you're
 * close to hitting it — otherwise it's noise.
 */
export default function UsageMeter() {
  const [quota, setQuota] = useState<Quota | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/usage");
      if (res.ok) setQuota((await res.json()) as Quota);
    } catch {
      /* non-critical */
    }
  }, []);

  useEffect(() => {
    // Deferred so the first read isn't a synchronous setState inside the effect.
    const first = setTimeout(() => void refresh(), 0);
    const onUsage = () => void refresh();
    window.addEventListener(USAGE_EVENT, onUsage);
    // Slow poll so the meter recovers as the window rolls forward.
    const t = setInterval(() => void refresh(), 60_000);
    return () => {
      clearTimeout(first);
      window.removeEventListener(USAGE_EVENT, onUsage);
      clearInterval(t);
    };
  }, [refresh]);

  if (!quota) return null;

  const pct = Math.min(100, Math.round((quota.dailyUsed / quota.dailyLimit) * 100));
  const remaining = Math.max(0, quota.dailyLimit - quota.dailyUsed);
  const burstTight = quota.used >= quota.limit - 3;

  const bar =
    pct >= 90 ? "bg-danger" : pct >= 60 ? "bg-warning" : "bg-brand-solid";
  const hours = Math.max(1, Math.round(quota.dailyResetInSec / 3600));

  return (
    <div
      className="px-3 py-2"
      title={`${quota.dailyUsed} of ${quota.dailyLimit} copilot runs used today · resets in ~${hours}h`}
    >
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Gauge className="size-3.5" /> Daily quota
        </span>
        <span className="tabular-nums">
          {quota.dailyUsed}/{quota.dailyLimit}
        </span>
      </div>
      <div className="h-1 rounded-full bg-border">
        <div
          className={`h-1 rounded-full transition-all ${bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {remaining === 0 ? (
        <p className="mt-1 text-[11px] text-danger">Out for today — resets in ~{hours}h.</p>
      ) : burstTight ? (
        <p className="mt-1 text-[11px] text-warning">Slow down — burst limit nearly reached.</p>
      ) : null}
    </div>
  );
}
