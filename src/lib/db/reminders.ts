import { randomUUID } from "node:crypto";
import { col } from "./index";

// ---------------------------------------------------------------------------
// Reminders — scheduled nudges the Telegram bot sends for a project's next step.
//
// These stay in their own collections rather than embedded in the project: the
// scheduler queries due reminders *across every project*, which an embedded
// array cannot serve efficiently.
// ---------------------------------------------------------------------------

export interface Reminder {
  id: string;
  userId: string;
  projectId: string;
  label: string;
  intervalMs: number; // 0 = one-off
  nextDueAt: number;
  active: boolean;
  createdAt: number;
}

interface ReminderDoc {
  _id: string;
  userId: string;
  projectId: string;
  label: string;
  intervalMs: number;
  nextDueAt: number;
  active: boolean;
  createdAt: number;
}

interface LogDoc {
  _id: string;
  userId: string;
  projectId: string;
  nextStep: string;
  delivered: boolean;
  createdAt: number;
}

const reminders = () => col<ReminderDoc>("reminders");
const logs = () => col<LogDoc>("reminderLogs");

function toReminder(d: ReminderDoc): Reminder {
  return {
    id: d._id,
    userId: d.userId,
    projectId: d.projectId,
    label: d.label,
    intervalMs: d.intervalMs,
    nextDueAt: d.nextDueAt,
    active: !!d.active,
    createdAt: d.createdAt,
  };
}

export async function createReminder(input: {
  userId: string;
  projectId: string;
  label: string;
  intervalMs: number;
  firstDueAt: number;
}): Promise<Reminder> {
  const doc: ReminderDoc = {
    _id: randomUUID(),
    userId: input.userId,
    projectId: input.projectId,
    label: input.label,
    intervalMs: input.intervalMs,
    nextDueAt: input.firstDueAt,
    active: true,
    createdAt: Date.now(),
  };
  await (await reminders()).insertOne(doc);
  return toReminder(doc);
}

export async function listRemindersForProject(
  projectId: string,
  userId: string,
): Promise<Reminder[]> {
  const docs = await (await reminders())
    .find({ projectId, userId, active: true })
    .sort({ nextDueAt: 1 })
    .toArray();
  return docs.map(toReminder);
}

/** Active reminders that are due at or before `now`. */
export async function dueReminders(now: number): Promise<Reminder[]> {
  const docs = await (await reminders())
    .find({ active: true, nextDueAt: { $lte: now } })
    .toArray();
  return docs.map(toReminder);
}

/** After sending: reschedule a recurring reminder, or deactivate a one-off. */
export async function advanceReminder(
  id: string,
  intervalMs: number,
  now: number,
): Promise<void> {
  const c = await reminders();
  if (intervalMs > 0) {
    await c.updateOne({ _id: id }, { $set: { nextDueAt: now + intervalMs } });
  } else {
    await c.updateOne({ _id: id }, { $set: { active: false } });
  }
}

export async function deleteReminder(id: string, userId: string): Promise<void> {
  await (await reminders()).deleteOne({ _id: id, userId });
}

// --- Reminder history ------------------------------------------------------

export interface ReminderLog {
  id: string;
  nextStep: string;
  delivered: boolean;
  createdAt: number;
}

/** A nudge across all projects, with its project title — for the inbox. */
export interface Notification extends ReminderLog {
  projectId: string;
  projectTitle: string;
}

export async function logReminderSent(input: {
  userId: string;
  projectId: string;
  nextStep: string;
  delivered: boolean;
}): Promise<void> {
  await (await logs()).insertOne({
    _id: randomUUID(),
    userId: input.userId,
    projectId: input.projectId,
    nextStep: input.nextStep,
    delivered: input.delivered,
    createdAt: Date.now(),
  });
}

export async function listAllReminderLogs(userId: string, limit = 50): Promise<Notification[]> {
  const rows = await (await logs())
    .aggregate<LogDoc & { project?: { title: string }[] }>([
      { $match: { userId } },
      { $sort: { createdAt: -1 } },
      { $limit: limit },
      {
        // Stands in for the old JOIN onto projects, just to pick up the title.
        $lookup: {
          from: "projects",
          localField: "projectId",
          foreignField: "_id",
          as: "project",
          pipeline: [{ $project: { title: 1 } }],
        },
      },
    ])
    .toArray();

  return rows
    // A log whose project was deleted has nothing to link to — drop it, which
    // is what the old INNER JOIN did.
    .filter((r) => r.project?.length)
    .map((r) => ({
      id: r._id,
      nextStep: r.nextStep,
      delivered: !!r.delivered,
      createdAt: r.createdAt,
      projectId: r.projectId,
      projectTitle: r.project![0].title,
    }));
}

/** Count of nudges newer than the user's last visit to the inbox. */
export async function unreadNotificationCount(userId: string, seenAt: number): Promise<number> {
  return (await logs()).countDocuments({ userId, createdAt: { $gt: seenAt } });
}

export async function listReminderLogs(
  projectId: string,
  userId: string,
  limit = 8,
): Promise<ReminderLog[]> {
  const docs = await (await logs())
    .find({ projectId, userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((d) => ({
    id: d._id,
    nextStep: d.nextStep,
    delivered: !!d.delivered,
    createdAt: d.createdAt,
  }));
}
