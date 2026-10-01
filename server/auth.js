// Authentification : mots de passe scrypt, sessions par cookie HttpOnly.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const ROLES = {
  global_admin: 'Administrateur global de la plateforme',
  tiers_admin: 'Administrateur de tiers',
  global_reader: 'Lecteur global',
  tiers_reader: 'Lecteur des tiers rattachés',
};

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password, stored) {
  const [algo, saltHex, hashHex] = String(stored).split('$');
  if (algo !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export function checkPasswordPolicy(password) {
  if (typeof password !== 'string' || password.length < 10) {
    return 'Le mot de passe doit contenir au moins 10 caractères';
  }
  return null;
}

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now() + SESSION_TTL_MS,
  );
  return token;
}

export function destroySession(db, token) {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userFromSession(db, token) {
  if (!token) return null;
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.active FROM sessions s
       JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now());
  if (!row || !row.active) return null;
  return loadUser(db, row);
}

export function loadUser(db, row) {
  const providerIds = db
    .prepare('SELECT provider_id FROM user_providers WHERE user_id = ? ORDER BY provider_id')
    .all(row.id)
    .map((r) => r.provider_id);
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    roleLabel: ROLES[row.role],
    providerIds,
  };
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Limitation simple des tentatives de connexion (par identifiant + adresse).
const attempts = new Map();
export function loginThrottled(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60 * 1000) return false;
  return a.count >= 10;
}
export function recordLoginFailure(key) {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60 * 1000) attempts.set(key, { first: now, count: 1 });
  else a.count += 1;
}
export function clearLoginFailures(key) {
  attempts.delete(key);
}
