import Link from "next/link";
import { Lock } from "lucide-react";

// Shown in place of the idea console when the visitor isn't signed in. The
// copilot's API routes are independently protected — this is the UX layer.
export default function SignInGate() {
  return (
    <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
      <div className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-brand/10">
        <Lock className="size-5 text-brand" />
      </div>
      <h2 className="text-lg font-semibold">Sign in to start forging</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
        Create a free account to validate ideas, run DeepSearch, generate build plans, and save
        your projects.
      </p>
      <div className="mt-5 flex items-center justify-center gap-2">
        <Link
          href="/sign-up"
          className="rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand shadow-sm transition hover:opacity-90"
        >
          Create account
        </Link>
        <Link
          href="/sign-in"
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:border-brand/50"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
