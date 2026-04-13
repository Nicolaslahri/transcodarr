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
      id               TEXT PRIMARY KEY,
      name             TEXT NOT NULL,
      host             TEXT NOT NULL,
      port             INTEGER NOT NULL,
      status           TEXT DEFAULT 'pending',
      hardware         TEXT DEFAULT '{}',
      smb_mappings     TEXT DEFAULT '[]',
      connection_mode  TEXT DEFAULT 'smb',
      last_seen        INTEGER,
      accepted_at      INTEGER
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id              TEXT PRIMARY KEY,
      file_path       TEXT NOT NULL,
      file_name       TEXT NOT NULL,
      file_size       INTEGER,
      codec_in        TEXT,
      resolution      TEXT,
      recipe          TEXT NOT NULL,
      status          TEXT DEFAULT 'pending',
      worker_id       TEXT,
      progress        INTEGER DEFAULT 0,
      fps             REAL,
      eta             INTEGER,
      phase           TEXT,
      error           TEXT,
      size_before     INTEGER,
      size_after      INTEGER,
      transfer_mode   TEXT DEFAULT 'smb',
      created_at      INTEGER DEFAULT (unixepoch()),
      updated_at      INTEGER DEFAULT (unixepoch()),
      completed_at    INTEGER,
      FOREIGN KEY (worker_id) REFERENCES workers(id)
    );

    CREATE TABLE IF NOT EXISTS watched_paths (
      id           TEXT PRIMARY KEY,
      path         TEXT NOT NULL UNIQUE,
      recipe       TEXT NOT NULL,
      enabled      INTEGER DEFAULT 1,
      recurse      INTEGER DEFAULT 1,
      extensions   TEXT DEFAULT '.mkv,.mp4,.avi,.ts,.mov',
      priority     TEXT DEFAULT 'normal',
      min_size_mb  INTEGER DEFAULT 100,
      created_at   INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS processed_files (
      file_path    TEXT NOT NULL,
      recipe       TEXT NOT NULL,
      file_size    INTEGER,
      processed_at INTEGER DEFAULT (unixepoch()),
      PRIMARY KEY (file_path, recipe)
    );

    CREATE TABLE IF NOT EXISTS webhooks (
      id         TEXT PRIMARY KEY,
      url        TEXT NOT NULL,
      events     TEXT NOT NULL DEFAULT '["job:complete","job:failed"]',
      secret     TEXT,
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_worker ON jobs(worker_id);
  `);

  // Migrations — safely add columns if they don't exist yet
  const migrate = (sql: string) => { try { db.exec(sql); } catch { /* column exists */ } };
  migrate(`ALTER TABLE watched_paths ADD COLUMN recurse INTEGER DEFAULT 1`);
  migrate(`ALTER TABLE watched_paths ADD COLUMN extensions TEXT DEFAULT '.mkv,.mp4,.avi,.ts,.mov'`);
  migrate(`ALTER TABLE watched_paths ADD COLUMN priority TEXT DEFAULT 'normal'`);
  migrate(`ALTER TABLE watched_paths ADD COLUMN min_size_mb INTEGER DEFAULT 100`);
  // v2 migrations
  migrate(`ALTER TABLE workers ADD COLUMN connection_mode TEXT DEFAULT 'smb'`);
  migrate(`ALTER TABLE jobs ADD COLUMN phase TEXT`);
  migrate(`ALTER TABLE jobs ADD COLUMN transfer_mode TEXT DEFAULT 'smb'`);
  // v3 migrations
  migrate(`ALTER TABLE jobs ADD COLUMN callback_token TEXT`);
  // v4 migrations
  migrate(`ALTER TABLE jobs ADD COLUMN sort_order INTEGER`);
  migrate(`CREATE INDEX IF NOT EXISTS idx_jobs_sort ON jobs(sort_order)`);
  migrate(`ALTER TABLE jobs ADD COLUMN pinned_worker_id TEXT`);
  migrate(`ALTER TABLE jobs ADD COLUMN has_subtitles INTEGER DEFAULT 0`);
  migrate(`ALTER TABLE jobs ADD COLUMN avg_fps REAL`);
  migrate(`ALTER TABLE jobs ADD COLUMN elapsed_seconds INTEGER`);
  migrate(`ALTER TABLE jobs ADD COLUMN dispatched_at INTEGER`);
  // v5 migrations
  migrate(`ALTER TABLE watched_paths ADD COLUMN preferred_audio_lang TEXT`);
  migrate(`ALTER TABLE watched_paths ADD COLUMN preferred_subtitle_lang TEXT`);
  migrate(`ALTER TABLE watched_paths ADD COLUMN scan_interval_hours INTEGER DEFAULT 0`);
  migrate(`ALTER TABLE watched_paths ADD COLUMN last_scan_at INTEGER`);
  // v6 migrations — enhanced fingerprinting
  migrate(`ALTER TABLE processed_files ADD COLUMN content_key TEXT`);
  migrate(`CREATE INDEX IF NOT EXISTS idx_processed_content ON processed_files(content_key)`);
  migrate(`ALTER TABLE jobs ADD COLUMN content_key TEXT`);
  // v7 migrations — worker version tracking
  migrate(`ALTER TABLE workers ADD COLUMN version TEXT`);
}
