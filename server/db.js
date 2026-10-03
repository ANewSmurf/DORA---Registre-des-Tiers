// Stockage SQLite (module node:sqlite intégré à Node.js ≥ 22.13, aucune dépendance native).
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DEFAULT_REGULATIONS, legacyContact } from '../public/shared/tiers-model.js';

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

/**
 * Évolutions de la structure de la base, appliquées dans l'ordre et une seule fois.
 * La version atteinte est mémorisée dans la base (PRAGMA user_version) : une mise à jour du code
 * (git pull) n'applique que les migrations manquantes et conserve toutes les données.
 * Pour faire évoluer la structure, ajouter une migration en fin de liste ; ne jamais modifier
 * ni supprimer une migration déjà publiée.
 */
export const MIGRATIONS = [
  // Structure initiale (idempotente : les bases créées avant le suivi des versions la possèdent déjà).
  { version: 1, name: 'structure initiale', up: (db) => db.exec(SCHEMA_SQL) },
  {
    version: 2,
    name: 'organisation de la structure et contacts des tiers',
    up: (db) => {
      db.exec(`
        CREATE TABLE directions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE tiers_managers (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          data TEXT NOT NULL
        );
      `);
      // Le contact unique (nom, e-mail) des fiches tiers devient la première ligne du tableau des contacts.
      for (const r of db.prepare('SELECT id, data FROM tiers').all()) {
        const { contactName, contactEmail, ...data } = JSON.parse(r.data);
        const legacy = legacyContact(contactName, contactEmail);
        data.contacts = data.contacts || (legacy ? [legacy] : []);
        db.prepare('UPDATE tiers SET data = ? WHERE id = ?').run(JSON.stringify(data), r.id);
      }
    },
  },
];
export const SCHEMA_VERSION = MIGRATIONS.at(-1).version;

/** Applique les migrations en attente ; renvoie { from, to, backup }. */
export function migrate(db, file = ':memory:') {
  const from = db.prepare('PRAGMA user_version').get().user_version;
  if (from > SCHEMA_VERSION) {
    throw new Error(
      `La base ${file} est en version ${from}, plus récente que celle prise en charge par ce code (${SCHEMA_VERSION}) : mettre à jour l'application.`,
    );
  }
  const pending = MIGRATIONS.filter((m) => m.version > from);
  let backup = null;
  if (pending.length && file !== ':memory:' && db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get()) {
    // Copie de sécurité de la base existante avant de modifier sa structure.
    const dir = join(dirname(file), 'sauvegardes');
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    backup = join(dir, `avant-v${SCHEMA_VERSION}-${stamp}.db`);
    if (!existsSync(backup)) db.prepare('VACUUM INTO ?').run(backup);
  }
  for (const m of pending) {
    tx(db, () => {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
  return { from, to: SCHEMA_VERSION, backup };
}

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  try {
    db.migration = migrate(db, file);
  } catch (e) {
    db.close();
    throw e;
  }
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
