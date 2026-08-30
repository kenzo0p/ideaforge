import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { ForgotPasswordForm } from "@/components/ResetForms";
import { getCurrentUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-sm flex-col justify-center px-5 py-12">
      <div className="mb-6 text-center">
        <div className="mb-3 inline-flex items-center gap-2 text-lg font-bold">
          <Sparkles className="size-5 text-brand" />
          <span className="bg-gradient-to-r from-brand to-brand-2 bg-clip-text text-transparent">
            Scrutan
          </span>
        </div>
        <h1 className="text-2xl font-bold">Forgot your password?</h1>
        <p className="mt-1 text-sm text-muted">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="mt-4 text-center text-sm text-muted">
        Remembered it?{" "}
        <Link href="/sign-in" className="font-medium text-brand hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
