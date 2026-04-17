import Database from 'better-sqlite3';
import { resolve, dirname } from 'path';
import { mkdirSync } from 'fs';

let db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const path = dbPath ?? resolve(process.cwd(), 'map-engine', 'data', 'cogmap.db');
  mkdirSync(dirname(path), { recursive: true });

  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      level TEXT NOT NULL,
      tier TEXT NOT NULL,
      parent_id TEXT,
      story TEXT,
      context TEXT,
      x REAL,
      y REAL,
      loaded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS cross_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      edge_type TEXT NOT NULL,
      confidence REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      valid_from TEXT,
      valid_to TEXT,
      source TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_facts_subject ON facts(subject);
    CREATE INDEX IF NOT EXISTS idx_facts_object ON facts(object);
    CREATE INDEX IF NOT EXISTS idx_facts_predicate ON facts(predicate);

    CREATE TABLE IF NOT EXISTS changelog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      node_id TEXT NOT NULL,
      change_type TEXT NOT NULL,
      field TEXT,
      old_value TEXT,
      new_value TEXT,
      detected_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_changelog_node ON changelog(node_id);

    CREATE TABLE IF NOT EXISTS embeddings (
      node_id TEXT PRIMARY KEY,
      vector BLOB NOT NULL,
      computed_at TEXT NOT NULL
    );
  `);

  // FTS5 virtual table (separate exec since CREATE VIRTUAL TABLE IF NOT EXISTS
  // is supported in recent SQLite but we guard anyway)
  try {
    db.exec(`
      CREATE VIRTUAL TABLE nodes_fts USING fts5(
        id, label, story, context,
        content=nodes, content_rowid=rowid
      );
    `);
  } catch {
    // Already exists
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
