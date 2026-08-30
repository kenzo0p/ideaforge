"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Lightbulb,
  Loader2,
  Upload,
} from "lucide-react";
import { USAGE_EVENT } from "@/components/UsageMeter";
import type { DocumentReview } from "@/lib/pipeline/types";

type Status = "idle" | "loading" | "done" | "error";

/**
 * Upload a pitch deck (.pptx) or document (.pdf) and get concrete, judge-style
 * feedback on how to make it stronger.
 */
export default function ReviewPanel({ locale }: { locale: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const [review, setReview] = useState<DocumentReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  async function upload(file: File) {
    setFileName(file.name);
    setStatus("loading");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("locale", locale);
      const res = await fetch("/api/review", { method: "POST", body });
      window.dispatchEvent(new Event(USAGE_EVENT));
      if (res.status === 401) {
        router.push("/sign-in");
        return;
      }
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Upload failed." }));
        setError(error ?? "Upload failed.");
        setStatus("error");
        return;
      }
      setReview((await res.json()) as DocumentReview);
      setStatus("done");
    } catch {
      setError("Something went wrong reading that file.");
      setStatus("error");
    }
  }

  const scoreTone =
    !review || review.score >= 75
      ? "text-success"
      : review.score >= 50
        ? "text-warning"
        : "text-danger";

  return (
    <div className="w-full space-y-4">
      {/* Dropzone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        className={`rounded-2xl border-2 border-dashed p-8 text-center transition ${
          dragging ? "border-brand bg-brand/5" : "border-border bg-card"
        }`}
      >
        <span className="mx-auto mb-3 flex size-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
          <Upload className="size-5" />
        </span>
        <p className="font-semibold">Upload your deck or document</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          Drop a <strong>.pptx</strong> or <strong>.pdf</strong> here and I&apos;ll tell you exactly
          how to make it stronger. Max 15 MB.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={status === "loading"}
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90 disabled:opacity-50"
        >
          {status === "loading" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Upload className="size-4" />
          )}
          Choose file
        </button>
        {fileName && (
          <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
            <FileText className="size-3.5" /> {fileName}
          </p>
        )}
      </div>

      {status === "loading" && (
        <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-5 text-sm text-muted shadow-sm">
          <Loader2 className="size-4 animate-spin text-brand" />
          Reading your file and reviewing it like a judge would…
        </div>
      )}

      {status === "error" && (
        <div className="rounded-2xl border border-danger/40 bg-danger/5 p-5 text-sm text-danger shadow-sm">
          ⚠️ {error}
        </div>
      )}

      {status === "done" && review && (
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          {/* Score header */}
          <div className="mb-4 flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className="text-center">
                <div className={`text-3xl font-bold ${scoreTone}`}>{review.score}</div>
                <div className="text-[10px] uppercase tracking-wide text-muted">/ 100</div>
              </div>
              <div>
                <p className="text-sm font-semibold">{review.verdict}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {review.fileName} · {review.sectionCount}{" "}
                  {review.kind === "pptx" ? "slides" : "pages"}
                  {review.truncated && " · long file, reviewed the first part"}
                </p>
              </div>
            </div>
            {review.demo && (
              <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-xs text-warning">
                Demo data
              </span>
            )}
          </div>

          {review.strengths.length > 0 && (
            <Section icon={<CheckCircle2 className="size-4 text-success" />} title="What works">
              {review.strengths.map((s, i) => (
                <Point key={i} title={s.title} detail={s.detail} tone="emerald" />
              ))}
            </Section>
          )}

          {review.improvements.length > 0 && (
            <Section icon={<Lightbulb className="size-4 text-brand" />} title="Make it stronger">
              {review.improvements.map((s, i) => (
                <Point key={i} title={s.title} detail={s.detail} tone="brand" />
              ))}
            </Section>
          )}

          {review.missing.length > 0 && (
            <Section
              icon={<AlertTriangle className="size-4 text-warning" />}
              title="A judge will look for these"
            >
              <ul className="space-y-1.5 text-sm">
                {review.missing.map((m, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="text-warning">•</span>
                    <span className="text-foreground/90">{m}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {review.sectionNotes.length > 0 && (
            <Section
              icon={<FileText className="size-4 text-brand" />}
              title={review.kind === "pptx" ? "Slide-by-slide notes" : "Page-by-page notes"}
            >
              <div className="space-y-2">
                {review.sectionNotes.map((n, i) => (
                  <div key={i} className="rounded-lg border border-border bg-surface p-3">
                    <div className="mb-1 inline-flex items-center gap-2">
                      <span className="rounded bg-brand/10 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
                        {review.kind === "pptx" ? "Slide" : "Page"} {n.index}
                      </span>
                    </div>
                    <p className="text-sm text-muted">{n.issue}</p>
                    <p className="mt-1 text-sm">
                      <span className="font-medium text-brand">Fix → </span>
                      <span className="text-foreground/90">{n.fix}</span>
                    </p>
                  </div>
                ))}
              </div>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  );
}

function Point({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "emerald" | "brand";
}) {
  return (
    <div className="mb-2 rounded-lg border border-border bg-surface p-3">
      <div className={`font-medium ${tone === "emerald" ? "text-success" : "text-brand"}`}>
        {title}
      </div>
      <p className="mt-0.5 text-sm text-foreground/90">{detail}</p>
    </div>
  );
}
