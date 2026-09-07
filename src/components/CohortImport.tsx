"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, FileUp, Loader2, Trash2 } from "lucide-react";
import {
  deleteBatchAction,
  importCohortAction,
  type ImportResult,
} from "@/lib/cohort-actions";
import type { BatchSummary } from "@/lib/db/cohorts";

const EXAMPLE = `Roll No,Student Name,Project Title,Idea Description
21CS001,Aarav Shah,Mess Forecast,"Forecast hostel dinner headcount to cut over-preparation"
21CS002,Diya Nair,Lab Matcher,"Match students to research labs by their coursework interests"`;

/**
 * A batch to try it on.
 *
 * The first thing anyone evaluating this asks is "show me", and the honest
 * answer used to be "prepare a spreadsheet first".
 *
 * Two pairs here describe the same project in different words. Only one of them
 * crosses the threshold — the other measures 0.646 against a 0.70 cut-off, and
 * is reported as distinct. That is left in deliberately. A demo tuned so
 * everything it plants is found teaches the reader that the tool is infallible,
 * which is both untrue and the opposite of what this product argues; a
 * conservative threshold missing a real pair is what the trade-off actually
 * looks like, and it is better seen than described.
 */
const SAMPLE = `Roll No,Student Name,Project Title,Idea Description
21CS001,Aarav Shah,Mess Forecast,"A tool that predicts how many students will eat dinner in the hostel mess so the kitchen cooks less and wastes less"
21CS002,Diya Nair,Lab Matcher,"A platform connecting undergraduates with professors' research labs based on their coursework and interests"
21CS003,Kabir Das,Meal Demand,"Predicting hostel dinner headcount ahead of time so kitchens can reduce over-preparation and food waste"
21CS004,Meera Rao,Air Watch,"A low-cost sensor that logs classroom carbon dioxide through the day and flags poorly ventilated rooms"
21CS005,Rohan Iyer,Research Connect,"Helping students find professors whose labs match what they have studied and want to work on"
21CS006,Sana Qureshi,Drain Sense,"Ranking municipal drains by how likely they are to block and cause waterlogging during monsoon"
21CS007,Vikram Menon,Solar Check,"Checking whether a rooftop solar installation quote is fairly priced against local benchmarks"
21CS008,Ananya Bose,Viva Prep,"Generating likely viva questions from a student's own project report so they can rehearse"`;

/**
 * Bring a cohort's submissions in from wherever they already are.
 *
 * A paste box rather than a file picker, because the submissions are usually in
 * a Google Sheet and selecting-all is fewer steps than exporting. The parser
 * accepts what a spreadsheet actually puts on the clipboard — tabs as often as
 * commas — so the common path needs no instructions at all.
 */
export default function CohortImport({
  batches,
  selected,
  onSelect,
}: {
  batches: BatchSummary[];
  selected: string | null;
  onSelect: (batch: string) => void;
}) {
  const [batch, setBatch] = useState("");
  const [sheet, setSheet] = useState("");
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = useTransition();

  function submit() {
    start(async () => {
      const res = await importCohortAction(batch, sheet);
      setResult(res);
      if (!res.error) {
        setSheet("");
        onSelect(batch.trim());
      }
    });
  }

  function remove(name: string) {
    if (!confirm(`Delete every submission in "${name}"? This cannot be undone.`)) return;
    start(async () => {
      await deleteBatchAction(name);
      if (selected === name) onSelect("");
    });
  }

  return (
    <div className="space-y-4">
      {batches.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {batches.map((b) => (
            <span
              key={b.batch}
              className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
                selected === b.batch
                  ? "border-brand/50 bg-brand/10 text-foreground"
                  : "border-border text-muted"
              }`}
            >
              <button onClick={() => onSelect(b.batch)} className="font-medium hover:text-brand">
                {b.batch}
              </button>
              <span className="tabular-nums opacity-70">{b.count}</span>
              <button
                onClick={() => remove(b.batch)}
                aria-label={`Delete ${b.batch}`}
                className="ml-0.5 rounded p-0.5 text-muted transition hover:text-danger"
              >
                <Trash2 className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="block">
          <span className="text-xs font-semibold">Batch name</span>
          <input
            value={batch}
            onChange={(e) => setBatch(e.target.value)}
            placeholder="2026 Final Year"
            className="mt-1 w-full rounded-lg border border-border-strong bg-card px-3 py-2 text-sm outline-none focus:border-brand/60"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold">Submissions</span>
          <textarea
            value={sheet}
            onChange={(e) => setSheet(e.target.value)}
            rows={6}
            placeholder={EXAMPLE}
            className="mt-1 w-full rounded-lg border border-border-strong bg-card p-3 font-mono text-[11px] outline-none focus:border-brand/60"
          />
        </label>
      </div>

      <p className="text-[11px] text-muted">
        <button
          onClick={() => {
            setBatch(batch || "Sample batch");
            setSheet(SAMPLE);
          }}
          className="underline hover:text-foreground"
        >
          Fill in a sample batch
        </button>{" "}
        to see what the report looks like. Eight proposals, containing two pairs that are
        arguably the same project — the grouping finds one of them and rates the other as
        distinct, which is what a threshold set to avoid false accusations costs you.
      </p>

      <p className="text-[11px] text-muted">
        Paste straight from a spreadsheet — commas or tabs, quoted fields, either line ending.
        Keep the header row: the columns are found by name, and anything unusable is reported
        by line number rather than dropped. Re-importing a batch replaces it.
      </p>

      <button
        onClick={submit}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}
        {pending ? "Reading and comparing…" : "Import batch"}
      </button>

      {result?.error && (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      )}

      {result && !result.error && (
        <div className="rounded-lg border border-border bg-surface p-3 text-xs">
          <p className="font-medium text-success">
            Imported {result.imported} submission{result.imported === 1 ? "" : "s"}.
          </p>
          {result.columns && Object.keys(result.columns).length > 0 && (
            <p className="mt-1 text-[11px] text-muted">
              Read as:{" "}
              {Object.entries(result.columns)
                .map(([field, header]) => `${field} ← “${header}”`)
                .join(", ")}
              .
            </p>
          )}
          {result.skipped && result.skipped.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {result.skipped.map((s) => (
                <li key={s.line} className="flex items-start gap-1.5 text-[11px] text-warning">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                  Line {s.line}: {s.why}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
