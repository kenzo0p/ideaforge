import { col } from "./index";
import { cosine, getEmbedder } from "@/lib/similarity";

// ---------------------------------------------------------------------------
// Finding ideas that already exist.
//
// The question this answers is one no general AI tool can: "has someone in
// *this department* already done this?" ChatGPT cannot know, because the
// corpus is yours. Every year guides approve near-identical final-year
// projects because nobody can see across batches, and this is the piece that
// makes that visible before the work starts rather than at the viva.
//
// Vectors live in their own collection rather than on the project. A project
// document is read on every page load; 384 floats attached to it would make
// the common read pay for a feature used at submission time.
//
// Similarity is computed in the application rather than by a vector index. A
// department is hundreds of ideas, not millions — a linear scan over a few
// thousand short vectors is well under a millisecond, and it keeps the system
// runnable on a free database tier with no special index type.
// ---------------------------------------------------------------------------

export interface IdeaVector {
  projectId: string;
  userId: string;
  /** Which embedder produced this, so a model change can be detected. */
  model: string;
  dimensions: number;
  vector: number[];
  /** The text that was embedded, for explaining a match. */
  text: string;
  updatedAt: number;
}

interface VectorDoc extends IdeaVector {
  _id: string; // projectId — exactly one vector per project
}

const vectors = () => col<VectorDoc>("ideaVectors");

/** Text used to represent a project. Title adds little; the idea carries it. */
function representativeText(title: string, idea: string): string {
  return `${title}. ${idea}`.trim();
}

/**
 * Compute and store the vector for a project.
 *
 * Never throws: an embedding failure must not break saving a project. The
 * feature degrades to "no similar ideas found", which is a far smaller harm
 * than losing someone's work.
 */
export async function indexProject(input: {
  projectId: string;
  userId: string;
  title: string;
  idea: string;
}): Promise<boolean> {
  try {
    const embedder = getEmbedder();
    const text = representativeText(input.title, input.idea);
    const vector = await embedder.embed(text);

    await (await vectors()).replaceOne(
      { _id: input.projectId },
      {
        projectId: input.projectId,
        userId: input.userId,
        model: embedder.id,
        dimensions: embedder.dimensions,
        vector,
        text,
        updatedAt: Date.now(),
      },
      { upsert: true },
    );
    return true;
  } catch (err) {
    console.error("Idea indexing failed:", err instanceof Error ? err.message : err);
    return false;
  }
}

export async function removeFromIndex(projectId: string): Promise<void> {
  await (await vectors()).deleteMany({ projectId });
}

export interface SimilarIdea {
  projectId: string;
  userId: string;
  title: string;
  idea: string;
  /** Cosine similarity in [0, 1]. */
  score: number;
  createdAt: number;
  /** Set when the owner is someone else in the workspace. */
  ownerName: string | null;
  ownerUsername: string | null;
}

/**
 * Similarity above which two ideas are worth showing as related.
 *
 * Set from measurement, not taste. Across paraphrase and unrelated idea pairs
 * the neural embedder scored paraphrases no lower than 0.483 and unrelated
 * pairs no higher than 0.363; 0.45 sits in that gap with margin on both sides.
 *
 * Ideas in the same domain but not duplicates land between 0.37 and 0.69, so
 * the upper part of that band is included deliberately — "someone is solving a
 * nearby problem" is worth reading before you start.
 */
export const SIMILARITY_THRESHOLD = Number(process.env.SIMILARITY_THRESHOLD ?? 0.45);

/**
 * Ideas in the same workspace that resemble this one.
 *
 * Scoped to `userIds` by the caller — never the whole database. A student's
 * unrelated project is not something another institution gets to read, and
 * scoping is the mechanism that guarantees it rather than a filter someone
 * might forget.
 */
export async function findSimilarIdeas(input: {
  text: string;
  userIds: string[];
  excludeProjectId?: string;
  limit?: number;
  threshold?: number;
}): Promise<SimilarIdea[]> {
  if (input.userIds.length === 0) return [];

  const embedder = getEmbedder();
  const query = await embedder.embed(input.text);
  const threshold = input.threshold ?? SIMILARITY_THRESHOLD;

  // Only vectors from the same model are comparable. A mixed corpus after a
  // model switch would otherwise produce confident nonsense.
  const candidates = await (await vectors())
    .find({ userId: { $in: input.userIds }, model: embedder.id })
    .toArray();

  const scored = candidates
    .filter((c) => c.projectId !== input.excludeProjectId)
    .map((c) => ({ doc: c, score: cosine(query, c.vector) }))
    .filter((s) => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, input.limit ?? 5);

  if (scored.length === 0) return [];

  // One lookup for the metadata the UI shows, rather than one per hit.
  const projects = await (await col<{
    _id: string;
    title: string;
    idea: string;
    userId: string;
    createdAt: number;
  }>("projects"))
    .find(
      { _id: { $in: scored.map((s) => s.doc.projectId) } },
      { projection: { title: 1, idea: 1, userId: 1, createdAt: 1 } },
    )
    .toArray();

  const owners = await (await col<{ _id: string; name?: string | null; username?: string }>("users"))
    .find(
      { _id: { $in: [...new Set(projects.map((p) => p.userId))] } },
      { projection: { name: 1, username: 1 } },
    )
    .toArray();

  const projectById = new Map(projects.map((p) => [p._id, p]));
  const ownerById = new Map(owners.map((o) => [o._id, o]));

  return scored.flatMap((s) => {
    const p = projectById.get(s.doc.projectId);
    // A vector whose project has been deleted is stale; skip rather than
    // showing a dangling result.
    if (!p) return [];
    const owner = ownerById.get(p.userId);
    return [{
      projectId: p._id,
      userId: p.userId,
      title: p.title,
      idea: p.idea,
      score: s.score,
      createdAt: p.createdAt,
      ownerName: owner?.name ?? null,
      ownerUsername: owner?.username ?? null,
    }];
  });
}

// ---------------------------------------------------------------------------
// Cohort novelty.
//
// The student-facing question is "has this been done before?". The question a
// department head actually has is the plural of it: *how many of these sixty
// submissions are the same project?* — and nobody can answer it today, because
// answering it means reading sixty proposals and remembering all of them at
// once.
//
// This is the same vectors, read the other way round: instead of one idea
// against the corpus, every idea against every other, grouped into clusters of
// things that look alike.
// ---------------------------------------------------------------------------

/**
 * Similarity above which two ideas are worth a human comparing them.
 *
 * Higher than SIMILARITY_THRESHOLD, and for a different reason. That one asks
 * "is this related enough to be worth reading?", where a false positive costs
 * someone ten seconds. This one asks "should a guide look at whether these are
 * the same project?", where a false positive costs a student an accusation.
 *
 * From the measured ranges: paraphrases scored 0.483–0.897 and same-domain
 * non-duplicates 0.37–0.69. The bands overlap, so there is no threshold that
 * separates them and no honest way to pretend otherwise. 0.70 sits above almost
 * all of the same-domain band, which makes it a good place to ask the question
 * — not a place to answer it. Nothing here is labelled a duplicate.
 */
export const DUPLICATE_THRESHOLD = Number(process.env.DUPLICATE_THRESHOLD ?? 0.7);

/**
 * Most vectors compared in one pass.
 *
 * The comparison is O(n²): 500 ideas is 125,000 dot products over 384 floats,
 * which is milliseconds, and 5,000 would be a hundred times that on a request
 * a mentor is waiting for. Truncation is reported rather than hidden, because
 * a cohort report that silently ignored half the cohort would be worse than no
 * report.
 */
const MAX_CORPUS = 500;

/** One idea inside a cluster of lookalikes. */
export interface ClusterMember {
  projectId: string;
  userId: string;
  title: string;
  idea: string;
  createdAt: number;
  ownerName: string | null;
  ownerUsername: string | null;
  /** Highest similarity to any other member of this cluster. */
  closest: number;
}

export interface IdeaCluster {
  /** Derived from the member ids, so the same cluster keeps its key across loads. */
  id: string;
  members: ClusterMember[];
  /** The highest pairwise similarity anywhere in the cluster. */
  peak: number;
}

export interface CohortNovelty {
  clusters: IdeaCluster[];
  /** Ideas compared. */
  indexed: number;
  /** Ideas that landed in some cluster. */
  clustered: number;
  /** Which embedder produced the vectors — a degraded model must be visible. */
  model: string;
  /** True when the workspace has more ideas than one pass compares. */
  truncated: boolean;
}

/**
 * Group a workspace's ideas into clusters of lookalikes.
 *
 * Connected components, not nearest-neighbour pairs: if A resembles B and B
 * resembles C, all three belong in front of the same person even when A and C
 * do not directly cross the threshold. Three students converging on one idea
 * from different wordings is exactly the case worth catching, and pairwise
 * reporting would show it as two unrelated warnings.
 */
export async function clusterWorkspaceIdeas(input: {
  userIds: string[];
  threshold?: number;
}): Promise<CohortNovelty> {
  const embedder = getEmbedder();
  const threshold = input.threshold ?? DUPLICATE_THRESHOLD;
  const empty: CohortNovelty = {
    clusters: [],
    indexed: 0,
    clustered: 0,
    model: embedder.id,
    truncated: false,
  };
  if (input.userIds.length === 0) return empty;

  const total = await (await vectors()).countDocuments({
    userId: { $in: input.userIds },
    model: embedder.id,
  });

  const docs = await (await vectors())
    .find({ userId: { $in: input.userIds }, model: embedder.id })
    .sort({ updatedAt: -1 })
    .limit(MAX_CORPUS)
    .toArray();

  if (docs.length < 2) return { ...empty, indexed: docs.length, truncated: total > docs.length };

  // Union-find over the pairs that cross the threshold.
  const parent = docs.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };

  // Highest similarity each idea has to anything it was grouped with.
  const closest = new Array<number>(docs.length).fill(0);
  let peakOf = new Map<number, number>();

  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const score = cosine(docs[i].vector, docs[j].vector);
      if (score < threshold) continue;
      union(i, j);
      closest[i] = Math.max(closest[i], score);
      closest[j] = Math.max(closest[j], score);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < docs.length; i++) {
    if (closest[i] === 0) continue; // in no pair, so in no cluster
    const root = find(i);
    const g = groups.get(root) ?? [];
    g.push(i);
    groups.set(root, g);
  }

  peakOf = new Map(
    [...groups].map(([root, idxs]) => [root, Math.max(...idxs.map((i) => closest[i]))]),
  );

  const memberIndices = [...groups.values()].flat();
  if (memberIndices.length === 0) {
    return { ...empty, indexed: docs.length, truncated: total > docs.length };
  }

  // One lookup each for the project and owner metadata the table shows.
  const ids = memberIndices.map((i) => docs[i].projectId);
  const projects = await (await col<{
    _id: string;
    title: string;
    idea: string;
    userId: string;
    createdAt: number;
  }>("projects"))
    .find({ _id: { $in: ids } }, { projection: { title: 1, idea: 1, userId: 1, createdAt: 1 } })
    .toArray();

  const owners = await (await col<{ _id: string; name?: string | null; username?: string }>("users"))
    .find(
      { _id: { $in: [...new Set(projects.map((p) => p.userId))] } },
      { projection: { name: 1, username: 1 } },
    )
    .toArray();

  const projectById = new Map(projects.map((p) => [p._id, p]));
  const ownerById = new Map(owners.map((o) => [o._id, o]));

  const clusters: IdeaCluster[] = [];
  for (const [root, idxs] of groups) {
    const members = idxs.flatMap<ClusterMember>((i) => {
      const p = projectById.get(docs[i].projectId);
      // A vector whose project is gone is stale, not a finding.
      if (!p) return [];
      const owner = ownerById.get(p.userId);
      return [{
        projectId: p._id,
        userId: p.userId,
        title: p.title,
        idea: p.idea,
        createdAt: p.createdAt,
        ownerName: owner?.name ?? null,
        ownerUsername: owner?.username ?? null,
        closest: Number(closest[i].toFixed(3)),
      }];
    });

    // A "cluster" of one is what is left when the other side was deleted.
    if (members.length < 2) continue;
    members.sort((a, b) => a.createdAt - b.createdAt);
    clusters.push({
      id: members.map((m) => m.projectId).sort().join(":").slice(0, 64),
      members,
      peak: Number((peakOf.get(root) ?? 0).toFixed(3)),
    });
  }

  // Tightest first: the pair most likely to be the same project is the one a
  // mentor should look at before their attention runs out.
  clusters.sort((a, b) => b.peak - a.peak);

  return {
    clusters,
    indexed: docs.length,
    clustered: clusters.reduce((n, c) => n + c.members.length, 0),
    model: embedder.id,
    truncated: total > docs.length,
  };
}

/** How many ideas are indexed for a set of people — powers the empty state. */
export async function countIndexed(userIds: string[]): Promise<number> {
  if (userIds.length === 0) return 0;
  return (await vectors()).countDocuments({ userId: { $in: userIds } });
}
