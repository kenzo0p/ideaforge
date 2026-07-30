"use client";

import { useState, useTransition } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { deleteProjectAction } from "@/lib/actions";

// Two-step delete: first click asks for confirmation, second click commits.
export default function DeleteProjectButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-1 text-xs">
        <button
          onClick={() => startTransition(() => deleteProjectAction(id))}
          disabled={pending}
          className="inline-flex items-center gap-1 rounded-md bg-danger/15 px-2 py-1 font-medium text-danger hover:bg-danger/25"
        >
          {pending ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
          Confirm
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="rounded-md px-2 py-1 text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted transition hover:text-danger"
      aria-label="Delete project"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}
