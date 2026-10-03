// Point d'entrée : node server/index.js [--demo [--reset]]
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, audit } from './db.js';
import { createApp } from './app.js';
import { hashPassword } from './auth.js';
import { seedDemo, DEMO_PASSWORD } from './seed.js';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const demo = process.argv.includes('--demo');
// Les bases sont des fichiers du dossier data/ (ignoré par git : un git pull ne les touche jamais).
const dataFile = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const DB_PATH = process.env.DB_PATH || dataFile(demo ? 'demo.db' : 'registre.db');

if (demo && process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) rmSync(DB_PATH + suffix, { force: true });
  console.log(`Base de démonstration réinitialisée : ${DB_PATH}`);
}

const db = openDb(DB_PATH);
const { from, to, backup } = db.migration;
console.log(`Base : ${DB_PATH} (structure v${to})`);
if (from && from < to) console.log(`Structure mise à jour de v${from} à v${to}, données conservées.`);
if (backup) console.log(`Copie de sécurité avant mise à jour : ${backup}`);

if (demo) {
  if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
    const r = seedDemo(db);
    console.log(`Mode démonstration, base créée : ${r.records} lignes, comptes ${r.users.join(', ')}`);
  } else {
    console.log('Mode démonstration : données existantes conservées (npm run demo:reset pour repartir des données fictives).');
  }
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

// Arrêt propre : les écritures en attente sont reportées dans le fichier de la base.
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.once(sig, () => {
    server.close();
    db.close();
    process.exit(0);
  });
}
