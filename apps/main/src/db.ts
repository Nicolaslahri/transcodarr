import { DatabaseSync } from 'node:sqlite';
import path from 'path';

const DB_PATH = process.env.DB_PATH ?? './transcodarr.db';

let db: DatabaseSync;

export function getDb(): DatabaseSync {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}

export function initDb(): void {
  db = new DatabaseSync(DB_PATH);
  // node:sqlite executes pragmas with .exec() not .pragma() directly unless via exec
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');

  db.exec(`
    CREATE TABLE IF NOT EXISTS workers (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      host         TEXT NOT NULL,
      port         INTEGER NOT NULL,
      status       TEXT DEFAULT 'pending',
      hardware     TEXT DEFAULT '{}',
      smb_mappings TEXT DEFAULT '[]',
      last_seen    INTEGER,
      accepted_at  INTEGER
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id           TEXT PRIMARY KEY,
      file_path    TEXT NOT NULL,
      file_name    TEXT NOT NULL,
      file_size    INTEGER,
      codec_in     TEXT,
      resolution   TEXT,
      recipe       TEXT NOT NULL,
      status       TEXT DEFAULT 'pending',
      worker_id    TEXT,
      progress     INTEGER DEFAULT 0,
      fps          REAL,
      eta          INTEGER,
      error        TEXT,
      size_before  INTEGER,
      size_after   INTEGER,
      created_at   INTEGER DEFAULT (unixepoch()),
      updated_at   INTEGER DEFAULT (unixepoch()),
      completed_at INTEGER,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS watched_paths (
      id         TEXT PRIMARY KEY,
      path       TEXT NOT NULL UNIQUE,
      recipe     TEXT NOT NULL,
      enabled    INTEGER DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);
  `);
}
