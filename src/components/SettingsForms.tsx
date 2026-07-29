"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, Loader2 } from "lucide-react";
import {
  changePasswordAction,
  deleteAccountAction,
  updateProfileAction,
  type SettingsState,
} from "@/lib/auth/settings-actions";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "ar", label: "العربية" },
  { code: "zh", label: "中文" },
  { code: "ja", label: "日本語" },
];

const input =
  "w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-brand/60";

function Submit({ label, danger = false }: { label: string; danger?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition disabled:opacity-50 ${
        danger ? "bg-rose-600 text-white hover:opacity-90" : "bg-brand text-white hover:opacity-90"
      }`}
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {label}
    </button>
  );
}

function Notice({ state }: { state: SettingsState }) {
  if (state.error)
    return (
      <p className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
        {state.error}
      </p>
    );
  if (state.success)
    return (
      <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-600 dark:text-emerald-400">
        {state.success}
      </p>
    );
  return null;
}

export function ProfileForm({
  name,
  locale,
  email,
}: {
  name: string | null;
  locale: string | null;
  email: string;
}) {
  const [state, action] = useActionState<SettingsState, FormData>(updateProfileAction, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Email</span>
        <input value={email} readOnly disabled className={`${input} opacity-60`} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Name</span>
        <input name="name" defaultValue={name ?? ""} placeholder="Your name" className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Default output language</span>
        <select name="locale" defaultValue={locale ?? "en"} className={input}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <Notice state={state} />
      <Submit label="Save changes" />
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState<SettingsState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Current password</span>
        <input name="current" type="password" required autoComplete="current-password" className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">New password</span>
        <input
          name="next"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className={input}
        />
      </label>
      <Notice state={state} />
      <p className="text-xs text-muted">
        Changing your password signs you out of all devices.
      </p>
      <Submit label="Change password" />
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState<SettingsState, FormData>(deleteAccountAction, {});
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/40 px-4 py-2 text-sm font-semibold text-rose-500 transition hover:bg-rose-500/10"
      >
        <AlertTriangle className="size-4" /> Delete account
      </button>
    );
  }

  return (
    <form action={action} className="space-y-3">
      <p className="text-sm text-muted">
        This permanently deletes your account and <strong className="text-foreground">all
        projects, research, plans, and reminders</strong>. This cannot be undone.
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">Password</span>
        <input name="password" type="password" required className={input} />
      </label>
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-muted">
          Type <code className="text-foreground">DELETE</code> to confirm
        </span>
        <input name="confirm" required placeholder="DELETE" className={input} />
      </label>
      <Notice state={state} />
      <div className="flex items-center gap-2">
        <Submit label="Permanently delete" danger />
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted transition hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
