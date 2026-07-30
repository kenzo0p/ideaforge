import Link from "next/link";
import { MailCheck } from "lucide-react";
import { getMailer } from "@/lib/email";
import ResendVerification from "@/components/ResendVerification";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; dev?: string }>;
}) {
  const { email, dev } = await searchParams;
  // `dev` is present only when no real email went out (console mailer, or a real
  // send that failed — e.g. Resend test-mode recipient restriction).
  const showDevLink = !!dev;
  const isConsole = getMailer().isConsole;

  return (
    <div className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-md flex-col justify-center px-5 py-12 text-center">
      <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-brand/10">
        <MailCheck className="size-6 text-brand" />
      </div>
      <h1 className="text-2xl font-bold">Check your inbox</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
        We sent a verification link{email ? <> to <strong className="text-foreground">{email}</strong></> : null}.
        Click it to activate your account. The link expires in 24 hours.
      </p>

      {showDevLink && (
        <div className="mt-5 rounded-xl border border-warning/40 bg-warning/10 p-4 text-left text-sm">
          <p className="mb-2 font-semibold text-warning dark:text-warning">
            {isConsole
              ? "Dev mode — no email provider configured"
              : "Email couldn't be delivered to this address"}
          </p>
          <p className="mb-3 text-muted">
            {isConsole
              ? "Use this link to verify (in production this is emailed, never shown):"
              : "Your Resend account is likely in test mode (verify a domain to email anyone). Use this fallback link to verify:"}
          </p>
          <a
            href={`/api/verify-email?token=${dev}`}
            className="inline-block rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
          >
            Verify my email →
          </a>
        </div>
      )}

      <div className="mt-6 text-sm text-muted">
        Didn&apos;t get it?{" "}
        {email ? <ResendVerification email={email} /> : <span>Try signing up again.</span>}
      </div>

      <p className="mt-6 text-sm">
        <Link href="/sign-in" className="text-brand hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
