import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Wand2 } from "lucide-react";
import PromptStudio, { RunItNext } from "@/components/PromptStudio";
import { getCurrentUser } from "@/lib/auth/session";
import { publicUrl } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const url = await publicUrl("/prompts");
  const description =
    "Turn one rough line into several runnable prompts, each with a forecast of what it would cost to run — and advice on which to spend first.";
  return {
    title: "Prompt studio — Scrutan",
    description,
    alternates: { canonical: url },
    openGraph: { title: "Prompt studio", description, url, siteName: "Scrutan" },
  };
}

/**
 * The step before asking.
 *
 * Most bad AI answers are bad because the question was vague, and the cost of
 * finding that out is a whole run. This shows what three sharper versions of
 * the question would look like, and what each would cost, before any of them is
 * spent.
 */
export default async function PromptsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/sign-in?next=/prompts");

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-10">
      <h1 className="mb-1 flex items-center gap-2 text-2xl font-bold">
        <Wand2 className="size-6 text-brand" />
        Prompt studio
      </h1>
      <p className="mb-6 max-w-prose text-sm text-muted">
        Most disappointing AI answers are answers to a vague question. Give one rough line and
        this drafts several sharper versions of it from different angles — each one
        self-contained, each with what it would cost to run, so you can spend the expensive
        one deliberately rather than by accident.
      </p>

      <PromptStudio />
      <RunItNext />
    </main>
  );
}
