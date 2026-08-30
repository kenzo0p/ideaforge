"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { verifyCitationsAction } from "@/lib/research-actions";
import GroundingBadge from "@/components/GroundingBadge";
import GroundingDecay from "@/components/GroundingDecay";
import SourceIndependence from "@/components/SourceIndependence";
import { groundingSentence } from "@/lib/verify/score";
import type { StoredGrounding } from "@/lib/db/grounding";
import type { CitationVerdict, VerdictKind } from "@/lib/verify/citations";

const STYLE: Record<VerdictKind, { icon: typeof CheckCircle2; className: string; label: string }> = {
  verified: { icon: CheckCircle2, className: "text-success", label: "Verified" },
  mismatch: { icon: AlertTriangle, className: "text-warning", label: "Content mismatch" },
  dead: { icon: XCircle, className: "text-danger", label: "Dead link" },
  unreachable: { icon: HelpCircle, className: "text-muted", label: "Unreachable" },
};

/**
 * Citation verification.
 *
 * The claim this product makes is that its research is checkable. This is the
 * button that checks it — every cited URL is fetched and compared against what
 * it was cited as, and the result is reported whether or not it is flattering.
 */
export default function GroundingCheck({
  projectId,
  citationCount,
  initial,
}: {
  projectId: string;
  citationCount: number;
  initial: StoredGrounding | null;
}) {
  const [report, setReport] = useState<StoredGrounding | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const res = await verifyCitationsAction(projectId);
      if (res.error) return setError(res.error);
      setReport(res.report ?? null);
    });
  }

  if (citationCount === 0) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">Source verification</h2>
        {report && (
          <GroundingBadge
            score={report.groundingScore}
            verified={report.verified}
            total={report.verdicts.length}
          />
        )}
        <button
          onClick={run}
          disabled={pending}
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-hover disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          {report ? "Re-check" : `Check ${citationCount} sources`}
        </button>
      </div>

      <p className="mt-1 max-w-prose text-xs text-muted">
        {report
          ? groundingSentence(report)
          : "Fetches every cited URL and checks it resolves and actually discusses what it was cited for."}{" "}
        Nothing else here assumes the citations are real — this is what establishes it, and the
        result appears on the shared brief too.
      </p>

      {report && (
        <>
          <div className="mt-3 flex flex-wrap gap-3 text-xs">
            <Tally n={report.verified} label="verified" className="text-success" />
            <Tally n={report.mismatch} label="mismatched" className="text-warning" />
            <Tally n={report.dead} label="dead" className="text-danger" />
            <Tally n={report.unreachable} label="unreachable" className="text-muted" />
          </div>

          <GroundingDecay history={report.history} rotted={report.rotted} drift={report.drift} />
          {report.independence && <SourceIndependence report={report.independence} />}

          <ul className="mt-3 space-y-1.5">
            {report.verdicts.map((v) => (
              <Row key={v.id} verdict={v} />
            ))}
          </ul>
        </>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Tally({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <span className={`tabular-nums ${n === 0 ? "text-muted" : className}`}>
      <span className="font-semibold">{n}</span> {label}
    </span>
  );
}

function Row({ verdict }: { verdict: CitationVerdict }) {
  const { icon: Icon, className, label } = STYLE[verdict.kind];
  return (
    <li className="flex items-start gap-2 rounded-lg border border-border bg-surface p-2.5 text-xs">
      <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
      <span className="min-w-0 flex-1">
        <a
          href={verdict.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="block truncate font-medium hover:text-brand"
        >
          [{verdict.id}] {verdict.title}
        </a>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{verdict.url}</span>
        <span className="mt-0.5 block text-[11px] text-muted">
          <span className={className}>{label}</span> · {verdict.note}
        </span>
      </span>
    </li>
  );
}
