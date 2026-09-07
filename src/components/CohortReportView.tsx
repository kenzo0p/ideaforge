import { AlertTriangle, CopyCheck, Users } from "lucide-react";
import type { CohortReport, SubmissionNovelty } from "@/lib/db/cohorts";

function pct(n: number): number {
  return Math.round(n * 100);
}

function noveltyTone(novelty: number): string {
  // Mirrors the clustering threshold: below 0.30 novelty is a similarity above
  // 0.70, which is where the workspace view already asks a human to look.
  if (novelty < 0.15) return "text-danger";
  if (novelty < 0.3) return "text-warning";
  return "text-muted";
}

/**
 * The cohort report a supervisor can print and circulate.
 *
 * Ordered by novelty ascending — the proposals most worth a second look come
 * first, because this gets read until attention runs out and not after.
 *
 * The language throughout is about resemblance. The system compared vectors; it
 * does not know whether two students collaborated, were handed the same brief,
 * or read the same paper. A tool that hands a department a plagiarism verdict it
 * cannot support has done something worse than nothing.
 */
export default function CohortReportView({ report }: { report: CohortReport }) {
  const { submissions, groups, clustered } = report;
  const byId = new Map(submissions.map((s) => [s.id, s]));
  const degraded = report.model !== "minilm";
  const generated = new Date(report.generatedAt);

  return (
    <div className="print-page">
      <header className="mb-4">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <Users className="size-5 text-brand" />
          {report.batch}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {submissions.length} submission{submissions.length === 1 ? "" : "s"} ·{" "}
          {groups.length === 0 ? (
            <span className="text-success">no two resemble each other</span>
          ) : (
            <>
              <span className="font-medium text-warning">{clustered}</span> in{" "}
              <span className="font-medium text-warning">{groups.length}</span> group
              {groups.length === 1 ? "" : "s"} of lookalikes
            </>
          )}{" "}
          · generated{" "}
          <time dateTime={generated.toISOString()} suppressHydrationWarning>
            {generated.toISOString().slice(0, 10)}
          </time>
        </p>
      </header>

      {degraded && (
        <p className="mb-4 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Generated with the fallback text model, which cannot reliably tell a rewording
            from an unrelated idea. Treat the groupings below as unreliable.
          </span>
        </p>
      )}

      {groups.length > 0 && (
        <section className="mb-5">
          <h3 className="mb-2 text-sm font-semibold">Worth reading side by side</h3>
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.ids.join("-")} className="rounded-xl border border-border bg-surface p-3">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
                      g.peak >= 0.85
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-border text-muted"
                    }`}
                  >
                    {pct(g.peak)}% alike
                  </span>
                  <span className="text-[11px] text-muted">
                    {g.ids.length} submissions ·{" "}
                    {g.peak >= 0.85 ? "near-identical wording" : "same problem space"}
                  </span>
                </div>
                <ul className="space-y-1">
                  {g.ids.map((id) => {
                    const s = byId.get(id);
                    if (!s) return null;
                    return (
                      <li key={id} className="text-xs">
                        <span className="font-medium">{s.studentName}</span>
                        {s.studentRef && (
                          <span className="ml-1.5 text-[11px] text-muted">{s.studentRef}</span>
                        )}
                        <span className="ml-1.5 text-muted">— {s.title}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold">Every submission, least distinctive first</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="pb-2 font-medium">Student</th>
                <th className="pb-2 font-medium">Title</th>
                <th className="pb-2 text-right font-medium">Distinctiveness</th>
                <th className="pb-2 text-right font-medium">Resembles</th>
              </tr>
            </thead>
            <tbody>
              {[...submissions]
                .sort((a, b) => a.novelty - b.novelty)
                .map((s) => (
                  <Row key={s.id} submission={s} byId={byId} />
                ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="mt-4 flex items-start gap-1.5 text-[11px] text-muted">
        <CopyCheck className="mt-0.5 size-3 shrink-0" />
        <span>
          Distinctiveness is how far each proposal sits from its nearest neighbour in this
          batch. It is a prompt to read two things together, not a finding of duplication —
          two students can reach the same idea honestly, and this cannot tell the difference.
        </span>
      </p>
    </div>
  );
}

function Row({
  submission: s,
  byId,
}: {
  submission: SubmissionNovelty;
  byId: Map<string, SubmissionNovelty>;
}) {
  return (
    <tr className="border-b border-border/60 last:border-0 align-top">
      <td className="py-2">
        <span className="font-medium">{s.studentName}</span>
        {s.studentRef && <span className="ml-1.5 text-[11px] text-muted">{s.studentRef}</span>}
      </td>
      <td className="py-2 text-muted">{s.title}</td>
      <td className={`py-2 text-right tabular-nums ${noveltyTone(s.novelty)}`}>
        {pct(s.novelty)}%
      </td>
      <td className="py-2 text-right text-[11px] text-muted">
        {s.resembles.length === 0
          ? "—"
          : s.resembles
              .map((id) => byId.get(id)?.studentName ?? "?")
              .join(", ")}
      </td>
    </tr>
  );
}
