"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2, Quote } from "lucide-react";
import ClaimList, { ClaimBadge } from "@/components/ClaimList";
import { verifyClaimsAction } from "@/lib/research-actions";
import { claimSentence } from "@/lib/verify/score";
import type { ClaimReport } from "@/lib/verify/claims";

/**
 * Claim-level verification.
 *
 * The citation check above this answers "does the source exist?". This answers
 * the question people assume that one answered: "does the source say this?"
 *
 * Kept as an explicit action rather than something that runs on save, because
 * it fetches and embeds every cited page — seconds of work and a burst of
 * outbound requests. Making it automatic would spend that on every briefing
 * nobody was going to share.
 */
export default function ClaimCheck({
  projectId,
  hasResearch,
  initial,
}: {
  projectId: string;
  hasResearch: boolean;
  initial: ClaimReport | null;
}) {
  const [report, setReport] = useState<ClaimReport | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const res = await verifyClaimsAction(projectId);
      if (res.error) return setError(res.error);
      setReport(res.report ?? null);
    });
  }

  if (!hasResearch) return null;

  // Two different failures with two different messages. A model nobody has
  // calibrated produces no verdicts at all; a calibrated but weak one produces
  // verdicts that are real but should not be leaned on.
  const uncalibrated = report !== null && report.thresholds === null;
  const degraded = report !== null && !uncalibrated && report.model !== "minilm";

  return (
    <div className="mt-5 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Quote className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">Claim check</h2>
        {report && <ClaimBadge report={report} />}
        <button
          onClick={run}
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-hover disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {pending ? "Reading sources…" : report ? "Re-check" : "Check every claim"}
        </button>
      </div>

      <p className="mt-1 max-w-prose text-xs text-muted">
        {report
          ? claimSentence(report)
          : "Reads every cited source and finds the passage that backs each sentence — or reports that there isn’t one."}{" "}
        A live, on-topic source can still be attached to a sentence it never contained; the
        citation check above cannot see that, and this can.
      </p>

      {uncalibrated && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            No claim check was run. The text model on this deployment
            (<code>{report.model}</code>) has never been calibrated, and the cut-offs that
            separate “stated” from “not in the source” are specific to a model — borrowing
            another one’s would produce confident verdicts on a scale that means nothing
            here. Run <code>npm run eval:claims</code> against this model to calibrate it.
          </span>
        </p>
      )}

      {degraded && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-xs text-warning">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>
            This ran on the fallback text model, whose supported and unsupported score
            ranges overlap heavily. The verdicts are calibrated but decide much less than
            they appear to — treat them as weak evidence.
          </span>
        </p>
      )}

      {report && !uncalibrated && <ClaimList report={report} />}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
