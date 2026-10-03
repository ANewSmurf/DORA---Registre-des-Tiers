// Régulations (qualifications des prestations) et paramètres de l'organisation, gérés par
// l'administrateur global pour adapter le registre des tiers à chaque type d'entreprise.

export function listRegulations(db, { activeOnly = false } = {}) {
  return db
    .prepare(`SELECT * FROM regulations ${activeOnly ? 'WHERE active = 1' : ''} ORDER BY position, code`)
    .all()
    .map((r) => ({ ...JSON.parse(r.data), code: r.code, active: !!r.active, position: r.position }));
}

export function getRegulation(db, code) {
  const r = db.prepare('SELECT * FROM regulations WHERE code = ?').get(code);
  return r ? { ...JSON.parse(r.data), code: r.code, active: !!r.active, position: r.position } : null;
}

/** Nombre de prestations portant chaque qualification. */
export function regulationUsage(db) {
  const usage = {};
  for (const r of db.prepare('SELECT data FROM prestations').all()) {
    for (const code of Object.keys(JSON.parse(r.data).qualifications || {})) usage[code] = (usage[code] || 0) + 1;
  }
  return usage;
}

export const SETTINGS_DEFAULTS = { orgName: '', orgSector: '' };

export function getSettings(db) {
  const out = { ...SETTINGS_DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in out) out[r.key] = r.value;
  return out;
}

export function saveSettings(db, input) {
  for (const key of Object.keys(SETTINGS_DEFAULTS)) {
    if (input[key] === undefined) continue;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      key,
      String(input[key]).trim().slice(0, 120),
    );
  }
  return getSettings(db);
}
