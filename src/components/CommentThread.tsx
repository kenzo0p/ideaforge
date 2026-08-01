"use client";

import { useState, useTransition } from "react";
import { MessageSquare, Send, Trash2 } from "lucide-react";
import { addCommentAction, deleteCommentAction } from "@/lib/collab-actions";
import { timeAgo } from "@/lib/format";
import type { CommentAnchor, ProjectComment } from "@/lib/db/collaboration";

const ANCHORS: { key: CommentAnchor; label: string }[] = [
  { key: "general", label: "General" },
  { key: "validation", label: "Validation" },
  { key: "research", label: "Research" },
  { key: "plan", label: "Plan" },
  { key: "workspace", label: "Workspace" },
];

/** Discussion on a project. Anyone with access can post; only authors can delete. */
export default function CommentThread({
  projectId,
  comments,
  meId,
}: {
  projectId: string;
  comments: ProjectComment[];
  meId: string;
}) {
  const [body, setBody] = useState("");
  const [anchor, setAnchor] = useState<CommentAnchor>("general");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function post() {
    if (!body.trim()) return;
    setError(null);
    start(async () => {
      const res = await addCommentAction(projectId, anchor, body);
      if (res.error) return setError(res.error);
      setBody("");
    });
  }

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="size-4 text-brand" />
        <h2 className="text-sm font-semibold">Discussion</h2>
        {comments.length > 0 && <span className="text-xs text-muted">{comments.length}</span>}
      </div>

      {comments.length === 0 ? (
        <p className="mb-4 text-sm text-muted">
          No comments yet. Leave a note for whoever picks this up next.
        </p>
      ) : (
        <ul className="mb-4 space-y-3">
          {comments.map((c) => (
            <li key={c.id} className="rounded-lg border border-border bg-surface p-3">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold">{c.authorName}</span>
                {c.anchor !== "general" && (
                  <span className="rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-medium text-brand">
                    {c.anchor}
                  </span>
                )}
                <span className="text-[10px] text-muted">{timeAgo(c.createdAt)}</span>
                {c.userId === meId && (
                  <button
                    onClick={() => start(async () => void (await deleteCommentAction(projectId, c.id)))}
                    title="Delete comment"
                    className="ml-auto rounded-md p-1 text-muted transition hover:text-danger"
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t border-border pt-4">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ANCHORS.map((a) => (
            <button
              key={a.key}
              onClick={() => setAnchor(a.key)}
              className={`rounded-full px-2.5 py-1 text-xs transition ${
                anchor === a.key
                  ? "bg-brand-solid text-on-brand"
                  : "border border-border text-muted hover:bg-hover"
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            // Enter posts; Shift+Enter is a newline — a comment box, not an essay.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              post();
            }
          }}
          rows={2}
          placeholder="Add a comment…"
          className="w-full resize-y rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand/60"
        />
        {error && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="mt-2 flex justify-end">
          <button
            onClick={post}
            disabled={pending || !body.trim()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-brand-solid px-3.5 py-1.5 text-sm font-semibold text-on-brand transition hover:opacity-90 disabled:opacity-50"
          >
            <Send className="size-3.5" /> {pending ? "Posting…" : "Comment"}
          </button>
        </div>
      </div>
    </div>
  );
}
