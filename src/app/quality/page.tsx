import Link from "next/link";
import type { Metadata } from "next";
import { AlertTriangle, CheckCircle2, FlaskConical, ShieldQuestion, XCircle } from "lucide-react";
import report from "@/data/eval-report.json";
import { publicUrl } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

interface Dimension {
  tag: string;
  description: string;
  passed: number;
  total: number;
}

interface NamedCheck {
  caseId: string;
  label: string;
}

/**
 * The artifact's shape, declared rather than inferred.
 *
 * A published report with no failures leaves `failing` as an empty array, which
 * TypeScript infers as `never[]` — so the shape has to be stated here, or the
 * page stops compiling on the happy day everything passes.
 */
interface EvalReport {
  ranAt: string | null;
  repeats: number;
  cases: number;
  checks: { passed: number; scored: number; flaky: number };
  pct: number;
  dimensions: Dimension[];
  failing: NamedCheck[];
  flakyChecks: NamedCheck[];
}

const evaluation = report as EvalReport;

export async function generateMetadata(): Promise<Metadata> {
  const url = await publicUrl("/quality");
  const description =
    evaluation.ranAt === null
      ? "How Scrutan measures its own output quality: thirty tagged cases, majority-vote scoring, and the failures published alongside the passes."
      : `Scrutan scores ${evaluation.pct}% on its own ${evaluation.cases}-case quality suite. The failing checks are listed with the passing ones.`;
  return {
    title: "How well does it actually work? — Scrutan",
    description,
    alternates: { canonical: url },
    openGraph: { title: "Scrutan quality scoreboard", description, url, siteName: "Scrutan" },
  };
}

function pctOf(passed: number, total: number): number {
  return total === 0 ? 0 : Math.round((passed / total) * 100);
}

function tone(pct: number): string {
  return pct >= 90 ? "text-success" : pct >= 70 ? "text-warning" : "text-danger";
}

/**
 * The scoreboard, in public.
 *
 * Every AI product claims its answers are good. The claim is unfalsifiable
 * because nobody publishes the measurement, which makes "our output is high
 * quality" the same category of statement as an uncited citation — and this
 * product's whole argument is that such statements should not be believed.
 *
 * So the numbers are here, including the ones that are not flattering. A page
 * that listed only passing checks would be a marketing asset; listing the
 * failures is what makes it evidence.
 */
export default function QualityPage() {
  const { dimensions, checks, failing, flakyChecks, pct, cases, repeats } = evaluation;
  const ran = evaluation.ranAt ? new Date(evaluation.ranAt) : null;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <FlaskConical className="size-6 text-brand" />
        How well does it actually work?
      </h1>
      <p className="mb-8 max-w-prose text-sm text-muted">
        Scrutan exists to refuse claims that cannot be checked, which would make an
        unchecked claim about its own quality the most embarrassing thing on the site. So
        the output is scored against a fixed set of cases, and the score is published here —
        including the checks it fails.
      </p>

      {ran === null ? (
        <section className="rounded-2xl border border-dashed border-border p-8 text-center">
          <ShieldQuestion className="mx-auto mb-3 size-6 text-muted" />
          <h2 className="text-sm font-semibold">No run has been published yet.</h2>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted">
            The suite exists and runs locally; nothing has been published to this page. An
            invented number here would be the exact failure this page is about, so it stays
            empty until a real run fills it.
          </p>
          <p className="mt-3 font-mono text-xs text-muted">npm run eval:publish</p>
        </section>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-card p-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className={`text-4xl font-bold tabular-nums ${tone(pct)}`}>
                {pct}%
              </span>
              <span className="text-sm text-muted">
                {checks.passed} of {checks.scored} checks passed
              </span>
            </div>
            <p className="mt-2 max-w-prose text-xs text-muted">
              {cases} cases, each run {repeats} times and scored by majority.
              {checks.flaky > 0 && (
                <>
                  {" "}
                  {checks.flaky}{" "}
                  {checks.flaky === 1 ? "check" : "checks"} disagreed with{" "}
                  {checks.flaky === 1 ? "itself" : "themselves"} across repeats and{" "}
                  {checks.flaky === 1 ? "is" : "are"} excluded from the score rather
                  than counted either way.
                </>
              )}{" "}
              Last run{" "}
              <time dateTime={ran.toISOString()} suppressHydrationWarning>
                {ran.toISOString().slice(0, 10)}
              </time>
              .
            </p>
          </section>

          <section className="mt-5 rounded-2xl border border-border bg-card p-5">
            <h2 className="mb-1 text-sm font-semibold">By dimension</h2>
            <p className="mb-4 max-w-prose text-xs text-muted">
              An overall number tells you something is wrong. This tells you where.
            </p>
            <ul className="space-y-3">
              {dimensions.map((d) => {
                const p = pctOf(d.passed, d.total);
                return (
                  <li key={d.tag}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium capitalize">{d.tag}</span>
                      <span className={`text-sm font-semibold tabular-nums ${tone(p)}`}>
                        {p}%{" "}
                        <span className="text-xs font-normal text-muted">
                          ({d.passed}/{d.total})
                        </span>
                      </span>
                    </div>
                    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border">
                      <div
                        className={`h-full rounded-full ${
                          p >= 90 ? "bg-success" : p >= 70 ? "bg-warning" : "bg-danger"
                        }`}
                        style={{ width: `${p}%` }}
                      />
                    </div>
                    {d.description && (
                      <p className="mt-1 text-xs text-muted">{d.description}</p>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          {(failing.length > 0 || flakyChecks.length > 0) && (
            <section className="mt-5 rounded-2xl border border-border bg-card p-5">
              <h2 className="mb-1 text-sm font-semibold">What it currently gets wrong</h2>
              <p className="mb-3 max-w-prose text-xs text-muted">
                Published for the same reason the dead links on a brief are: a score with the
                failures removed is not a score.
              </p>
              <ul className="space-y-1.5">
                {failing.map((f) => (
                  <li key={`${f.caseId}:${f.label}`} className="flex items-start gap-2 text-xs">
                    <XCircle className="mt-0.5 size-3.5 shrink-0 text-danger" />
                    <span>
                      <span className="font-mono text-[11px] text-muted">{f.caseId}</span> —{" "}
                      {f.label}
                    </span>
                  </li>
                ))}
                {flakyChecks.map((f) => (
                  <li key={`${f.caseId}:${f.label}`} className="flex items-start gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
                    <span>
                      <span className="font-mono text-[11px] text-muted">{f.caseId}</span> —{" "}
                      {f.label}{" "}
                      <span className="text-muted">(inconsistent across repeats)</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="mt-5 rounded-2xl border border-border bg-card p-5">
        <h2 className="mb-3 text-sm font-semibold">How the number is produced</h2>
        <ul className="space-y-2.5 text-xs text-muted">
          <Point icon="check">
            <strong className="text-foreground">Substance, not wording.</strong> A case passes
            when a crowded space is called crowded and a geospatial idea produces geospatial
            tooling — never when the answer matched a phrase.
          </Point>
          <Point icon="check">
            <strong className="text-foreground">Variance is handled.</strong> Each case runs
            several times. A check that passes some repeats and fails others is reported as
            inconsistent rather than counted as either.
          </Point>
          <Point icon="check">
            <strong className="text-foreground">Regressions beat absolutes.</strong> The
            deploy gate is not this percentage; it is whether a check that passed yesterday
            fails today.
          </Point>
          <Point icon="check">
            <strong className="text-foreground">A run that reached nothing reports nothing.</strong>{" "}
            If the model provider stops answering, the run aborts with its error rather than
            reporting the outage as a quality collapse.
          </Point>
          <Point icon="warn">
            <strong className="text-foreground">What this does not measure.</strong> Thirty
            cases are not the space of all ideas, and the checks were written by the same
            people who wrote the prompts. It catches decay; it does not prove correctness.
          </Point>
        </ul>
      </section>

      <p className="mt-6 text-center text-xs text-muted">
        <Link href="/" className="underline hover:text-foreground">
          Put an idea through it
        </Link>
      </p>
    </main>
  );
}

function Point({ icon, children }: { icon: "check" | "warn"; children: React.ReactNode }) {
  const Icon = icon === "check" ? CheckCircle2 : AlertTriangle;
  return (
    <li className="flex items-start gap-2">
      <Icon
        className={`mt-0.5 size-3.5 shrink-0 ${icon === "check" ? "text-success" : "text-warning"}`}
      />
      <span className="leading-relaxed">{children}</span>
    </li>
  );
}
