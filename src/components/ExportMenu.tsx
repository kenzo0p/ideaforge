"use client";

import { useEffect, useRef, useState } from "react";
import UpgradePrompt from "@/components/UpgradePrompt";
import { useState as useReactState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  FileText,
  FileType,
  Loader2,
  Presentation,
  Printer,
} from "lucide-react";
import { exportToGoogleDocsAction, exportToNotionAction } from "@/lib/integration-actions";

// Export dropdown.
//
// No Notion or Google Docs API integration: both would need OAuth app
// registration and stored tokens for something each tool already does natively.
// Google Docs opens .docx directly; Notion pastes Markdown as real blocks. So
// the honest version is to label the formats by where they actually go, and add
// a clipboard copy for the Notion path.
export default function ExportMenu({
  projectId,
  integrations,
}: {
  projectId: string;
  /** Which providers are configured on the server and connected by this user. */
  integrations?: { notionAvailable: boolean; googleAvailable: boolean };
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useReactState(false);
  const [busy, setBusy] = useReactState<"notion" | "google" | null>(null);
  const [sent, setSent] = useReactState<{ url: string; label: string } | null>(null);
  const [error, setError] = useReactState<string | null>(null);
  const [upgrade, setUpgrade] = useReactState<"pro" | "team" | null>(null);
  const [, startExport] = useTransition();

  /**
   * Push the brief to a connected tool.
   *
   * A missing connection isn't an error — it's a redirect to the consent
   * screen, with `next` set so the user lands back here afterwards.
   */
  function pushTo(provider: "notion" | "google") {
    setBusy(provider);
    setError(null);
    setUpgrade(null);
    setSent(null);
    startExport(async () => {
      const run = provider === "notion" ? exportToNotionAction : exportToGoogleDocsAction;
      const res = await run(projectId);
      setBusy(null);
      if (res.needsConnect) {
        window.location.assign(`/api/integrations/connect?provider=${res.needsConnect}&next=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`);
        return;
      }
      if (res.error) {
        // A plan refusal is the one error worth turning into an offer.
        setUpgrade(res.upgradeTo ?? null);
        return setError(res.error);
      }
      if (res.url) setSent({ url: res.url, label: provider === "notion" ? "Notion" : "Google Docs" });
    });
  }
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
      window.location.assign(`/projects/${projectId}/export`);
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
          {integrations?.googleAvailable && (
            <button onClick={() => pushTo("google")} className={item} type="button" disabled={!!busy}>
              {busy === "google" ? (
                <Loader2 className="size-4 animate-spin text-brand" />
              ) : (
                <FileType className="size-4 text-brand" />
              )}
              <span className="flex-1">
                Send to Google Docs
                <span className="block text-xs text-muted">Creates an editable doc</span>
              </span>
            </button>
          )}
          {integrations?.notionAvailable && (
            <button onClick={() => pushTo("notion")} className={item} type="button" disabled={!!busy}>
              {busy === "notion" ? (
                <Loader2 className="size-4 animate-spin text-brand" />
              ) : (
                <FileText className="size-4 text-brand" />
              )}
              <span className="flex-1">
                Send to Notion
                <span className="block text-xs text-muted">Creates a page in your workspace</span>
              </span>
            </button>
          )}

          <div className="my-1 border-t border-border" />

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
          {sent && (
            <a
              href={sent.url}
              target="_blank"
              rel="noopener noreferrer"
              className="m-1 flex items-center gap-2 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
            >
              <Check className="size-4 shrink-0" />
              <span className="flex-1">Created in {sent.label} — open it</span>
              <ExternalLink className="size-3.5 shrink-0" />
            </a>
          )}
          {error && upgrade && (
            <UpgradePrompt reason={error} plan={upgrade} limit="integrations" compact />
          )}
          {error && !upgrade && (
            <p role="alert" className="m-1 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
