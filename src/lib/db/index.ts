import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";

// ---------------------------------------------------------------------------
// SQLite persistence (zero-config via Node's built-in node:sqlite)
//
// One file-backed database, opened once and reused. A globalThis singleton keeps
// a single connection across dev/HMR reloads. Schema is created on first open.
// ---------------------------------------------------------------------------

const DB_FILE = process.env.IDEAFORGE_DB ?? "data/ideaforge.db";
// Scope the path explicitly under cwd; the ignore comment stops the bundler from
// tracing the whole project just because this join is computed at runtime.
const DB_PATH = isAbsolute(DB_FILE)
  ? DB_FILE
  : join(/* turbopackIgnore: true */ process.cwd(), DB_FILE);

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT,
  password_hash  TEXT NOT NULL,   -- scrypt: salt:derivedKey (hex)
  email_verified INTEGER NOT NULL DEFAULT 0,
  locale         TEXT,            -- preferred output language
  notifications_seen_at INTEGER NOT NULL DEFAULT 0,
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,   -- opaque random token
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_hits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_hits ON rate_hits(user_id, kind, created_at);

CREATE TABLE IF NOT EXISTS telegram_links (
  chat_id    INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_telegram_links_user ON telegram_links(user_id);

CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label       TEXT NOT NULL,
  interval_ms INTEGER NOT NULL,   -- 0 = one-off
  next_due_at INTEGER NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(active, next_due_at);
CREATE INDEX IF NOT EXISTS idx_reminders_project ON reminders(project_id);

CREATE TABLE IF NOT EXISTS reminder_logs (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  next_step  TEXT NOT NULL,
  delivered  INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reminder_logs_project ON reminder_logs(project_id, created_at);

CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  user_id       TEXT REFERENCES users(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  idea          TEXT NOT NULL,
  locale        TEXT,
  validation_md TEXT,
  research_json TEXT,
  plan_json     TEXT,
  share_token   TEXT UNIQUE,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS milestone_progress (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx        INTEGER NOT NULL,
  done       INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, idx)
);

CREATE TABLE IF NOT EXISTS workspace_items (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,          -- 'source' | 'note' | 'decision'
  title      TEXT NOT NULL,
  url        TEXT,
  body       TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_project ON workspace_items(project_id);
`;
// Note: the projects(user_id) index is created in migrate(), after the column
// is guaranteed to exist — an existing DB won't have it until ALTER runs.

function open(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  // Rollback-journal + FULL sync: every commit lands directly in the single DB
  // file. For a single-writer local app this is more durable than WAL, whose
  // uncheckpointed commits can be lost if the dev-server process is killed hard.
  db.exec("PRAGMA journal_mode = DELETE;");
  db.exec("PRAGMA synchronous = FULL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Lightweight migrations for databases created before a column existed. */
function migrate(db: DatabaseSync): void {
  const projectCols = db.prepare("PRAGMA table_info(projects)").all() as Array<{ name: string }>;
  if (!projectCols.some((c) => c.name === "user_id")) {
    // Older DB: add the ownership column. Existing rows become unowned (hidden).
    db.exec("ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE");
  }
  // Safe now that the column is guaranteed to exist (fresh or migrated).
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)");

  if (!projectCols.some((c) => c.name === "share_token")) {
    // Public read-only share links. UNIQUE can't be added via ALTER, so enforce
    // uniqueness with an index instead.
    db.exec("ALTER TABLE projects ADD COLUMN share_token TEXT");
  }
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_share ON projects(share_token) WHERE share_token IS NOT NULL",
  );

  const userCols = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
  if (!userCols.some((c) => c.name === "email_verified")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    // Accounts that predate email verification are grandfathered in as verified.
    db.exec("UPDATE users SET email_verified = 1");
  }
  if (!userCols.some((c) => c.name === "locale")) {
    // Preferred output language (Settings → default language).
    db.exec("ALTER TABLE users ADD COLUMN locale TEXT");
  }
  if (!userCols.some((c) => c.name === "notifications_seen_at")) {
    // Watermark for the notifications badge (anything newer counts as unread).
    db.exec("ALTER TABLE users ADD COLUMN notifications_seen_at INTEGER NOT NULL DEFAULT 0");
  }
}

const globalForDb = globalThis as unknown as { __ideaforgeDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globalForDb.__ideaforgeDb) globalForDb.__ideaforgeDb = open();
  return globalForDb.__ideaforgeDb;
}
