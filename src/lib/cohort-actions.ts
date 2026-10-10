"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/session";
import { membershipFor } from "@/lib/db/orgs";
import { parseSubmissions } from "@/lib/cohorts/parse";
import {
  cohortReport,
  deleteBatch,
  importCohort,
  listBatches,
  type BatchSummary,
  type CohortReport,
} from "@/lib/db/cohorts";

// ---------------------------------------------------------------------------
// Cohort actions.
//
// Every one of these is mentor-or-owner only, and the check is the first thing
// each does. A cohort report names people alongside their unsubmitted ideas and
// says which of them resemble each other: reasonable for a guide to see across
// their own cohort, and not something a student in the same workspace should be
// handed about their classmates.
// ---------------------------------------------------------------------------

/** Most rows accepted in one import. Beyond this the comparison is O(n²) slow. */
const MAX_ROWS = 400;

async function mentorOrg(): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const membership = await membershipFor(user.id);
  if (!membership || membership.role === "member") return null;
  return membership.org.id;
}

export interface ImportResult {
  imported?: number;
  failed?: number;
  skipped?: Array<{ line: number; why: string }>;
  columns?: Record<string, string>;
  error?: string;
}

export async function importCohortAction(batch: string, sheet: string): Promise<ImportResult> {
  const orgId = await mentorOrg();
  if (!orgId) return { error: "Only a workspace owner or mentor can import a cohort." };

  const label = batch.trim().slice(0, 60);
  if (!label) return { error: "Give the batch a name — a year, a section, anything you'll recognise." };
  if (!sheet.trim()) return { error: "Paste the submissions, including their header row." };

  const parsed = parseSubmissions(sheet);
  if (parsed.rows.length === 0) {
    return {
      error:
        parsed.skipped[0]?.why ??
        "No usable rows. The sheet needs a header row and a column of idea text.",
      skipped: parsed.skipped,
    };
  }
  if (parsed.rows.length > MAX_ROWS) {
    return { error: `That is ${parsed.rows.length} rows; ${MAX_ROWS} is the most one batch can hold.` };
  }

  const outcome = await importCohort({ orgId, batch: label, rows: parsed.rows });
  revalidatePath("/org/cohorts");
  return { ...outcome, skipped: parsed.skipped, columns: parsed.columns };
}

export async function listBatchesAction(): Promise<BatchSummary[]> {
  const orgId = await mentorOrg();
  return orgId ? listBatches(orgId) : [];
}

export async function cohortReportAction(batch: string): Promise<CohortReport | null> {
  const orgId = await mentorOrg();
  if (!orgId) return null;
  return cohortReport({ orgId, batch });
}

export async function deleteBatchAction(batch: string): Promise<{ deleted: number } | { error: string }> {
  const orgId = await mentorOrg();
  if (!orgId) return { error: "Only a workspace owner or mentor can delete a batch." };
  const deleted = await deleteBatch(orgId, batch);
  revalidatePath("/org/cohorts");
  return { deleted };
}
