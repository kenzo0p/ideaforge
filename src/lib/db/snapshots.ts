import { col } from "./index";

// ---------------------------------------------------------------------------
// Fingerprints of cited pages, as they were when we read them.
//
// Not archives. What is stored per source is a SHA-256 of the normalised text
// and a 128-number MinHash sketch — about half a kilobyte, from which the page
// cannot be reconstructed. That is deliberate on two counts: it keeps the
// storage cost of watching a thousand briefings trivial, and it means the
// product is not quietly accumulating copies of other people's copyrighted
// articles in order to check them.
//
// Everything the drift comparison needs is derivable from the fingerprint plus
// the page as it is today, so the copy would have been dead weight anyway.
// ---------------------------------------------------------------------------

export interface Snapshot {
  projectId: string;
  citationId: number;
  url: string;
  /** SHA-256 of the normalised text: identical or not, exactly. */
  contentHash: string;
  /** MinHash sketch: how much changed, estimated. */
  sketch: number[];
  /** Word count, so a page that was truncated on one read is visible as such. */
  words: number;
  capturedAt: number;
}

interface SnapshotDoc extends Snapshot {
  /** `${projectId}:${citationId}` — one fingerprint per cited source per brief. */
  _id: string;
  userId: string;
}

const snapshots = () => col<SnapshotDoc>("evidenceSnapshots");

const keyOf = (projectId: string, citationId: number) => `${projectId}:${citationId}`;

export async function saveSnapshots(
  projectId: string,
  userId: string,
  taken: Snapshot[],
): Promise<void> {
  if (taken.length === 0) return;
  await (await snapshots()).bulkWrite(
    taken.map((s) => ({
      replaceOne: {
        filter: { _id: keyOf(projectId, s.citationId) },
        replacement: { ...s, _id: keyOf(projectId, s.citationId), userId },
        upsert: true,
      },
    })),
  );
}

export async function getSnapshots(projectId: string): Promise<Snapshot[]> {
  const docs = await (await snapshots()).find({ projectId }).toArray();
  return docs.map(({ _id, userId, ...rest }) => {
    void _id;
    void userId;
    return rest;
  });
}

export async function purgeSnapshots(projectId: string): Promise<void> {
  await (await snapshots()).deleteMany({ projectId });
}
