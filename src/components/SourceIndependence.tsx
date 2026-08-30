import { Layers, Link2, Newspaper } from "lucide-react";
import { independenceSentence } from "@/lib/verify/independence";
import type { IndependenceReport, SourceGroup } from "@/lib/verify/independence";

function reasonText(group: SourceGroup): string {
  const publisher = group.reasons.includes("same-publisher");
  const republished = group.reasons.includes("republished-text");
  if (publisher && republished) {
    return `one publisher${group.domain ? ` (${group.domain})` : ""}, and the same text republished elsewhere`;
  }
  if (publisher) return `all published by ${group.domain ?? "one domain"}`;
  return `the same text republished${group.bitsApart !== null ? ` (${group.bitsApart} bits apart)` : ""}`;
}

/**
 * How many independent voices are behind the citations.
 *
 * Renders nothing when every citation is already independent *and* the reader
 * has no reason to wonder — a green "all distinct" line on every brief would
 * become furniture, and furniture is not read. It appears when there is
 * something to say, which is when a list of references is thinner than it looks.
 */
export default function SourceIndependence({ report }: { report: IndependenceReport }) {
  if (report.citations === 0) return null;
  const collapsed = report.citations - report.independent;
  const sentence = independenceSentence(report);
  if (!sentence) return null;

  return (
    <div className="mt-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold">
        <Layers className={`size-3.5 ${collapsed > 0 ? "text-warning" : "text-success"}`} />
        Independent sources
      </div>

      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        <span className={collapsed > 0 ? "text-warning" : "text-success"}>{sentence}</span>{" "}
        Two pages on one domain are one voice however many URLs they occupy, and so is the
        same text reprinted under another masthead.
        {report.unread > 0 && (
          <>
            {" "}
            {report.unread} could not be read, so only {report.unread === 1 ? "its" : "their"}{" "}
            publisher was considered.
          </>
        )}
      </p>

      {report.groups.length > 0 && (
        <ul className="mt-2 space-y-1">
          {report.groups.map((g) => (
            <li key={g.citationIds.join("-")} className="flex items-start gap-1.5 text-[11px]">
              {g.reasons.includes("republished-text") ? (
                <Newspaper className="mt-0.5 size-3 shrink-0 text-warning" />
              ) : (
                <Link2 className="mt-0.5 size-3 shrink-0 text-warning" />
              )}
              <span className="text-muted">
                <span className="font-medium text-foreground">
                  [{g.citationIds.join("], [")}]
                </span>{" "}
                count as one source — {reasonText(g)}.
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.concentration.length > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          Most cited:{" "}
          {report.concentration
            .slice(0, 3)
            .map((d) => `${d.domain} (${d.count})`)
            .join(", ")}
          . Spread across publishers: {Math.round(report.entropy * 100)}%.
        </p>
      )}
    </div>
  );
}
