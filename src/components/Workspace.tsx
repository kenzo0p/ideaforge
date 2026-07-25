"use client";

import { useRef, useTransition } from "react";
import {
  ExternalLink,
  Flag,
  Link2,
  Loader2,
  Plus,
  StickyNote,
  Trash2,
} from "lucide-react";
import { addWorkspaceItemAction, deleteWorkspaceItemAction } from "@/lib/actions";
import type { WorkspaceItem, WorkspaceKind } from "@/lib/db/projects";

const KINDS: Array<{ value: WorkspaceKind; label: string; icon: React.ReactNode }> = [
  { value: "source", label: "Source", icon: <Link2 className="size-3.5" /> },
  { value: "note", label: "Note", icon: <StickyNote className="size-3.5" /> },
  { value: "decision", label: "Decision", icon: <Flag className="size-3.5" /> },
];

// Research Workspace: capture sources, notes, and decisions for a project.
export default function Workspace({
  projectId,
  items,
}: {
  projectId: string;
  items: WorkspaceItem[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();

  const groups: Array<{ kind: WorkspaceKind; label: string; icon: React.ReactNode }> = [
    { kind: "source", label: "Sources", icon: <Link2 className="size-4 text-brand" /> },
    { kind: "note", label: "Notes", icon: <StickyNote className="size-4 text-brand" /> },
    { kind: "decision", label: "Decisions", icon: <Flag className="size-4 text-brand" /> },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold">Research Workspace</h2>
      <p className="mb-4 text-sm text-muted">
        Keep the sources, notes, and decisions for this project in one place.
      </p>

      {/* Add form */}
      <form
        ref={formRef}
        action={(fd) =>
          startTransition(async () => {
            await addWorkspaceItemAction(fd);
            formRef.current?.reset();
          })
        }
        className="mb-6 grid gap-2 rounded-xl border border-border bg-background/40 p-3 sm:grid-cols-[auto_1fr_auto]"
      >
        <input type="hidden" name="projectId" value={projectId} />
        <select
          name="kind"
          defaultValue="note"
          className="rounded-lg border border-border bg-card px-2 py-2 text-sm outline-none"
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
        <input
          name="title"
          required
          placeholder="Title (required)"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand/60"
        />
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
          Add
        </button>
        <input
          name="url"
          placeholder="URL (optional, for sources)"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand/60 sm:col-span-3"
        />
        <textarea
          name="body"
          rows={2}
          placeholder="Details (optional)"
          className="resize-none rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus:border-brand/60 sm:col-span-3"
        />
      </form>

      {/* Items grouped by kind */}
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing saved yet — add your first item above.</p>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const list = items.filter((i) => i.kind === g.kind);
            if (list.length === 0) return null;
            return (
              <section key={g.kind}>
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
                  {g.icon}
                  {g.label}
                  <span className="text-xs font-normal text-muted">({list.length})</span>
                </h3>
                <ul className="space-y-2">
                  {list.map((item) => (
                    <WorkspaceRow key={item.id} item={item} projectId={projectId} />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function WorkspaceRow({ item, projectId }: { item: WorkspaceItem; projectId: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <li className="flex items-start justify-between gap-3 rounded-lg border border-border bg-background/40 p-3">
      <div className="min-w-0">
        {item.url ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-medium hover:text-brand"
          >
            {item.title}
            <ExternalLink className="size-3 opacity-50" />
          </a>
        ) : (
          <span className="font-medium">{item.title}</span>
        )}
        {item.body && <p className="mt-0.5 text-sm text-muted">{item.body}</p>}
      </div>
      <button
        onClick={() => startTransition(() => deleteWorkspaceItemAction(item.id, projectId))}
        disabled={pending}
        className="shrink-0 rounded-md p-1 text-muted transition hover:text-rose-500"
        aria-label="Delete item"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
      </button>
    </li>
  );
}
