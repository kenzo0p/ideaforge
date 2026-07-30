import { randomUUID } from "node:crypto";
import { many, one, run } from "./index";

// ---------------------------------------------------------------------------
// Reminders — scheduled nudges the Telegram bot sends for a project's next step.
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

interface ReminderRow {
  id: string;
  user_id: string;
  project_id: string;
  label: string;
  interval_ms: number;
  next_due_at: number;
  active: number;
  created_at: number;
}

function toReminder(r: ReminderRow): Reminder {
  return {
    id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    label: r.label,
    intervalMs: r.interval_ms,
    nextDueAt: r.next_due_at,
    active: !!r.active,
    createdAt: r.created_at,
  };
}

export async function createReminder(input: {
  userId: string;
  projectId: string;
  label: string;
  intervalMs: number;
  firstDueAt: number;
}): Promise<Reminder> {
  const id = randomUUID();
  const now = Date.now();
  await run(
    `INSERT INTO reminders (id, user_id, project_id, label, interval_ms, next_due_at, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    [id, input.userId, input.projectId, input.label, input.intervalMs, input.firstDueAt, now],
  );
  return {
    id,
    userId: input.userId,
    projectId: input.projectId,
    label: input.label,
    intervalMs: input.intervalMs,
    nextDueAt: input.firstDueAt,
    active: true,
    createdAt: now,
  };
}

export async function listRemindersForProject(
  projectId: string,
  userId: string,
): Promise<Reminder[]> {
  const rows = await many<ReminderRow>(
    "SELECT * FROM reminders WHERE project_id = ? AND user_id = ? AND active = 1 ORDER BY next_due_at",
    [projectId, userId],
  );
  return rows.map(toReminder);
}

/** Active reminders that are due at or before `now`. */
export async function dueReminders(now: number): Promise<Reminder[]> {
  const rows = await many<ReminderRow>(
    "SELECT * FROM reminders WHERE active = 1 AND next_due_at <= ?",
    [now],
  );
  return rows.map(toReminder);
}

/** After sending: reschedule a recurring reminder, or deactivate a one-off. */
export async function advanceReminder(
  id: string,
  intervalMs: number,
  now: number,
): Promise<void> {
  if (intervalMs > 0) {
    await run("UPDATE reminders SET next_due_at = ? WHERE id = ?", [now + intervalMs, id]);
  } else {
    await run("UPDATE reminders SET active = 0 WHERE id = ?", [id]);
  }
}

export async function deleteReminder(id: string, userId: string): Promise<void> {
  await run("DELETE FROM reminders WHERE id = ? AND user_id = ?", [id, userId]);
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
  await run(
    `INSERT INTO reminder_logs (id, user_id, project_id, next_step, delivered, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [randomUUID(), input.userId, input.projectId, input.nextStep, input.delivered ? 1 : 0, Date.now()],
  );
}

export async function listAllReminderLogs(userId: string, limit = 50): Promise<Notification[]> {
  const rows = await many<{
    id: string;
    next_step: string;
    delivered: number;
    created_at: number;
    project_id: string;
    title: string;
  }>(
    `SELECT l.id, l.next_step, l.delivered, l.created_at, l.project_id, p.title
       FROM reminder_logs l
       JOIN projects p ON p.id = l.project_id
      WHERE l.user_id = ?
      ORDER BY l.created_at DESC
      LIMIT ?`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    nextStep: r.next_step,
    delivered: !!r.delivered,
    createdAt: r.created_at,
    projectId: r.project_id,
    projectTitle: r.title,
  }));
}

/** Count of nudges newer than the user's last visit to the inbox. */
export async function unreadNotificationCount(userId: string, seenAt: number): Promise<number> {
  const row = await one<{ c: number }>(
    "SELECT COUNT(*) AS c FROM reminder_logs WHERE user_id = ? AND created_at > ?",
    [userId, seenAt],
  );
  return row?.c ?? 0;
}

export async function listReminderLogs(
  projectId: string,
  userId: string,
  limit = 8,
): Promise<ReminderLog[]> {
  const rows = await many<{
    id: string;
    next_step: string;
    delivered: number;
    created_at: number;
  }>(
    `SELECT id, next_step, delivered, created_at FROM reminder_logs
      WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [projectId, userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    nextStep: r.next_step,
    delivered: !!r.delivered,
    createdAt: r.created_at,
  }));
}
