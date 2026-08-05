import { AlertTriangle } from "lucide-react";
import { getHealth } from "@/lib/health/status";

/**
 * A strip shown when a dependency the product depends on has stopped answering.
 *
 * Rendered above everything, before the user types anything. The alternative —
 * finding out after waiting thirty seconds for a generation that was never
 * going to arrive — is how an outage turns into a support conversation and a
 * cancelled subscription.
 *
 * It says what still works. "Everything is broken" and "research is
 * unavailable, validation is fine" call for very different responses from the
 * person reading it.
 */
export default function DegradedBanner() {
  const ai = getHealth("ai");
  const search = getHealth("search");

  const aiDown = ai.status === "degraded";
  const searchDown = search.status === "degraded";
  if (!aiDown && !searchDown) return null;

  const message = aiDown
    ? "Idea generation is temporarily unavailable. We've been alerted — saved projects and exports still work."
    : "Live web research is temporarily unavailable. Validation and planning still work, but new research will be thin.";

  return (
    <div
      role="status"
      className="flex items-start gap-2 border-b border-warning/40 bg-warning/10 px-5 py-2.5 text-sm text-warning"
    >
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <p className="max-w-prose">{message}</p>
    </div>
  );
}
