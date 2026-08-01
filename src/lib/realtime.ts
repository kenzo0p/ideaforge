// ---------------------------------------------------------------------------
// Real-time fan-out.
//
// An in-process pub/sub feeding Server-Sent Events. Chosen over WebSockets
// because the traffic is one-directional (server → browser), SSE reconnects on
// its own, and it needs no extra infrastructure on a plain Node host.
//
// LIMIT WORTH KNOWING: subscribers live in this process's memory, so an event
// published on one instance never reaches a browser connected to another. That
// is fine on Render with WEB_CONCURRENCY=1, and wrong the moment you scale out
// — at which point this file is what you swap for Redis pub/sub or MongoDB
// change streams. Nothing else has to change: publishers call `publish`,
// consumers call `subscribe`.
//
// Channels: `project:<id>` for comments/members, `user:<id>` for invitations.
// ---------------------------------------------------------------------------

export interface RealtimeEvent {
  /** What changed, so the client knows which slice to refetch. */
  type: "comment" | "members" | "invite";
  /** Who caused it — lets a client ignore the echo of its own action. */
  actorId?: string;
}

type Listener = (event: RealtimeEvent) => void;

// Survives dev/HMR reloads; without this each reload would strand listeners.
const g = globalThis as unknown as { __ideaforgeChannels?: Map<string, Set<Listener>> };
const channels = (g.__ideaforgeChannels ??= new Map<string, Set<Listener>>());

export function subscribe(channel: string, listener: Listener): () => void {
  let set = channels.get(channel);
  if (!set) channels.set(channel, (set = new Set()));
  set.add(listener);

  return () => {
    set!.delete(listener);
    // Drop empty channels so a long-lived process doesn't accumulate them.
    if (set!.size === 0) channels.delete(channel);
  };
}

export function publish(channel: string, event: RealtimeEvent): void {
  const set = channels.get(channel);
  if (!set) return;
  for (const listener of set) {
    // One bad subscriber must not stop the others from being notified.
    try {
      listener(event);
    } catch {
      /* ignore */
    }
  }
}

/** Only used by tests and diagnostics. */
export function subscriberCount(channel: string): number {
  return channels.get(channel)?.size ?? 0;
}
