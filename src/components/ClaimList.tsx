import { AlertTriangle, Ban, CheckCircle2, CircleHelp, HelpCircle, XCircle } from "lucide-react";
import {
  BAND_CLASS,
  CLAIM_BAND_LABEL,
  groundingBand,
  groundingPercent,
} from "@/lib/verify/score";
import type { ClaimReport, ClaimVerdict, SupportKind } from "@/lib/verify/claims";

const STYLE: Record<SupportKind, { icon: typeof CheckCircle2; className: string; label: string }> = {
  supported: { icon: CheckCircle2, className: "text-success", label: "Stated in the source" },
  contradicted: { icon: Ban, className: "text-danger", label: "Source says otherwise" },
  weak: { icon: AlertTriangle, className: "text-warning", label: "Related, not stated" },
  unsupported: { icon: XCircle, className: "text-danger", label: "Not in the source" },
  uncited: { icon: CircleHelp, className: "text-warning", label: "No citation" },
  unavailable: { icon: HelpCircle, className: "text-muted", label: "Source unreadable" },
};

/**
 * The support badge.
 *
 * Deliberately not the grounding badge with different words: this number has a
 * different denominator (claims, not citations) and showing them in identical
 * chips side by side is how a reader comes away believing one of them twice.
 */
export function ClaimBadge({ report }: { report: ClaimReport }) {
  const band = groundingBand(report.supportScore);
  const checked = report.verdicts.length - report.unavailable;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${BAND_CLASS[band]}`}
      title={CLAIM_BAND_LABEL[band]}
    >
      <span className="tabular-nums font-semibold">
        {groundingPercent(report.supportScore)}%
      </span>
      <span>of claims stated</span>
      <span className="tabular-nums opacity-70">
        ({report.supported}/{checked})
      </span>
    </span>
  );
}

/**
 * Every claim, with the passage that backs it.
 *
 * The passage is the whole point. A verdict on its own is one more assertion
 * the reader is asked to take on faith; the passage is the thing they can go
 * and find in the source themselves, which is the only sense in which any of
 * this is verification rather than a second opinion.
 */
export default function ClaimList({ report }: { report: ClaimReport }) {
  // Failures first. Someone opening this has one question — what is wrong with
  // my briefing — and ordering by document position buries the answer among
  // the claims that were fine.
  const order: SupportKind[] = [
    "contradicted",
    "unsupported",
    "uncited",
    "weak",
    "unavailable",
    "supported",
  ];
  const sorted = [...report.verdicts].sort(
    (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.index - b.index,
  );

  return (
    <>
      <div className="mt-3 flex flex-wrap gap-3 text-xs">
        <Tally n={report.supported} label="stated" className="text-success" />
        <Tally n={report.weak} label="related only" className="text-warning" />
        <Tally n={report.unsupported} label="not in source" className="text-danger" />
        <Tally n={report.contradicted} label="contradicted" className="text-danger" />
        <Tally n={report.uncited} label="uncited figures" className="text-warning" />
        <Tally n={report.unavailable} label="unreadable" className="text-muted" />
      </div>

      <ul className="mt-3 space-y-2">
        {sorted.map((v) => (
          <Row key={v.index} verdict={v} />
        ))}
      </ul>
    </>
  );
}

function Tally({ n, label, className }: { n: number; label: string; className: string }) {
  return (
    <span className={`tabular-nums ${n === 0 ? "text-muted" : className}`}>
      <span className="font-semibold">{n}</span> {label}
    </span>
  );
}

function Row({ verdict }: { verdict: ClaimVerdict }) {
  const { icon: Icon, className, label } = STYLE[verdict.kind];

  return (
    <li className="rounded-lg border border-border bg-surface p-2.5 text-xs">
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
        <div className="min-w-0 flex-1">
          <p className="leading-relaxed">{verdict.text}</p>

          <p className="mt-1 text-[11px] text-muted">
            <span className={className}>{label}</span>
            {verdict.score !== null && (
              <>
                {" · "}
                <span className="tabular-nums" title="Similarity between the claim and the closest passage in its cited source">
                  match {verdict.score.toFixed(2)}
                </span>
              </>
            )}
            {" · "}
            {verdict.note}
          </p>

          {verdict.unmatchedFigures.length > 0 && (
            <p className="mt-1 text-[11px] text-danger">
              Figure not found in the source:{" "}
              <span className="font-semibold">{verdict.unmatchedFigures.join(", ")}</span>
            </p>
          )}

          {verdict.passage && (
            <blockquote className="mt-1.5 border-l-2 border-border-strong pl-2 text-[11px] leading-relaxed text-muted">
              “{verdict.passage}”
              {verdict.sourceId !== null && (
                <span className="mt-0.5 block not-italic">— from source [{verdict.sourceId}]</span>
              )}
            </blockquote>
          )}
        </div>
      </div>
    </li>
  );
}
