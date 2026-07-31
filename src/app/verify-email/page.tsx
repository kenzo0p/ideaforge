import Link from "next/link";
import { MailCheck } from "lucide-react";
import { getMailer } from "@/lib/email";
import ResendVerification from "@/components/ResendVerification";

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; dev?: string; undelivered?: string }>;
}) {
  const { email, dev, undelivered } = await searchParams;
  // `dev` carries the token, and is set only where surfacing it is safe: the
  // console mailer, or an explicit SHOW_VERIFICATION_FALLBACK opt-in.
  // `undelivered` reports a failed send *without* handing over the token.
  const showDevLink = !!dev;
  const mailer = getMailer();
  const isConsole = mailer.isConsole;
  // Which backend is actually live — "console" | "resend" | "smtp". Shown on the
  // failure banner so a misconfiguration points at the right variables.
  const mailerId = mailer.id;

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
              : "Delivery to this address was rejected. The fallback link is only shown because SHOW_VERIFICATION_FALLBACK is enabled — turn it off outside a demo."}
          </p>
          <a
            href={`/api/verify-email?token=${dev}`}
            className="inline-block rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-on-brand transition hover:opacity-90"
          >
            Verify my email →
          </a>
        </div>
      )}

      {undelivered && (
        <div className="mt-5 rounded-xl border border-danger/40 bg-danger/10 p-4 text-left text-sm">
          <p className="mb-2 font-semibold text-danger">
            Couldn&apos;t send to this address (via {mailerId})
          </p>
          {/* Name the provider that actually failed. A hardcoded one sends the
              operator chasing the wrong configuration. */}
          <p className="text-muted">
            {mailerId === "resend" ? (
              <>
                A Resend account with no verified domain can only deliver to the address that owns
                the account. To email anyone else, either verify a domain and set{" "}
                <code className="rounded bg-surface px-1">EMAIL_FROM</code> to an address on it, or
                set <code className="rounded bg-surface px-1">SMTP_HOST</code> and the{" "}
                <code className="rounded bg-surface px-1">SMTP_*</code> credentials to send through
                Gmail or Brevo instead.
              </>
            ) : (
              <>
                The SMTP server rejected the message. Check{" "}
                <code className="rounded bg-surface px-1">SMTP_USER</code> and{" "}
                <code className="rounded bg-surface px-1">SMTP_PASSWORD</code> — Gmail requires a
                16-character App Password, not your account password — and make sure{" "}
                <code className="rounded bg-surface px-1">EMAIL_FROM</code> matches the
                authenticated sender.
              </>
            )}
          </p>
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
