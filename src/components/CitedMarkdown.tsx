"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ExternalLink, X } from "lucide-react";
import type { Citation } from "@/lib/insights/types";

// ---------------------------------------------------------------------------
// Markdown with clickable citations.
//
// The briefing is written with `[3]` and `[2, 5]` markers. Rendered as plain
// text they're just noise — the reader has to scroll to the source list and
// count. Turning each marker into a control that reveals the source it points
// at is what makes "every claim is checkable" true in practice rather than in
// principle.
//
// The substitution happens on the *text nodes* of the rendered tree, not on the
// markdown string, so a `[2]` inside a code block or a link label is left alone.
// ---------------------------------------------------------------------------

const MARKER = /\[(\d+(?:\s*,\s*\d+)*)\]/g;

function CitationChip({
  ids,
  citations,
  onOpen,
}: {
  ids: number[];
  citations: Citation[];
  onOpen: (c: Citation) => void;
}) {
  const known = ids.map((id) => citations.find((c) => c.id === id)).filter(Boolean) as Citation[];
  // A marker pointing at nothing is rendered as-is rather than as a dead button.
  if (known.length === 0) return <>[{ids.join(", ")}]</>;

  return (
    <span className="inline-flex gap-0.5 align-baseline">
      {known.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onOpen(c)}
          title={`${c.title} — ${c.source}`}
          className="inline-flex min-w-[1.25rem] items-center justify-center rounded bg-brand/12 px-1 text-[0.72em] font-semibold text-brand transition hover:bg-brand/25"
        >
          {c.id}
        </button>
      ))}
    </span>
  );
}

/** Walk a rendered child list and swap `[n]` markers for chips. */
function withCitations(
  children: React.ReactNode,
  citations: Citation[],
  onOpen: (c: Citation) => void,
): React.ReactNode {
  return Array.isArray(children)
    ? children.map((child, i) => <Fragmented key={i} node={child} citations={citations} onOpen={onOpen} />)
    : <Fragmented node={children} citations={citations} onOpen={onOpen} />;
}

function Fragmented({
  node,
  citations,
  onOpen,
}: {
  node: React.ReactNode;
  citations: Citation[];
  onOpen: (c: Citation) => void;
}) {
  if (typeof node !== "string") return <>{node}</>;

  const parts: React.ReactNode[] = [];
  let last = 0;
  for (const m of node.matchAll(MARKER)) {
    const start = m.index ?? 0;
    if (start > last) parts.push(node.slice(last, start));
    const ids = m[1].split(",").map((n) => Number(n.trim())).filter(Number.isInteger);
    parts.push(
      <CitationChip key={`${start}-${m[1]}`} ids={ids} citations={citations} onOpen={onOpen} />,
    );
    last = start + m[0].length;
  }
  if (parts.length === 0) return <>{node}</>;
  if (last < node.length) parts.push(node.slice(last));
  return <>{parts}</>;
}

export default function CitedMarkdown({
  children,
  citations,
  className = "",
}: {
  children: string;
  citations: Citation[];
  className?: string;
}) {
  const [open, setOpen] = useState<Citation | null>(null);

  const inline = (Tag: "p" | "li" | "strong" | "em" | "td") =>
    function Component({ children: c }: { children?: React.ReactNode }) {
      return <Tag>{withCitations(c, citations, setOpen)}</Tag>;
    };

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: inline("p"),
          li: inline("li"),
          strong: inline("strong"),
          em: inline("em"),
          td: inline("td"),
        }}
      >
        {children}
      </ReactMarkdown>

      {open && (
        <div className="mt-3 rounded-xl border border-brand/40 bg-brand/5 p-3">
          <div className="mb-1 flex items-start justify-between gap-2">
            <span className="text-xs font-semibold text-brand">Source [{open.id}]</span>
            <button
              onClick={() => setOpen(null)}
              aria-label="Close source"
              className="rounded p-0.5 text-muted transition hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <a
            href={open.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group inline-flex items-baseline gap-1 text-sm font-medium text-foreground hover:text-brand"
          >
            <span className="underline decoration-border underline-offset-2 group-hover:decoration-brand">
              {open.title}
            </span>
            <ExternalLink className="size-3 shrink-0 self-center opacity-60" />
          </a>
          <p className="mt-0.5 text-xs text-muted">{open.source}</p>
          {open.snippet && (
            <p className="mt-2 border-t border-border pt-2 text-xs leading-relaxed text-muted">
              “{open.snippet}”
            </p>
          )}
        </div>
      )}
    </div>
  );
}
