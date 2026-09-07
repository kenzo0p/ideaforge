"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import CohortImport from "@/components/CohortImport";
import CohortReportView from "@/components/CohortReportView";
import PrintTrigger from "@/components/PrintTrigger";
import { cohortReportAction, listBatchesAction } from "@/lib/cohort-actions";
import type { BatchSummary, CohortReport } from "@/lib/db/cohorts";

/**
 * Import on one side of the workflow, report on the other.
 *
 * One page rather than two because the loop is import → look → re-import a
 * corrected sheet, and a supervisor doing that three times should not be
 * navigating between screens to do it.
 *
 * The first report is rendered by the server, and selecting a different batch
 * fetches in the handler that caused it. An effect watching `selected` would
 * mean the page always rendered once with the wrong batch and then corrected
 * itself, which is a flash of wrong data to save one prop.
 */
export default function CohortWorkbench({
  initialBatches,
  initialReport,
}: {
  initialBatches: BatchSummary[];
  initialReport: CohortReport | null;
}) {
  const [batches, setBatches] = useState(initialBatches);
  const [selected, setSelected] = useState<string | null>(initialReport?.batch ?? null);
  const [report, setReport] = useState<CohortReport | null>(initialReport);
  const [pending, start] = useTransition();

  function select(batch: string) {
    const next = batch.trim();
    setSelected(next || null);
    start(async () => {
      const [loaded, list] = await Promise.all([
        next ? cohortReportAction(next) : Promise.resolve(null),
        listBatchesAction(),
      ]);
      setReport(loaded);
      setBatches(list);
    });
  }

  return (
    <>
      <section className="no-print rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">Import a batch</h2>
        <CohortImport batches={batches} selected={selected} onSelect={select} />
      </section>

      {pending && (
        <p className="no-print mt-5 flex items-center gap-2 text-sm text-muted">
          <Loader2 className="size-4 animate-spin" /> Comparing every submission against every
          other…
        </p>
      )}

      {report && !pending && (
        <section className="mt-5 rounded-2xl border border-border bg-card p-5">
          <div className="no-print mb-4 flex justify-end">
            <PrintTrigger auto={false} />
          </div>
          <CohortReportView report={report} />
        </section>
      )}

      {selected && !report && !pending && (
        <p className="mt-5 text-sm text-muted">That batch is empty.</p>
      )}
    </>
  );
}
