"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Download, FileText, FileType, Presentation, Printer } from "lucide-react";

// Export dropdown: PDF (print view), Word (editable), PPTX (deck), Markdown (raw).
export default function ExportMenu({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
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
              Word
              <span className="block text-xs text-muted">.docx — editable</span>
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
          <a href={`/projects/${projectId}/export`} className={item} onClick={() => setOpen(false)}>
            <FileText className="size-4 text-brand" />
            <span className="flex-1">
              Markdown
              <span className="block text-xs text-muted">.md source</span>
            </span>
          </a>
        </div>
      )}
    </div>
  );
}
