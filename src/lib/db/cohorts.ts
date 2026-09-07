import { randomUUID } from "node:crypto";
import { col } from "./index";
import { clusterVectors, DUPLICATE_THRESHOLD } from "./similar";
import { getEmbedder } from "@/lib/similarity";
import type { SubmissionRow } from "@/lib/cohorts/parse";

// ---------------------------------------------------------------------------
// A cohort's submissions, as a corpus in their own right.
//
// The workspace overlap view compares projects that people created here. The
// question a department head actually has arrives before any of that: sixty
// proposals in a spreadsheet, due Friday, and no way to know how many are the
// same project. Requiring all sixty students to sign up first is how a useful
// tool never gets used.
//
// So submissions are their own record rather than synthetic users with
// synthetic projects. They have no owner, no session, no plan; they exist to be
// compared, exported and deleted as a batch. Keeping them out of `projects`
// keeps every access rule on that collection honest — nothing here is a project
// somebody can open, edit or share by accident.
// ---------------------------------------------------------------------------

export interface CohortSubmission {
  id: string;
  orgId: string;
  /** Free-text batch label — "2026 Final Year", "CS-B", whatever they call it. */
  batch: string;
  studentName: string;
  studentRef: string | null;
  title: string;
  idea: string;
  createdAt: number;
}

interface SubmissionDoc extends Omit<CohortSubmission, "id"> {
  _id: string;
  model: string;
  dimensions: number;
  vector: number[];
}

const submissions = () => col<SubmissionDoc>("cohortSubmissions");

function representativeText(title: string, idea: string): string {
  return `${title}. ${idea}`.trim();
}

export interface ImportOutcome {
  imported: number;
  /** Rows whose vector could not be produced; they are not stored. */
  failed: number;
}

/**
 * Store a batch, embedding as we go.
 *
 * Replaces the batch rather than appending. Re-importing a corrected sheet is
 * the common case, and an append would leave the corrected rows sitting beside
 * the originals — every fix producing a fresh pile of false duplicates.
 */
export async function importCohort(input: {
  orgId: string;
  batch: string;
  rows: SubmissionRow[];
}): Promise<ImportOutcome> {
  const embedder = getEmbedder();
  const now = Date.now();
  const docs: SubmissionDoc[] = [];
  let failed = 0;

  for (const row of input.rows) {
    try {
      const text = representativeText(row.title, row.idea);
      docs.push({
        _id: randomUUID(),
        orgId: input.orgId,
        batch: input.batch,
        studentName: row.studentName,
        studentRef: row.studentRef,
        title: row.title,
        idea: row.idea,
        createdAt: now,
        model: embedder.id,
        dimensions: embedder.dimensions,
        vector: await embedder.embed(text),
      });
    } catch {
      // One unembeddable row must not cost the other fifty-nine.
      failed++;
    }
  }

  const c = await submissions();
  await c.deleteMany({ orgId: input.orgId, batch: input.batch });
  if (docs.length > 0) await c.insertMany(docs);
  return { imported: docs.length, failed };
}

export interface BatchSummary {
  batch: string;
  count: number;
  importedAt: number;
}

export async function listBatches(orgId: string): Promise<BatchSummary[]> {
  const rows = await (await submissions())
    .aggregate<{ _id: string; count: number; importedAt: number }>([
      { $match: { orgId } },
      { $group: { _id: "$batch", count: { $sum: 1 }, importedAt: { $max: "$createdAt" } } },
      { $sort: { importedAt: -1 } },
    ])
    .toArray();
  return rows.map((r) => ({ batch: r._id, count: r.count, importedAt: r.importedAt }));
}

export async function deleteBatch(orgId: string, batch: string): Promise<number> {
  const res = await (await submissions()).deleteMany({ orgId, batch });
  return res.deletedCount ?? 0;
}

/** Everything stored for a batch, without the vectors. */
export async function listSubmissions(orgId: string, batch: string): Promise<CohortSubmission[]> {
  const docs = await (await submissions())
    .find({ orgId, batch }, { projection: { vector: 0 } })
    .sort({ studentName: 1 })
    .toArray();
  return docs.map(({ _id, model, dimensions, ...rest }) => {
    void model;
    void dimensions;
    return { id: _id, ...rest } as CohortSubmission;
  });
}

export interface SubmissionNovelty extends CohortSubmission {
  /**
   * 1 minus the highest similarity to any other submission in the batch.
   *
   * Reported per student because that is the unit a supervisor acts on. A low
   * score is not an accusation — it says this proposal has a near neighbour in
   * the same batch and the two are worth reading together.
   */
  novelty: number;
  /** Ids of the submissions it most resembles, if any crossed the threshold. */
  resembles: string[];
}

export interface CohortReport {
  batch: string;
  submissions: SubmissionNovelty[];
  /** Groups of two or more lookalikes, tightest first. */
  groups: Array<{ ids: string[]; peak: number }>;
  /** How many submissions fall in some group. */
  clustered: number;
  model: string;
  generatedAt: number;
}

/**
 * Compare every submission in a batch against every other.
 *
 * Uses the same clustering as the workspace view, at the same threshold, so a
 * department cannot get one answer here and a different one there.
 */
export async function cohortReport(input: {
  orgId: string;
  batch: string;
  threshold?: number;
}): Promise<CohortReport> {
  const embedder = getEmbedder();
  const docs = await (await submissions())
    .find({ orgId: input.orgId, batch: input.batch, model: embedder.id })
    .sort({ studentName: 1 })
    .toArray();

  const base = {
    batch: input.batch,
    model: embedder.id,
    generatedAt: Date.now(),
  };

  if (docs.length < 2) {
    return {
      ...base,
      submissions: docs.map((d) => ({
        ...toSubmission(d),
        novelty: 1,
        resembles: [],
      })),
      groups: [],
      clustered: 0,
    };
  }

  const { groups, closest, peaks } = clusterVectors(docs, input.threshold ?? DUPLICATE_THRESHOLD);

  const groupOf = new Map<number, number>();
  for (const [g, idxs] of groups.entries()) for (const i of idxs) groupOf.set(i, g);

  const submissionsOut: SubmissionNovelty[] = docs.map((d, i) => {
    const g = groupOf.get(i);
    return {
      ...toSubmission(d),
      novelty: Number((1 - closest[i]).toFixed(3)),
      resembles:
        g === undefined ? [] : groups[g].filter((j) => j !== i).map((j) => docs[j]._id),
    };
  });

  return {
    ...base,
    submissions: submissionsOut,
    groups: groups.map((idxs, g) => ({ ids: idxs.map((i) => docs[i]._id), peak: peaks[g] })),
    clustered: groups.flat().length,
  };
}

function toSubmission(d: SubmissionDoc): CohortSubmission {
  return {
    id: d._id,
    orgId: d.orgId,
    batch: d.batch,
    studentName: d.studentName,
    studentRef: d.studentRef,
    title: d.title,
    idea: d.idea,
    createdAt: d.createdAt,
  };
}

/** Remove a whole workspace's submissions — used when an org is deleted. */
export async function purgeOrgCohorts(orgId: string): Promise<void> {
  await (await submissions()).deleteMany({ orgId });
}
