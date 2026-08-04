"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Globe, Loader2, X } from "lucide-react";
import { addOrgDomainAction, removeOrgDomainAction } from "@/lib/org-actions";

export default function OrgDomains({
  domains,
  yourEmail,
}: {
  domains: string[];
  yourEmail: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const suggestion = yourEmail.split("@")[1] ?? "";

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) return setError(res.error);
      setValue("");
      router.refresh();
    });
  }

  return (
    <div>
      {domains.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-2">
          {domains.map((d) => (
            <li
              key={d}
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1 text-sm"
            >
              <Globe className="size-3 text-brand" />
              {d}
              <button
                onClick={() => run(() => removeOrgDomainAction(d))}
                disabled={pending}
                aria-label={`Remove ${d}`}
                className="rounded-full p-0.5 text-muted transition hover:text-danger disabled:opacity-50"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={suggestion || "yourinstitution.edu"}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <button
          onClick={() => run(() => addOrgDomainAction(value))}
          disabled={pending || !value.trim()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3.5 py-2 text-sm font-medium transition hover:bg-hover disabled:opacity-50"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Claim domain
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
