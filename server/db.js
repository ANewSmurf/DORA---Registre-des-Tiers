// Stockage SQLite (module node:sqlite intégré à Node.js ≥ 22.13, aucune dépendance native).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DEFAULT_REGULATIONS } from '../public/shared/tiers-model.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('global_admin','tiers_admin','global_reader','tiers_reader')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS user_providers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_id INTEGER NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, provider_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS records_tbl ON records(tbl);
CREATE TABLE IF NOT EXISTS tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS prestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tiers_id INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS prestations_tiers ON prestations(tiers_id);
CREATE TABLE IF NOT EXISTS user_tiers (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tiers_id INTEGER NOT NULL REFERENCES tiers(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, tiers_id)
);
CREATE TABLE IF NOT EXISTS regulations (
  code TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS function_ids (
  local TEXT PRIMARY KEY,
  eba TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (datetime('now')),
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  tbl TEXT,
  record_id INTEGER,
  detail TEXT
);
`;

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA_SQL);
  // Régulations par défaut au premier démarrage (modifiables ensuite par l'administrateur global).
  if (!db.prepare('SELECT 1 FROM regulations LIMIT 1').get()) {
    DEFAULT_REGULATIONS.forEach((r, i) =>
      db.prepare('INSERT INTO regulations (code, data, position) VALUES (?, ?, ?)').run(r.code, JSON.stringify(r), i),
    );
  }
  return db;
}

export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function rowToRecord(r) {
  return { id: r.id, tbl: r.tbl, data: JSON.parse(r.data), updated_at: r.updated_at, updated_by: r.updated_by };
}

export function allRecords(db, tbl) {
  const rows = tbl
    ? db.prepare('SELECT * FROM records WHERE tbl = ? ORDER BY id').all(tbl)
    : db.prepare('SELECT * FROM records ORDER BY id').all();
  return rows.map(rowToRecord);
}

export function getRecord(db, id) {
  const r = db.prepare('SELECT * FROM records WHERE id = ?').get(id);
  return r ? rowToRecord(r) : null;
}

export function insertRecord(db, tbl, data, userId) {
  const res = db
    .prepare('INSERT INTO records (tbl, data, updated_by) VALUES (?, ?, ?)')
    .run(tbl, JSON.stringify(data), userId ?? null);
  return Number(res.lastInsertRowid);
}

export function updateRecord(db, id, data, userId) {
  db.prepare("UPDATE records SET data = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
    JSON.stringify(data),
    userId ?? null,
    id,
  );
}

export function deleteRecord(db, id) {
  db.prepare('DELETE FROM records WHERE id = ?').run(id);
}

export function audit(db, user, action, { tbl = null, recordId = null, detail = null } = {}) {
  db.prepare('INSERT INTO audit (user_id, username, action, tbl, record_id, detail) VALUES (?, ?, ?, ?, ?, ?)').run(
    user?.id ?? null,
    user?.username ?? null,
    action,
    tbl,
    recordId,
    detail == null ? null : typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
}
