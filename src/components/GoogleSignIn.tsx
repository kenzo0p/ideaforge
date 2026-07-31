"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Google's mark, inlined so it renders without an external request (CSP-safe). */
function GoogleMark() {
  return (
    <svg viewBox="0 0 18 18" className="size-4 shrink-0" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"
      />
    </svg>
  );
}

/**
 * Google sign-in. Runs the Firebase popup, then trades the resulting ID token
 * for one of our own session cookies at /api/auth/google.
 *
 * The Firebase SDK is imported lazily so its bundle only loads when someone
 * actually clicks — it is large, and most visitors never use it.
 */
export default function GoogleSignIn({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onClick() {
    setBusy(true);
    setError(null);
    try {
      const { signInWithGoogle } = await import("@/lib/firebase/client");
      const idToken = await signInWithGoogle();

      const res = await fetch("/api/auth/google", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Sign-in failed.");
      }

      // The session cookie is set; refresh so server components see it.
      router.replace("/dashboard");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Sign-in failed.";
      // Closing the popup is a normal thing to do, not an error worth shouting.
      if (/popup-closed-by-user|cancelled-popup-request|popup_closed/i.test(message)) {
        setError(null);
      } else if (/popup-blocked/i.test(message)) {
        setError("Your browser blocked the popup. Allow popups for this site and try again.");
      } else if (/auth\/unauthorized-domain/i.test(message)) {
        setError("This domain isn't authorised in Firebase → Authentication → Settings.");
      } else {
        setError(message);
      }
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg border border-border-strong bg-card px-4 py-2.5 text-sm font-semibold transition hover:bg-hover disabled:opacity-50"
      >
        <GoogleMark />
        {busy ? "Opening Google…" : `Continue with Google`}
      </button>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-border" />
        or {mode === "sign-up" ? "sign up" : "sign in"} with email
        <span className="h-px flex-1 bg-border" />
      </div>
    </div>
  );
}
