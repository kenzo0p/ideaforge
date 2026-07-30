import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createClient, type Client, type InArgs, type Row } from "@libsql/client";

// ---------------------------------------------------------------------------
// SQLite persistence via libSQL.
//
// One driver, two targets:
//   • local dev  → file:data/ideaforge.db (no account, same as before)
//   • production → Turso over HTTP (TURSO_DATABASE_URL + TURSO_AUTH_TOKEN),
//     which works on serverless platforms where the filesystem is ephemeral.
//
// The SQL dialect is identical either way, so every query in this codebase is
// unchanged. A globalThis singleton keeps one client across dev/HMR reloads.
// ---------------------------------------------------------------------------

function connectionUrl(): string {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const file = (process.env.IDEAFORGE_DB ?? "data/ideaforge.db").replace(/^file:/, "");
  // libSQL won't create missing parent directories for a file DB.
  try {
    mkdirSync(dirname(file), { recursive: true });
  } catch {
    // Read-only filesystem (serverless) — TURSO_DATABASE_URL is required there.
  }
  return `file:${file}`;
}

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

CREATE TABLE IF NOT EXISTS password_reset_tokens (
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
  chat_id           INTEGER PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  active_project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at        INTEGER NOT NULL
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

/** Statements are applied one at a time; libSQL executes a single statement per call. */
function schemaStatements(): string[] {
  return SCHEMA.split(";")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => s + ";");
}

const g = globalThis as unknown as { __ideaforgeDb?: Promise<Client> };

/** The shared client, initialised (schema + migrations) exactly once. */
export function getDb(): Promise<Client> {
  if (!g.__ideaforgeDb) g.__ideaforgeDb = init();
  return g.__ideaforgeDb;
}

async function init(): Promise<Client> {
  const client = createClient({
    url: connectionUrl(),
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  for (const stmt of schemaStatements()) await client.execute(stmt);
  await migrate(client);
  return client;
}

// --- Tiny query helpers -----------------------------------------------------

/** First matching row, or undefined. */
export async function one<T>(sql: string, args: InArgs = []): Promise<T | undefined> {
  const { rows } = await (await getDb()).execute({ sql, args });
  return rows[0] as T | undefined;
}

/** All matching rows. */
export async function many<T>(sql: string, args: InArgs = []): Promise<T[]> {
  const { rows } = await (await getDb()).execute({ sql, args });
  return rows as unknown as T[];
}

/** Execute a write. */
export async function run(sql: string, args: InArgs = []): Promise<void> {
  await (await getDb()).execute({ sql, args });
}

/** Column names of a table — used by the migrations below. */
async function columns(client: Client, table: string): Promise<string[]> {
  const { rows } = await client.execute(`PRAGMA table_info(${table})`);
  return (rows as unknown as Row[]).map((r) => String(r.name));
}

/** Lightweight migrations for databases created before a column existed. */
async function migrate(db: Client): Promise<void> {
  const projectCols = await columns(db, "projects");
  if (projectCols.length && !projectCols.includes("user_id")) {
    // Older DB: add the ownership column. Existing rows become unowned (hidden).
    await db.execute(
      "ALTER TABLE projects ADD COLUMN user_id TEXT REFERENCES users(id) ON DELETE CASCADE",
    );
  }
  await db.execute("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)");

  if (projectCols.length && !projectCols.includes("share_token")) {
    // UNIQUE can't be added via ALTER, so uniqueness comes from the index below.
    await db.execute("ALTER TABLE projects ADD COLUMN share_token TEXT");
  }
  await db.execute(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_share ON projects(share_token) WHERE share_token IS NOT NULL",
  );

  const userCols = await columns(db, "users");
  if (userCols.length && !userCols.includes("email_verified")) {
    await db.execute("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0");
    // Accounts predating verification are grandfathered in as verified.
    await db.execute("UPDATE users SET email_verified = 1");
  }
  if (userCols.length && !userCols.includes("locale")) {
    await db.execute("ALTER TABLE users ADD COLUMN locale TEXT");
  }
  if (userCols.length && !userCols.includes("notifications_seen_at")) {
    await db.execute(
      "ALTER TABLE users ADD COLUMN notifications_seen_at INTEGER NOT NULL DEFAULT 0",
    );
  }

  const tgCols = await columns(db, "telegram_links");
  if (tgCols.length && !tgCols.includes("active_project_id")) {
    await db.execute("ALTER TABLE telegram_links ADD COLUMN active_project_id TEXT");
  }
}
