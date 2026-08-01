import { getCurrentUser } from "@/lib/auth/session";
import { getProject } from "@/lib/db/projects";
import { subscribe, type RealtimeEvent } from "@/lib/realtime";

export const runtime = "nodejs";
// The stream is meant to stay open; don't let a platform time it out early.
export const maxDuration = 300;

const HEARTBEAT_MS = 25_000;

/**
 * GET /api/realtime?projectId=… — Server-Sent Events for live collaboration.
 *
 * Every connection is authenticated, and subscribing to a project requires
 * access to that project: without the check, knowing an id would let anyone
 * watch a private project's activity.
 *
 * Everyone also gets their personal `user:<id>` channel for invitations.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const projectId = new URL(req.url).searchParams.get("projectId");
  if (projectId && !(await getProject(projectId, user.id))) {
    return new Response("Not found", { status: 404 });
  }

  const encoder = new TextEncoder();
  const unsubscribers: (() => void)[] = [];
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RealtimeEvent | { type: "ready" }) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          /* closed mid-write */
        }
      };

      send({ type: "ready" });
      unsubscribers.push(subscribe(`user:${user.id}`, send));
      if (projectId) unsubscribers.push(subscribe(`project:${projectId}`, send));

      // Comments keep proxies from closing an idle connection, and let the
      // client notice a dead link rather than sitting on a silent socket.
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": ping\n\n"));
        } catch {
          /* closed */
        }
      }, HEARTBEAT_MS);

      // The abort signal is the only reliable "browser went away" notice.
      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        for (const off of unsubscribers) off();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
    cancel() {
      clearInterval(heartbeat);
      for (const off of unsubscribers) off();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      // Nginx and friends buffer by default, which defeats streaming entirely.
      "X-Accel-Buffering": "no",
    },
  });
}
