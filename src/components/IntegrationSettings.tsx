"use client";

import { useTransition } from "react";
import { Check, FileText, FileType, Link2, Unlink } from "lucide-react";
import { disconnectIntegrationAction } from "@/lib/integration-actions";
import type { Connection, Provider } from "@/lib/db/integrations";

const PROVIDERS: {
  id: Provider;
  name: string;
  blurb: string;
  icon: typeof FileText;
}[] = [
  {
    id: "google",
    name: "Google Docs",
    blurb: "Send a project straight to Drive as an editable document.",
    icon: FileType,
  },
  {
    id: "notion",
    name: "Notion",
    blurb: "Create a page in your workspace with real headings and lists.",
    icon: FileText,
  },
];

/**
 * Connect / disconnect panel.
 *
 * A provider the server hasn't been configured for is shown as unavailable
 * rather than hidden — otherwise "why is there no Notion button?" has no
 * answer visible anywhere in the product.
 */
export default function IntegrationSettings({
  connections,
  available,
}: {
  connections: Connection[];
  available: { notion: boolean; google: boolean };
}) {
  const [pending, start] = useTransition();

  return (
    <ul className="space-y-3">
      {PROVIDERS.map((p) => {
        const connected = connections.find((c) => c.provider === p.id);
        const usable = available[p.id];
        const Icon = p.icon;

        return (
          <li key={p.id} className="flex items-start gap-3">
            <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface">
              <Icon className="size-4 text-brand" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{p.name}</span>
                {connected && <Check className="size-3.5 text-success" />}
              </div>
              <p className="mt-0.5 text-xs text-muted">
                {connected ? `Connected — ${connected.accountLabel}` : p.blurb}
              </p>
              {!usable && !connected && (
                <p className="mt-0.5 text-xs text-warning">
                  Not configured on this deployment.
                </p>
              )}
            </div>

            {connected ? (
              <button
                onClick={() => start(async () => void (await disconnectIntegrationAction(p.id)))}
                disabled={pending}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-medium transition hover:bg-hover disabled:opacity-50"
              >
                <Unlink className="size-3.5" /> Disconnect
              </button>
            ) : (
              <a
                href={
                  usable
                    ? `/api/integrations/connect?provider=${p.id}&next=/settings`
                    : undefined
                }
                aria-disabled={!usable}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  usable
                    ? "bg-brand-solid text-on-brand hover:opacity-90"
                    : "pointer-events-none border border-border text-muted opacity-60"
                }`}
              >
                <Link2 className="size-3.5" /> Connect
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
