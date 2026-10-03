// API HTTP du registre et service des fichiers statiques (sans framework).
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { schema, tableByCode, KEYS } from './schema.js';
import { validateRow, isEmpty } from '../public/shared/validate.js';
import {
  ROLES,
  hashPassword,
  verifyPassword,
  checkPasswordPolicy,
  createSession,
  destroySession,
  userFromSession,
  parseCookies,
  loginThrottled,
  recordLoginFailure,
  clearLoginFailures,
} from './auth.js';
import { isGlobal, canManageUsers, canImport, canWriteTable, computeScope, inScope, visibleRecords } from './access.js';
import { allRecords, getRecord, insertRecord, updateRecord, deleteRecord, audit, tx } from './db.js';
import { runChecks } from './checks.js';
import { exportWorkbook, importWorkbook } from './xlsx.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};
const COOKIE = 'dora_session';
const MAX_JSON = 1024 * 1024;
const MAX_UPLOAD = 20 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}
const fail = (status, message, extra) => {
  throw new HttpError(status, message, extra);
};

function send(res, status, body, headers = {}) {
  const isBuf = Buffer.isBuffer(body);
  const payload = isBuf ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) fail(413, 'Requête trop volumineuse');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const buf = await readBody(req, MAX_JSON);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    fail(400, 'JSON invalide');
  }
}

/** Ne conserve que les colonnes du tableau, en chaînes nettoyées ; renseigne les colonnes « Link ». */
function cleanData(table, data) {
  const out = {};
  for (const col of table.columns) {
    if (col.kind === 'link') {
      out[col.code] = 'true';
      continue;
    }
    const v = data?.[col.code];
    out[col.code] = isEmpty(v) ? '' : String(v).trim();
  }
  return out;
}

/** Erreurs bloquantes : format invalide (les champs obligatoires vides sont signalés dans les contrôles). */
function blockingErrors(table, data) {
  const errors = validateRow(schema, table, data);
  for (const [k, msg] of Object.entries(errors)) if (msg === 'Champ obligatoire') delete errors[k];
  const firstKey = table.keys[0];
  if (firstKey && isEmpty(data[firstKey])) errors[firstKey] = 'Champ obligatoire (identifiant de la ligne)';
  return errors;
}

function duplicateOf(db, table, data, excludeId) {
  const keys = KEYS[table.code] || [];
  if (!keys.length) return null;
  const key = keys.map((k) => data[k] ?? '').join('|');
  return allRecords(db, table.code).find((r) => r.id !== excludeId && keys.map((k) => r.data[k] ?? '').join('|') === key);
}

function publicUser(db, row) {
  const providers = db
    .prepare('SELECT provider_id FROM user_providers WHERE user_id = ? ORDER BY provider_id')
    .all(row.id)
    .map((r) => r.provider_id);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    roleLabel: ROLES[row.role],
    active: !!row.active,
    createdAt: row.created_at,
    providerIds: providers,
  };
}

export function createApp(db, { secureCookies = false } = {}) {
  const routes = [];
  const route = (method, pattern, handler, { auth = true } = {}) => {
    const keys = [];
    const re = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
    routes.push({ method, re, keys, handler, auth });
  };

  // ---- Session -------------------------------------------------------------------------
  route(
    'POST',
    '/api/login',
    async (req, res) => {
      const { username, password } = await readJson(req);
      const throttleKey = `${String(username).toLowerCase()}|${req.socket.remoteAddress}`;
      if (loginThrottled(throttleKey)) fail(429, 'Trop de tentatives, réessayez dans quelques minutes');
      const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
      if (!row || !row.active || !verifyPassword(String(password || ''), row.password_hash)) {
        recordLoginFailure(throttleKey);
        fail(401, 'Identifiant ou mot de passe incorrect');
      }
      clearLoginFailures(throttleKey);
      const token = createSession(db, row.id);
      audit(db, row, 'connexion');
      const cookie = `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/${secureCookies ? '; Secure' : ''}`;
      send(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    },
    { auth: false },
  );

  route('POST', '/api/logout', async (req, res, { token }) => {
    destroySession(db, token);
    send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` });
  });

  route('GET', '/api/me', async (req, res, { user }) => {
    const records = allRecords(db, 'b_05.01');
    const providers = records.filter((r) => user.providerIds.includes(r.id));
    send(res, 200, {
      ...user,
      providers: providers.map((p) => ({ id: p.id, code: p.data['b_05.01.0010'], name: p.data['b_05.01.0030'] })),
      permissions: {
        global: isGlobal(user),
        manageUsers: canManageUsers(user),
        import: canImport(user),
        writeTables: schema.tables.filter((t) => canWriteTable(user, t.code)).map((t) => t.code),
      },
    });
  });

  route('PUT', '/api/me/password', async (req, res, { user }) => {
    const { current, next } = await readJson(req);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
    if (!verifyPassword(String(current || ''), row.password_hash)) fail(400, 'Mot de passe actuel incorrect');
    const policy = checkPasswordPolicy(next);
    if (policy) fail(400, policy);
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), user.id);
    audit(db, user, 'changement de mot de passe');
    send(res, 200, { ok: true });
  });

  route('GET', '/api/schema', async (req, res) => send(res, 200, schema));

  // ---- Registre ------------------------------------------------------------------------
  route('GET', '/api/register', async (req, res, { user }) => {
    const visible = visibleRecords(user, allRecords(db));
    const tables = Object.fromEntries(schema.tables.map((t) => [t.code, []]));
    for (const r of visible) tables[r.tbl]?.push(r);
    send(res, 200, { tables });
  });

  function assertWritable(user, tbl, data, id, all) {
    if (!canWriteTable(user, tbl)) fail(403, 'Votre profil ne permet pas de modifier ce tableau');
    if (isGlobal(user)) return;
    const scope = computeScope(user, all);
    if (!inScope(scope, tbl, data, id)) {
      fail(403, 'Cette ligne ne concerne pas un prestataire TIC qui vous est rattaché');
    }
  }

  route('POST', '/api/records', async (req, res, { user }) => {
    const { table: tbl, data } = await readJson(req);
    const table = tableByCode[tbl] || fail(400, 'Tableau inconnu');
    const clean = cleanData(table, data);
    const all = allRecords(db);
    // Un administrateur de tiers peut déclarer un nouveau prestataire : il lui est rattaché.
    const newProviderByTiersAdmin = tbl === 'b_05.01' && user.role === 'tiers_admin';
    if (!newProviderByTiersAdmin) assertWritable(user, tbl, clean, null, all);
    const errors = blockingErrors(table, clean);
    if (Object.keys(errors).length) fail(422, 'Certaines valeurs sont invalides', { errors });
    if (duplicateOf(db, table, clean)) fail(409, 'Une ligne avec le même identifiant existe déjà');
    const id = tx(db, () => {
      const newId = insertRecord(db, tbl, clean, user.id);
      if (newProviderByTiersAdmin) {
        db.prepare('INSERT INTO user_providers (user_id, provider_id) VALUES (?, ?)').run(user.id, newId);
      }
      audit(db, user, 'création', { tbl, recordId: newId, detail: clean });
      return newId;
    });
    send(res, 201, getRecord(db, id));
  });

  route('PUT', '/api/records/:id', async (req, res, { user, params }) => {
    const existing = getRecord(db, Number(params.id)) || fail(404, 'Ligne introuvable');
    const table = tableByCode[existing.tbl];
    const { data } = await readJson(req);
    const clean = cleanData(table, data);
    const all = allRecords(db);
    assertWritable(user, existing.tbl, existing.data, existing.id, all);
    assertWritable(user, existing.tbl, clean, existing.id, all);
    const errors = blockingErrors(table, clean);
    if (Object.keys(errors).length) fail(422, 'Certaines valeurs sont invalides', { errors });
    if (duplicateOf(db, table, clean, existing.id)) fail(409, 'Une ligne avec le même identifiant existe déjà');
    updateRecord(db, existing.id, clean, user.id);
    const changes = {};
    for (const k of Object.keys(clean)) if (clean[k] !== (existing.data[k] ?? '')) changes[k] = [existing.data[k] ?? '', clean[k]];
    audit(db, user, 'modification', { tbl: existing.tbl, recordId: existing.id, detail: changes });
    send(res, 200, getRecord(db, existing.id));
  });

  route('DELETE', '/api/records/:id', async (req, res, { user, params }) => {
    const existing = getRecord(db, Number(params.id)) || fail(404, 'Ligne introuvable');
    if (existing.tbl === 'b_05.01' && user.role !== 'global_admin') {
      fail(403, "Seul l'administrateur global peut supprimer un prestataire TIC");
    }
    assertWritable(user, existing.tbl, existing.data, existing.id, allRecords(db));
    tx(db, () => {
      deleteRecord(db, existing.id);
      audit(db, user, 'suppression', { tbl: existing.tbl, recordId: existing.id, detail: existing.data });
    });
    send(res, 200, { ok: true });
  });

  // Création d'un accord contractuel complet : b_02.01 (général) + b_02.02 (prestataire, fonction, service).
  route('POST', '/api/contracts', async (req, res, { user }) => {
    const body = await readJson(req);
    const general = cleanData(tableByCode['b_02.01'], body.general);
    const specific = cleanData(tableByCode['b_02.02'], { ...body.specific, 'b_02.02.0010': general['b_02.01.0010'] });
    const all = allRecords(db);
    assertWritable(user, 'b_02.02', specific, null, all);
    if (!canWriteTable(user, 'b_02.01')) fail(403, 'Votre profil ne permet pas de créer un accord');
    const errors = {
      ...blockingErrors(tableByCode['b_02.01'], general),
      ...blockingErrors(tableByCode['b_02.02'], specific),
    };
    if (Object.keys(errors).length) fail(422, 'Certaines valeurs sont invalides', { errors });
    if (duplicateOf(db, tableByCode['b_02.01'], general)) fail(409, 'Cette référence d’accord existe déjà');
    const ids = tx(db, () => {
      const g = insertRecord(db, 'b_02.01', general, user.id);
      const s = insertRecord(db, 'b_02.02', specific, user.id);
      audit(db, user, 'création', { tbl: 'b_02.01', recordId: g, detail: general });
      audit(db, user, 'création', { tbl: 'b_02.02', recordId: s, detail: specific });
      return { general: g, specific: s };
    });
    send(res, 201, ids);
  });

  route('GET', '/api/checks', async (req, res, { user }) => {
    const all = allRecords(db);
    const visible = visibleRecords(user, all);
    send(res, 200, { issues: runChecks(visible, all) });
  });

  // ---- Export / import -----------------------------------------------------------------
  route('GET', '/api/export.xlsx', async (req, res, { user }) => {
    const visible = visibleRecords(user, allRecords(db));
    const byTable = {};
    for (const r of visible) (byTable[r.tbl] ||= []).push(r);
    const buf = Buffer.from(await exportWorkbook(byTable));
    audit(db, user, 'export Excel', { detail: `${visible.length} lignes` });
    const date = new Date().toISOString().slice(0, 10);
    send(res, 200, buf, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="registre-information-dora-${date}.xlsx"`,
    });
  });

  route('POST', '/api/import', async (req, res, { user, query }) => {
    if (!canImport(user)) fail(403, "Seul l'administrateur global peut importer un registre");
    const mode = query.get('mode') === 'replace' ? 'replace' : 'append';
    const buf = await readBody(req, MAX_UPLOAD);
    let parsed;
    try {
      parsed = await importWorkbook(buf);
    } catch {
      fail(400, 'Fichier illisible : un classeur Excel .xlsx au format du template ou de remise EBA est attendu');
    }
    const summary = {};
    tx(db, () => {
      // En remplacement, les rattachements utilisateurs ↔ prestataires sont conservés via le code prestataire.
      const attachments = db
        .prepare(
          `SELECT up.user_id, json_extract(r.data, '$."b_05.01.0010"') AS code
           FROM user_providers up JOIN records r ON r.id = up.provider_id`,
        )
        .all();
      for (const [tbl, rows] of Object.entries(parsed.tables)) {
        if (mode === 'replace') db.prepare('DELETE FROM records WHERE tbl = ?').run(tbl);
        for (const data of rows) insertRecord(db, tbl, cleanData(tableByCode[tbl], data), user.id);
        summary[tbl] = rows.length;
      }
      if (mode === 'replace' && parsed.tables['b_05.01']) {
        const idByCode = new Map(allRecords(db, 'b_05.01').map((r) => [r.data['b_05.01.0010'], r.id]));
        for (const a of attachments) {
          const pid = idByCode.get(a.code);
          if (pid) db.prepare('INSERT OR IGNORE INTO user_providers (user_id, provider_id) VALUES (?, ?)').run(a.user_id, pid);
        }
      }
      audit(db, user, `import Excel (${mode === 'replace' ? 'remplacement' : 'ajout'})`, { detail: summary });
    });
    send(res, 200, { mode, summary, warnings: parsed.warnings });
  });

  // ---- Utilisateurs (administrateur global) --------------------------------------------
  const requireAdmin = (user) => canManageUsers(user) || fail(403, 'Réservé à l’administrateur global');

  function setProviders(userId, role, providerIds) {
    db.prepare('DELETE FROM user_providers WHERE user_id = ?').run(userId);
    if (role !== 'tiers_admin' && role !== 'tiers_reader') return;
    const valid = new Set(allRecords(db, 'b_05.01').map((r) => r.id));
    for (const pid of providerIds || []) {
      if (valid.has(Number(pid))) {
        db.prepare('INSERT OR IGNORE INTO user_providers (user_id, provider_id) VALUES (?, ?)').run(userId, Number(pid));
      }
    }
  }

  route('GET', '/api/users', async (req, res, { user }) => {
    requireAdmin(user);
    send(res, 200, db.prepare('SELECT * FROM users ORDER BY username').all().map((r) => publicUser(db, r)));
  });

  route('POST', '/api/users', async (req, res, { user }) => {
    requireAdmin(user);
    const b = await readJson(req);
    if (!/^[\w.@-]{3,64}$/.test(b.username || '')) fail(400, 'Identifiant invalide (3 à 64 caractères : lettres, chiffres, . _ - @)');
    if (!ROLES[b.role]) fail(400, 'Profil inconnu');
    const policy = checkPasswordPolicy(b.password);
    if (policy) fail(400, policy);
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(b.username)) fail(409, 'Cet identifiant existe déjà');
    const id = tx(db, () => {
      const r = db
        .prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(b.username, String(b.displayName || b.username).slice(0, 120), hashPassword(b.password), b.role);
      const newId = Number(r.lastInsertRowid);
      setProviders(newId, b.role, b.providerIds);
      audit(db, user, 'création utilisateur', { detail: { username: b.username, role: b.role } });
      return newId;
    });
    send(res, 201, publicUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  route('PUT', '/api/users/:id', async (req, res, { user, params }) => {
    requireAdmin(user);
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id)) || fail(404, 'Utilisateur introuvable');
    const b = await readJson(req);
    const role = b.role ?? row.role;
    if (!ROLES[role]) fail(400, 'Profil inconnu');
    const active = b.active === undefined ? !!row.active : !!b.active;
    if (row.id === user.id && (role !== 'global_admin' || !active)) {
      fail(400, 'Vous ne pouvez pas retirer vos propres droits d’administrateur');
    }
    if (b.password) {
      const policy = checkPasswordPolicy(b.password);
      if (policy) fail(400, policy);
    }
    tx(db, () => {
      db.prepare('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?').run(
        String(b.displayName ?? row.display_name).slice(0, 120),
        role,
        active ? 1 : 0,
        row.id,
      );
      if (b.password) db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(b.password), row.id);
      if (b.providerIds !== undefined || role !== row.role) setProviders(row.id, role, b.providerIds ?? []);
      if (!active || b.password) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(row.id);
      audit(db, user, 'modification utilisateur', {
        detail: { username: row.username, role, active, providerIds: b.providerIds, passwordReset: !!b.password },
      });
    });
    send(res, 200, publicUser(db, db.prepare('SELECT * FROM users WHERE id = ?').get(row.id)));
  });

  route('DELETE', '/api/users/:id', async (req, res, { user, params }) => {
    requireAdmin(user);
    const id = Number(params.id);
    if (id === user.id) fail(400, 'Vous ne pouvez pas supprimer votre propre compte');
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) || fail(404, 'Utilisateur introuvable');
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    audit(db, user, 'suppression utilisateur', { detail: { username: row.username } });
    send(res, 200, { ok: true });
  });

  route('GET', '/api/audit', async (req, res, { user }) => {
    requireAdmin(user);
    const rows = db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all();
    send(res, 200, rows);
  });

  // ---- Fichiers statiques --------------------------------------------------------------
  async function serveStatic(req, res, pathname) {
    const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.slice(1));
    const file = normalize(join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR.endsWith(sep) ? PUBLIC_DIR : PUBLIC_DIR + sep)) return send(res, 404, { error: 'Introuvable' });
    try {
      const st = await stat(file);
      if (!st.isFile()) throw new Error('not a file');
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(await readFile(file));
    } catch {
      send(res, 404, { error: 'Introuvable' });
    }
  }

  return async function handler(req, res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    );
    const url = new URL(req.url, 'http://localhost');
    try {
      if (!url.pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') fail(405, 'Méthode non autorisée');
        return await serveStatic(req, res, url.pathname);
      }
      // Protection CSRF : les requêtes de modification doivent venir de l'application (en-tête personnalisé).
      if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'dora-app') fail(403, 'Requête refusée');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = url.pathname.match(r.re);
        if (!m) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const token = parseCookies(req.headers.cookie)[COOKIE];
        const user = userFromSession(db, token);
        if (r.auth && !user) fail(401, 'Session expirée, veuillez vous reconnecter');
        return await r.handler(req, res, { user, token, params, query: url.searchParams });
      }
      fail(404, 'Ressource inconnue');
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message, ...(e.extra || {}) });
      console.error(e);
      send(res, 500, { error: 'Erreur interne' });
    }
  };
}
