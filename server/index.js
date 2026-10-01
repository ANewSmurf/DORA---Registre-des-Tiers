// Point d'entrée : node server/index.js [--demo]
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { openDb, audit } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { seedDemo, DEMO_PASSWORD } from './seed.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const DB_PATH = process.env.DB_PATH || 'data/registre.db';
const demo = process.argv.includes('--demo');

const db = openDb(demo ? ':memory:' : DB_PATH);

if (demo) {
  const r = seedDemo(db);
  console.log(`Mode démonstration (base en mémoire) : ${r.records} lignes, comptes ${r.users.join(', ')}`);
  console.log(`Mot de passe des comptes de démonstration : ${DEMO_PASSWORD}`);
} else if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  // Premier démarrage : création du compte administrateur global.
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASSWORD || randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)').run(
    username,
    'Administrateur global',
    hashPassword(password),
    'global_admin',
  );
  audit(db, null, 'initialisation', { detail: { username } });
  console.log(`Compte administrateur global créé : ${username}`);
  if (!process.env.ADMIN_PASSWORD) console.log(`Mot de passe initial (à changer) : ${password}`);
}

const server = createServer(createApp(db, { secureCookies: process.env.SECURE_COOKIES === '1' }));
server.listen(PORT, HOST, () => console.log(`Registre DORA disponible sur http://${HOST}:${PORT}`));
