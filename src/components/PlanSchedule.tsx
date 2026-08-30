import { AlertTriangle, CalendarClock, Repeat, Route } from "lucide-react";
import { schedulePlan, type ProblemKind, type Schedule } from "@/lib/plan/schedule";
import type { Milestone } from "@/lib/pipeline/types";

const PROBLEM_ICON: Record<ProblemKind, typeof AlertTriangle> = {
  cycle: Repeat,
  "starts-too-early": CalendarClock,
  "unknown-dependency": AlertTriangle,
  "self-dependency": Repeat,
  overruns: CalendarClock,
};

/**
 * The plan, checked rather than read.
 *
 * A generated roadmap looks like a schedule and is not one: nothing has
 * confirmed that milestone four can start when it says it does, or that the
 * whole thing fits the number of weeks written across the top. This runs the
 * arithmetic that a timeline implies but a language model never performs.
 *
 * The bars are the point. Seeing that two milestones are scheduled to overlap
 * when one depends on the other communicates the problem faster than any
 * sentence, and the critical path is the answer to "what do I do first".
 */
export default function PlanSchedule({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length < 2) return null;
  const schedule = schedulePlan(milestones);
  if (schedule.computedWeeks === 0) return null;

  return <View schedule={schedule} />;
}

function View({ schedule }: { schedule: Schedule }) {
  const { computedWeeks, statedWeeks, problems, criticalPath, inferred } = schedule;
  const over = statedWeeks !== null && computedWeeks > statedWeeks;

  return (
    <div className="mt-4 rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Route className="size-4 text-brand" />
        <h4 className="text-sm font-semibold">Schedule check</h4>
        <span
          className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
            over
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border text-muted"
          }`}
        >
          {computedWeeks} weeks required
          {statedWeeks !== null && statedWeeks !== computedWeeks && ` · ${statedWeeks} claimed`}
        </span>
      </div>

      <p className="mt-1 max-w-prose text-[11px] leading-relaxed text-muted">
        The dependencies this plan declares, solved for earliest start, slack and critical
        path. {criticalPath.length > 0 && (
          <>
            <span className="font-medium text-foreground">
              {criticalPath.length} of {schedule.milestones.length}
            </span>{" "}
            milestones are on the critical path — every week they slip is a week the whole
            project slips.
          </>
        )}
        {inferred && (
          <>
            {" "}
            This plan states no dependencies, so a straight sequence was assumed; with that
            assumption everything is critical, which says more about the assumption than the
            plan.
          </>
        )}
      </p>

      <ol className="mt-3 space-y-1.5">
        {schedule.milestones.map((m) => (
          <li key={m.index} className="grid grid-cols-[9rem_1fr] items-center gap-2 text-[11px]">
            <span className="truncate text-muted" title={m.phase}>
              {m.phase}
            </span>
            <span className="relative block h-4 rounded bg-border/40">
              <span
                className={`absolute inset-y-0 rounded ${
                  m.critical ? "bg-brand-solid" : "bg-brand/40"
                }`}
                style={{
                  left: `${((m.earliestStart - 1) / computedWeeks) * 100}%`,
                  width: `${(m.duration / computedWeeks) * 100}%`,
                }}
                title={`Weeks ${m.earliestStart}–${m.earliestFinish}${
                  m.slack > 0 ? ` · ${m.slack} week${m.slack === 1 ? "" : "s"} of slack` : " · critical"
                }`}
              />
              {/* Slack, drawn where the work could slide to without moving the
                  end date. Invisible on the critical path, which is the point. */}
              {m.slack > 0 && (
                <span
                  className="absolute inset-y-0 rounded border border-dashed border-brand/40"
                  style={{
                    left: `${(m.earliestFinish / computedWeeks) * 100}%`,
                    width: `${(m.slack / computedWeeks) * 100}%`,
                  }}
                />
              )}
            </span>
          </li>
        ))}
      </ol>

      <p className="mt-1.5 text-[10px] text-muted">
        Solid bars are work; dashed is slack. Week 1 to week {computedWeeks}.
      </p>

      {problems.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {problems.map((p, i) => {
            const Icon = PROBLEM_ICON[p.kind];
            const severe = p.kind === "cycle" || p.kind === "self-dependency";
            return (
              <li key={`${p.kind}-${i}`} className="flex items-start gap-1.5 text-[11px]">
                <Icon
                  className={`mt-0.5 size-3 shrink-0 ${severe ? "text-danger" : "text-warning"}`}
                />
                <span className={severe ? "text-danger" : "text-warning"}>{p.detail}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
