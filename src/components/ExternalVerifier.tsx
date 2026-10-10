"use client";

import { useState, useTransition } from "react";
import { CheckCircle2, Loader2, Search, ShieldOff, XCircle } from "lucide-react";
import ClaimList, { ClaimBadge } from "@/components/ClaimList";
import SourceIndependence from "@/components/SourceIndependence";
import { verifyExternalAction } from "@/lib/verify-actions";
import { groundingPercent } from "@/lib/verify/score";
import type { ExternalReport, SourceStatus } from "@/lib/verify/external";

const STATUS: Record<SourceStatus, { icon: typeof CheckCircle2; className: string; label: string }> = {
  reachable: { icon: CheckCircle2, className: "text-success", label: "Resolves" },
  unreadable: { icon: CheckCircle2, className: "text-muted", label: "Resolves, not readable" },
  dead: { icon: XCircle, className: "text-danger", label: "Does not resolve" },
  blocked: { icon: ShieldOff, className: "text-muted", label: "Not a public address" },
};

const SAMPLE = `Food waste in Indian hostels costs campuses roughly ₹40 crore annually [1].
A 2024 study found that 31% of prepared meals are discarded before service [2].`;

/**
 * Check an answer that came from somewhere else.
 *
 * The form is two fields because the check needs exactly two things, and asking
 * for more would cost more people than it helped. Everything else — whether the
 * URLs exist, whether the sentences are in them, how many of them are really
 * one source — is derived.
 */
export default function ExternalVerifier() {
  const [text, setText] = useState("");
  const [sources, setSources] = useState("");
  const [report, setReport] = useState<ExternalReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    setError(null);
    start(async () => {
      const res = await verifyExternalAction(text, sources);
      if (res.error) {
        setReport(null);
        return setError(res.error);
      }
      setReport(res.report ?? null);
    });
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold">The answer</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder={SAMPLE}
            className="mt-1 w-full rounded-lg border border-border-strong bg-card p-3 text-sm outline-none focus:border-brand/60"
          />
          <span className="mt-1 block text-[11px] text-muted">
            Paste it with its <code>[1]</code> markers intact — those are what tie each
            sentence to a source.
          </span>
        </label>

        <label className="block">
          <span className="text-xs font-semibold">Its sources</span>
          <textarea
            value={sources}
            onChange={(e) => setSources(e.target.value)}
            rows={9}
            placeholder={"https://example.com/report\nhttps://example.org/study"}
            className="mt-1 w-full rounded-lg border border-border-strong bg-card p-3 font-mono text-xs outline-none focus:border-brand/60"
          />
          <span className="mt-1 block text-[11px] text-muted">
            One URL per line, in the order they are numbered.
          </span>
        </label>
      </div>

      <button
        onClick={run}
        disabled={pending}
        className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        {pending ? "Opening every source…" : "Check this answer"}
      </button>

      {error && (
        <p role="alert" className="mt-3 max-w-prose text-sm text-danger">
          {error}
        </p>
      )}

      {report && <Result report={report} />}
    </>
  );
}

function Result({ report }: { report: ExternalReport }) {
  const dead = report.sources.filter((s) => s.status === "dead").length;
  const reachable = groundingPercent(report.reachableRatio);

  return (
    <div className="mt-6 space-y-5">
      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">Sources</h2>
          <span
            className={`rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums ${
              dead > 0
                ? "border-danger/40 bg-danger/10 text-danger"
                : "border-success/40 bg-success/10 text-success"
            }`}
          >
            {reachable}% resolve
          </span>
          {report.claims.thresholds && <ClaimBadge report={report.claims} />}
        </div>

        <ul className="mt-3 space-y-1.5">
          {report.sources.map((s) => {
            const { icon: Icon, className, label } = STATUS[s.status];
            return (
              <li key={s.id} className="flex items-start gap-2 text-xs">
                <Icon className={`mt-0.5 size-3.5 shrink-0 ${className}`} />
                <span className="min-w-0 flex-1">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="block truncate font-medium hover:text-brand"
                  >
                    [{s.id}] {s.url}
                  </a>
                  <span className="mt-0.5 block text-[11px] text-muted">
                    <span className={className}>{label}</span> · {s.note}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>

        {report.rejected.length > 0 && (
          <ul className="mt-2 space-y-0.5">
            {report.rejected.map((r, i) => (
              <li key={i} className="text-[11px] text-muted">
                Skipped <span className="font-mono">{r.url.slice(0, 60)}</span> — {r.why}
              </li>
            ))}
          </ul>
        )}

        <SourceIndependence report={report.independence} />
      </section>

      <section className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-semibold">Claims</h2>
          {report.claims.thresholds && <ClaimBadge report={report.claims} />}
        </div>
        {report.claims.thresholds === null ? (
          <p className="mt-1 text-xs text-danger">
            This deployment has no calibrated text model, so no claim could be judged.
          </p>
        ) : report.claims.verdicts.length === 0 ? (
          <p className="mt-1 text-xs text-muted">
            No sentence in that answer carried a citation marker or a figure, so there was
            nothing to check against a source.
          </p>
        ) : (
          <>
            <p className="mt-1 max-w-prose text-xs text-muted">
              Each sentence matched against passages from the source it cited. A claim marked
              “not in the source” came with a citation that does not support it.
            </p>
            <ClaimList report={report.claims} />
          </>
        )}
      </section>
    </div>
  );
}
