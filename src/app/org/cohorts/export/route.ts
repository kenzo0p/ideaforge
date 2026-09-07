import { getCurrentUser } from "@/lib/auth/session";
import { membershipFor } from "@/lib/db/orgs";
import { cohortReport } from "@/lib/db/cohorts";
import { toCsv } from "@/lib/cohorts/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The cohort report as a spreadsheet.
 *
 * Mentor-or-owner only, and scoped to the caller's own workspace — the batch
 * name comes from the query string but the organisation never does, so no
 * amount of guessing at a URL reaches another institution's submissions.
 */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const membership = await membershipFor(user.id);
  if (!membership || membership.role === "member") {
    return new Response("Only a workspace owner or mentor can export a cohort.", { status: 403 });
  }

  const batch = new URL(req.url).searchParams.get("batch")?.trim();
  if (!batch) return new Response("Name the batch to export.", { status: 400 });

  const report = await cohortReport({ orgId: membership.org.id, batch });
  if (report.submissions.length === 0) {
    return new Response("That batch is empty.", { status: 404 });
  }

  const byId = new Map(report.submissions.map((s) => [s.id, s]));
  const rows: Array<Array<string | number | null>> = [
    ["Student", "Reference", "Title", "Distinctiveness %", "Resembles", "Group", "Idea"],
  ];

  // Least distinctive first, matching the on-screen order: whoever opens this
  // is looking for the same thing in both places.
  const groupOf = new Map<string, number>();
  report.groups.forEach((g, i) => g.ids.forEach((id) => groupOf.set(id, i + 1)));

  for (const s of [...report.submissions].sort((a, b) => a.novelty - b.novelty)) {
    rows.push([
      s.studentName,
      s.studentRef,
      s.title,
      Math.round(s.novelty * 100),
      s.resembles.map((id) => byId.get(id)?.studentName ?? "?").join("; "),
      groupOf.get(s.id) ?? "",
      s.idea,
    ]);
  }

  const safeName = batch.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 60) || "cohort";
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="scrutan-${safeName}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
