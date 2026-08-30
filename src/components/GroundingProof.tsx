import Link from "next/link";
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from "lucide-react";
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
 * The verification result, read-only.
 *
 * This is the version a stranger sees on a shared brief, and the difference
 * from the owner's panel is deliberate: there is no re-check button. Letting an
 * anonymous visitor trigger a fan-out of outbound fetches would turn every
 * public brief into a small request amplifier pointed at other people's
 * servers. Visitors read the last result; only the owner can ask for a new one.
 *
 * It shows the failures as plainly as the successes. A brief that hides its
 * dead links is making the same unfalsifiable claim as a brief with no
 * verification at all.
 */
export default function GroundingProof({ report }: { report: StoredGrounding }) {
  const total = report.verdicts.length;
  if (total === 0) return null;

  const checked = new Date(report.checkedAt);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold">Source verification</h2>
        <GroundingBadge
          score={report.groundingScore}
          verified={report.verified}
          total={total}
        />
        <time
          dateTime={checked.toISOString()}
          className="ml-auto text-[11px] text-muted"
          suppressHydrationWarning
        >
          Checked {checked.toISOString().slice(0, 10)}
        </time>
      </div>

      <p className="mt-1.5 max-w-prose text-xs text-muted">
        {groundingSentence(report)} Each URL below was fetched and compared against the title it
        was cited under — including the ones that failed.{" "}
        <Link href="/quality" className="underline hover:text-foreground">
          How this is measured
        </Link>
        .
      </p>

      <GroundingDecay history={report.history} rotted={report.rotted} drift={report.drift} />
      {report.independence && <SourceIndependence report={report.independence} />}

      <ul className="mt-3 space-y-1.5">
        {report.verdicts.map((v) => (
          <Row key={v.id} verdict={v} />
        ))}
      </ul>
    </section>
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
