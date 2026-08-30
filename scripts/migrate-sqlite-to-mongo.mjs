#!/usr/bin/env node
// One-shot migration: the old SQLite/libSQL database → MongoDB.
//
//   node --env-file=.env.local scripts/migrate-sqlite-to-mongo.mjs [--dry-run]
//
// Reads from SCRUTAN_DB (default data/scrutan.db) or TURSO_DATABASE_URL,
// and writes to MONGODB_URI. Safe to re-run: every write is an upsert keyed on
// the original id, so a second pass updates rather than duplicates.
//
// Shape changes applied here (see src/lib/db/projects.ts for the rationale):
//   • research_json / plan_json  → real subdocuments
//   • milestone_progress rows    → project.milestones[]
//   • workspace_items rows       → project.workspaceItems[]
//   • *_at expiry columns        → BSON Dates, so TTL indexes can reap them

import { createClient } from "@libsql/client";
import { MongoClient } from "mongodb";

const DRY = process.argv.includes("--dry-run");

const sqliteUrl =
  process.env.TURSO_DATABASE_URL ??
  `file:${(process.env.SCRUTAN_DB ?? "data/scrutan.db").replace(/^file:/, "")}`;

const mongoUri = process.env.MONGODB_URI;
if (!mongoUri) {
  console.error("MONGODB_URI is not set.");
  process.exit(1);
}

const sqlite = createClient({ url: sqliteUrl, authToken: process.env.TURSO_AUTH_TOKEN });
const mongo = new MongoClient(mongoUri);

const rows = async (sql) => {
  try {
    return (await sqlite.execute(sql)).rows;
  } catch (err) {
    // A table that never existed in this database is not an error.
    if (/no such table/i.test(err.message)) return [];
    throw err;
  }
};
const parse = (json) => {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

await mongo.connect();
const db = mongo.db(process.env.MONGODB_DB ?? "scrutan");
console.log(`from : ${sqliteUrl}`);
console.log(`to   : ${db.databaseName}${DRY ? "  (DRY RUN — nothing will be written)" : ""}\n`);

const stats = {};
async function load(name, docs) {
  stats[name] = docs.length;
  if (DRY || docs.length === 0) return;
  const col = db.collection(name);
  await col.bulkWrite(
    docs.map((d) => ({
      replaceOne: { filter: { _id: d._id }, replacement: d, upsert: true },
    })),
    { ordered: false },
  );
}

// --- users -----------------------------------------------------------------
await load(
  "users",
  (await rows("SELECT * FROM users")).map((u) => ({
    _id: u.id,
    email: u.email,
    name: u.name ?? null,
    passwordHash: u.password_hash,
    emailVerified: !!u.email_verified,
    locale: u.locale ?? null,
    notificationsSeenAt: Number(u.notifications_seen_at ?? 0),
    createdAt: Number(u.created_at),
  })),
);

// --- projects (with milestones + workspace items folded in) ----------------
const milestonesByProject = new Map();
for (const m of await rows("SELECT * FROM milestone_progress")) {
  const list = milestonesByProject.get(m.project_id) ?? [];
  list.push({ idx: Number(m.idx), done: !!m.done, updatedAt: Number(m.updated_at) });
  milestonesByProject.set(m.project_id, list);
}

const itemsByProject = new Map();
for (const w of await rows("SELECT * FROM workspace_items ORDER BY created_at")) {
  const list = itemsByProject.get(w.project_id) ?? [];
  list.push({
    id: w.id,
    kind: w.kind,
    title: w.title,
    url: w.url ?? null,
    body: w.body ?? null,
    createdAt: Number(w.created_at),
  });
  itemsByProject.set(w.project_id, list);
}

await load(
  "projects",
  (await rows("SELECT * FROM projects")).map((p) => {
    const doc = {
      _id: p.id,
      userId: p.user_id,
      title: p.title,
      idea: p.idea,
      locale: p.locale ?? null,
      validationMarkdown: p.validation_md ?? null,
      research: parse(p.research_json),
      plan: parse(p.plan_json),
      milestones: milestonesByProject.get(p.id) ?? [],
      workspaceItems: itemsByProject.get(p.id) ?? [],
      createdAt: Number(p.created_at),
      updatedAt: Number(p.updated_at),
    };
    // Omit rather than store null: the unique index on shareToken is sparse.
    if (p.share_token) doc.shareToken = p.share_token;
    return doc;
  }),
);

// --- sessions and tokens (expiry becomes a Date for the TTL index) ---------
const withExpiry = (r, idField) => ({
  _id: r[idField],
  userId: r.user_id,
  expiresAt: new Date(Number(r.expires_at)),
  createdAt: Number(r.created_at ?? Date.now()),
});

await load("sessions", (await rows("SELECT * FROM sessions")).map((r) => withExpiry(r, "id")));
await load(
  "verificationTokens",
  (await rows("SELECT * FROM verification_tokens")).map((r) => withExpiry(r, "token")),
);
await load(
  "passwordResetTokens",
  (await rows("SELECT * FROM password_reset_tokens")).map((r) => withExpiry(r, "token")),
);
await load(
  "telegramLinkCodes",
  (await rows("SELECT * FROM telegram_link_codes")).map((r) => ({
    _id: r.code,
    userId: r.user_id,
    expiresAt: new Date(Number(r.expires_at)),
  })),
);

// --- telegram links --------------------------------------------------------
await load(
  "telegramLinks",
  (await rows("SELECT * FROM telegram_links")).map((r) => ({
    _id: Number(r.chat_id),
    userId: r.user_id,
    activeProjectId: r.active_project_id ?? null,
    createdAt: Number(r.created_at),
  })),
);

// --- reminders -------------------------------------------------------------
await load(
  "reminders",
  (await rows("SELECT * FROM reminders")).map((r) => ({
    _id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    label: r.label,
    intervalMs: Number(r.interval_ms),
    nextDueAt: Number(r.next_due_at),
    active: !!r.active,
    createdAt: Number(r.created_at),
  })),
);

await load(
  "reminderLogs",
  (await rows("SELECT * FROM reminder_logs")).map((r) => ({
    _id: r.id,
    userId: r.user_id,
    projectId: r.project_id,
    nextStep: r.next_step,
    delivered: !!r.delivered,
    createdAt: Number(r.created_at),
  })),
);

// rate_hits is deliberately skipped: it's a short sliding window of throwaway
// counters, and the old rows would expire within the minute anyway.

for (const [name, n] of Object.entries(stats)) {
  console.log(`  ${name.padEnd(20)} ${n}`);
}
console.log(DRY ? "\nDry run complete — nothing written." : "\nMigration complete.");

await mongo.close();
sqlite.close();
