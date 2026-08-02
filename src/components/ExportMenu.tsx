"use client";

import { useEffect, useRef, useState } from "react";
import { useState as useReactState } from "react";
import { Check, ChevronDown, Copy, Download, FileText, FileType, Presentation, Printer } from "lucide-react";

// Export dropdown.
//
// No Notion or Google Docs API integration: both would need OAuth app
// registration and stored tokens for something each tool already does natively.
// Google Docs opens .docx directly; Notion pastes Markdown as real blocks. So
// the honest version is to label the formats by where they actually go, and add
// a clipboard copy for the Notion path.
export default function ExportMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useReactState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const item =
    "flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-foreground/90 transition hover:bg-hover";

  /**
   * Fetch the brief and put it on the clipboard. Notion turns pasted Markdown
   * into real headings, lists and tables, so this is a better path than
   * downloading a file and importing it.
   */
  async function copyForNotion() {
    try {
      const res = await fetch(`/projects/${projectId}/export?inline=1`);
      if (!res.ok) throw new Error("export failed");
      await navigator.clipboard.writeText(await res.text());
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
        setOpen(false);
      }, 1400);
    } catch {
      // Clipboard can be blocked by permissions; fall back to the file.
      window.location.href = `/projects/${projectId}/export`;
    }
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium transition hover:border-brand/50"
      >
        <Download className="size-4" /> Export
        <ChevronDown className={`size-3.5 transition ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-xl border border-border bg-card py-1 shadow-lg">
          <a href={`/projects/${projectId}/brief`} className={item} onClick={() => setOpen(false)}>
            <Printer className="size-4 text-brand" />
            <span className="flex-1">
              PDF
              <span className="block text-xs text-muted">Opens print view</span>
            </span>
          </a>
          <a
            href={`/projects/${projectId}/export/docx`}
            className={item}
            onClick={() => setOpen(false)}
          >
            <FileType className="size-4 text-brand" />
            <span className="flex-1">
              Word / Google Docs
              <span className="block text-xs text-muted">.docx — opens in both</span>
            </span>
          </a>
          <a
            href={`/projects/${projectId}/export/pptx`}
            className={item}
            onClick={() => setOpen(false)}
          >
            <Presentation className="size-4 text-brand" />
            <span className="flex-1">
              PowerPoint
              <span className="block text-xs text-muted">.pptx deck</span>
            </span>
          </a>
          <button onClick={copyForNotion} className={item} type="button">
            {copied ? (
              <Check className="size-4 text-success" />
            ) : (
              <Copy className="size-4 text-brand" />
            )}
            <span className="flex-1">
              {copied ? "Copied — paste into Notion" : "Copy for Notion"}
              <span className="block text-xs text-muted">
                {copied ? "Pastes as real blocks" : "Markdown to clipboard"}
              </span>
            </span>
          </button>
          <a href={`/projects/${projectId}/export`} className={item} onClick={() => setOpen(false)}>
            <FileText className="size-4 text-brand" />
            <span className="flex-1">
              Markdown
              <span className="block text-xs text-muted">.md file</span>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
