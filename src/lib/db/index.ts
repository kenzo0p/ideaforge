import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

// ---------------------------------------------------------------------------
// SQLite persistence (zero-config via Node's built-in node:sqlite)
//
// One file-backed database, opened once and reused. A globalThis singleton keeps
// a single connection across dev/HMR reloads. Schema is created on first open.
// ---------------------------------------------------------------------------

const DB_PATH = resolve(process.env.IDEAFORGE_DB ?? "data/ideaforge.db");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  idea          TEXT NOT NULL,
  locale        TEXT,
  validation_md TEXT,
  research_json TEXT,
  plan_json     TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
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
  return db;
}

const globalForDb = globalThis as unknown as { __ideaforgeDb?: DatabaseSync };

export function getDb(): DatabaseSync {
  if (!globalForDb.__ideaforgeDb) globalForDb.__ideaforgeDb = open();
  return globalForDb.__ideaforgeDb;
}
