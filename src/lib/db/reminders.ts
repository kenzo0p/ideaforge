import { randomUUID } from "node:crypto";
import { getDb } from "./index";

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

export function createReminder(input: {
  userId: string;
  projectId: string;
  label: string;
  intervalMs: number;
  firstDueAt: number;
}): Reminder {
  const id = randomUUID();
  const now = Date.now();
  getDb()
    .prepare(
      `INSERT INTO reminders (id, user_id, project_id, label, interval_ms, next_due_at, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .run(id, input.userId, input.projectId, input.label, input.intervalMs, input.firstDueAt, now);
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

export function listRemindersForProject(projectId: string, userId: string): Reminder[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM reminders WHERE project_id = ? AND user_id = ? AND active = 1 ORDER BY next_due_at",
    )
    .all(projectId, userId) as ReminderRow[];
  return rows.map(toReminder);
}

/** Active reminders that are due at or before `now`. */
export function dueReminders(now: number): Reminder[] {
  const rows = getDb()
    .prepare("SELECT * FROM reminders WHERE active = 1 AND next_due_at <= ?")
    .all(now) as ReminderRow[];
  return rows.map(toReminder);
}

/** After sending: reschedule a recurring reminder, or deactivate a one-off. */
export function advanceReminder(id: string, intervalMs: number, now: number): void {
  if (intervalMs > 0) {
    getDb()
      .prepare("UPDATE reminders SET next_due_at = ? WHERE id = ?")
      .run(now + intervalMs, id);
  } else {
    getDb().prepare("UPDATE reminders SET active = 0 WHERE id = ?").run(id);
  }
}

export function deleteReminder(id: string, userId: string): void {
  getDb().prepare("DELETE FROM reminders WHERE id = ? AND user_id = ?").run(id, userId);
}

// --- Reminder history ------------------------------------------------------

export interface ReminderLog {
  id: string;
  nextStep: string;
  delivered: boolean;
  createdAt: number;
}

export function logReminderSent(input: {
  userId: string;
  projectId: string;
  nextStep: string;
  delivered: boolean;
}): void {
  getDb()
    .prepare(
      `INSERT INTO reminder_logs (id, user_id, project_id, next_step, delivered, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), input.userId, input.projectId, input.nextStep, input.delivered ? 1 : 0, Date.now());
}

/** A nudge across all projects, with its project title — for the inbox. */
export interface Notification extends ReminderLog {
  projectId: string;
  projectTitle: string;
}

export function listAllReminderLogs(userId: string, limit = 50): Notification[] {
  const rows = getDb()
    .prepare(
      `SELECT l.id, l.next_step, l.delivered, l.created_at, l.project_id, p.title
         FROM reminder_logs l
         JOIN projects p ON p.id = l.project_id
        WHERE l.user_id = ?
        ORDER BY l.created_at DESC
        LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    next_step: string;
    delivered: number;
    created_at: number;
    project_id: string;
    title: string;
  }>;
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
export function unreadNotificationCount(userId: string, seenAt: number): number {
  const { c } = getDb()
    .prepare("SELECT COUNT(*) AS c FROM reminder_logs WHERE user_id = ? AND created_at > ?")
    .get(userId, seenAt) as { c: number };
  return c;
}

export function listReminderLogs(projectId: string, userId: string, limit = 8): ReminderLog[] {
  const rows = getDb()
    .prepare(
      `SELECT id, next_step, delivered, created_at FROM reminder_logs
        WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .all(projectId, userId, limit) as Array<{
    id: string;
    next_step: string;
    delivered: number;
    created_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    nextStep: r.next_step,
    delivered: !!r.delivered,
    createdAt: r.created_at,
  }));
}
