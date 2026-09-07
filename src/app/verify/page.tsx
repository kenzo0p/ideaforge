import Link from "next/link";
import type { Metadata } from "next";
import { ScanSearch } from "lucide-react";
import ExternalVerifier from "@/components/ExternalVerifier";
import { publicUrl } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const url = await publicUrl("/verify");
  const description =
    "Paste any AI research answer and its sources. Scrutan opens every URL, checks each sentence against the source it cited, and tells you how many independent sources are really behind it.";
  return {
    title: "Check an AI answer — Scrutan",
    description,
    alternates: { canonical: url },
    openGraph: { title: "Check an AI answer", description, url, siteName: "Scrutan" },
  };
}

/**
 * The verification engine, pointed at anybody's output.
 *
 * Public and unauthenticated on purpose. The check is the most persuasive thing
 * this product does, and it was previously only visible to people who had
 * already signed up — which is the wrong way round for the one feature nobody
 * else has.
 */
export default function VerifyPage() {
  return (
    <main className="mx-auto w-full max-w-4xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <ScanSearch className="size-6 text-brand" />
        Check an AI answer
      </h1>
      <p className="mb-6 max-w-prose text-sm text-muted">
        Any tool will give you research with citations. Almost none of them check their own.
        Paste an answer from ChatGPT, Perplexity, Gemini — or anywhere else — and Scrutan will
        open every source, find the passage that backs each sentence, and tell you when there
        isn&apos;t one.
      </p>

      <ExternalVerifier />

      <section className="mt-10 rounded-2xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">What this actually does</h2>
        <ul className="mt-2 space-y-1.5 text-xs text-muted">
          <li>
            <strong className="text-foreground">Opens every URL.</strong> A citation that does
            not resolve is not evidence, whatever it looked like in the answer.
          </li>
          <li>
            <strong className="text-foreground">Reads them.</strong> Each sentence is matched
            against passages from the source it cited, and the matching passage is shown so
            you can check the check.
          </li>
          <li>
            <strong className="text-foreground">Counts the real sources.</strong> Six
            citations tracing to one press release are one source, not six.
          </li>
          <li>
            <strong className="text-foreground">Says what it cannot tell you.</strong> Where
            the evidence is ambiguous it says so rather than guessing —{" "}
            <Link href="/quality" className="underline hover:text-foreground">
              here is how that is measured
            </Link>
            .
          </li>
        </ul>
        <p className="mt-3 text-[11px] text-muted">
          Nothing you paste is stored. Sources are fetched from this server, so pages behind a
          login or a paywall will read as unreachable — that is a limit of the check, not a
          verdict on the source.
        </p>
      </section>
    </main>
  );
}
