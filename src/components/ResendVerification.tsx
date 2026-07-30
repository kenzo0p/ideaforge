"use client";

import { useState, useTransition } from "react";
import { resendVerificationAction } from "@/lib/auth/actions";

// Small inline "resend verification email" control.
export default function ResendVerification({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();
  const [sent, setSent] = useState(false);

  if (sent) return <span className="text-success">Sent — check your inbox.</span>;

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await resendVerificationAction(email);
          setSent(true);
        })
      }
      disabled={pending}
      className="font-medium text-brand hover:underline disabled:opacity-50"
    >
      {pending ? "Sending…" : "Resend email"}
    </button>
  );
}
