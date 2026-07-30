import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, Sparkles } from "lucide-react";
import { ResetPasswordForm } from "@/components/ResetForms";
import { getCurrentUser } from "@/lib/auth/session";
import { peekPasswordResetToken } from "@/lib/db/users";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");

  const token = (await searchParams).token ?? "";
  // Validate before rendering the form so expired links fail early and clearly.
  const valid = token ? !!await peekPasswordResetToken(token) : false;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 text-lg font-bold">
          <Sparkles className="size-5 text-brand" />
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            IdeaForge
          </span>
        </div>
        <h1 className="text-2xl font-bold">Choose a new password</h1>
      </div>

      {valid ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/5 p-6 text-center">
          <span className="mx-auto mb-3 flex size-11 items-center justify-center rounded-full bg-rose-500/10 text-rose-500">
            <AlertTriangle className="size-5" />
          </span>
          <p className="font-semibold">This link is invalid or has expired</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Reset links are single-use and last one hour.
          </p>
          <Link
            href="/forgot-password"
            className="mt-4 inline-block rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
          >
            Request a new link
          </Link>
        </div>
      )}

      <p className="mt-4 text-center text-sm text-muted">
        <Link href="/sign-in" className="font-medium text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
