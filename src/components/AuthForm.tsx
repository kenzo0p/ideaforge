"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2, Sparkles } from "lucide-react";
import { signInAction, signUpAction, type AuthState } from "@/lib/auth/actions";
import ResendVerification from "@/components/ResendVerification";

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50"
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {label}
    </button>
  );
}

export default function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const isSignUp = mode === "sign-up";
  const action = isSignUp ? signUpAction : signInAction;
  const [state, formAction] = useActionState<AuthState, FormData>(action, {});

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 text-lg font-bold">
          <Sparkles className="size-5 text-brand" />
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            IdeaForge
          </span>
        </div>
        <h1 className="text-2xl font-bold">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-sm text-muted">
          {isSignUp ? "Save projects and access them anywhere." : "Sign in to your projects."}
        </p>
      </div>

      <form action={formAction} className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
        {isSignUp && (
          <Field label="Name (optional)">
            <input name="name" autoComplete="name" className={inputCls} placeholder="Ada Lovelace" />
          </Field>
        )}
        <Field label="Email">
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className={inputCls}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password">
          <input
            name="password"
            type="password"
            required
            minLength={8}
            autoComplete={isSignUp ? "new-password" : "current-password"}
            className={inputCls}
            placeholder={isSignUp ? "At least 8 characters" : "••••••••"}
          />
        </Field>

        {state.error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-500">
            {state.error}
            {state.needsVerification && state.email && (
              <div className="mt-1.5 text-foreground/80">
                <ResendVerification email={state.email} />
              </div>
            )}
          </div>
        )}

        <SubmitButton label={isSignUp ? "Create account" : "Sign in"} />
      </form>

      <p className="mt-4 text-center text-sm text-muted">
        {isSignUp ? "Already have an account? " : "New to IdeaForge? "}
        <Link
          href={isSignUp ? "/sign-in" : "/sign-up"}
          className="font-medium text-brand hover:underline"
        >
          {isSignUp ? "Sign in" : "Create one"}
        </Link>
      </p>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-brand/60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
