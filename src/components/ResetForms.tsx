"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { KeyRound, Loader2, MailCheck } from "lucide-react";
import {
  requestPasswordResetAction,
  resetPasswordAction,
  type ResetState,
} from "@/lib/auth/reset-actions";

const input =
  "w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-sm outline-none focus:border-brand/60";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand-solid px-4 py-2.5 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90 disabled:opacity-50"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {label}
    </button>
  );
}

function ErrorNote({ error }: { error?: string }) {
  if (!error) return null;
  return (
    <p className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
      {error}
    </p>
  );
}

/** Step 1 — ask for the account email. */
export function ForgotPasswordForm() {
  const [state, action] = useActionState<ResetState, FormData>(requestPasswordResetAction, {});

  if (state.sent) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
        <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-brand/10 text-brand">
          <MailCheck className="size-5" />
        </span>
        <p className="font-semibold">Check your inbox</p>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
          If an account exists for that address, we&apos;ve sent a reset link. It expires in 1 hour.
        </p>

        {state.devToken && (
          <div className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4 text-left text-sm">
            <p className="mb-2 font-semibold text-warning dark:text-warning">
              Email couldn&apos;t be delivered to this address
            </p>
            <p className="mb-3 text-muted">
              No mail provider is configured (or the recipient is restricted). Use this fallback
              link:
            </p>
            <a
              href={`/reset-password?token=${state.devToken}`}
              className="inline-block rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
            >
              Reset my password →
            </a>
          </div>
        )}

        <p className="mt-5 text-sm">
          <Link href="/sign-in" className="text-brand hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Email</span>
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className={input}
        />
      </label>
      <ErrorNote error={state.error} />
      <Submit label="Send reset link" />
    </form>
  );
}

/** Step 2 — choose a new password using the token from the email. */
export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action] = useActionState<ResetState, FormData>(resetPasswordAction, {});

  return (
    <form action={action} className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
      <input type="hidden" name="token" value={token} />
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">New password</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className={input}
        />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Confirm new password</span>
        <input
          name="confirm"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className={input}
        />
      </label>
      <ErrorNote error={state.error} />
      <p className="text-xs text-muted">
        <KeyRound className="mr-1 inline size-3" />
        Resetting signs you out of all devices.
      </p>
      <Submit label="Set new password" />
    </form>
  );
}
