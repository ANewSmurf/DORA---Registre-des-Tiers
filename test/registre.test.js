import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { openDb } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedDemo, DEMO_PASSWORD, makeLei } from '../server/seed.js';
import { schema, tableByCode } from '../server/schema.js';
import { isValidLei, checkValue } from '../public/shared/validate.js';
import { importWorkbook } from '../server/xlsx.js';

let server;
let base;

before(async () => {
  const db = openDb(':memory:');
  seedDemo(db);
  server = createServer(createApp(db));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

async function login(username) {
  const res = await fetch(`${base}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'dora-app' },
    body: JSON.stringify({ username, password: DEMO_PASSWORD }),
  });
  assert.equal(res.status, 200, `connexion ${username}`);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body, raw } = {}) => {
    const r = await fetch(`${base}${path}`, {
      method,
      headers: {
        Cookie: cookie,
        'X-Requested-With': 'dora-app',
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
      },
      body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
    });
    const type = r.headers.get('content-type') || '';
    return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) };
  };
}

const count = (reg, tbl) => reg.body.tables[tbl].length;

test('le schéma reprend les 14 tableaux du template et leurs listes', () => {
  assert.equal(schema.tables.length, 14);
  assert.equal(tableByCode['b_02.02'].columns.length, 18);
  assert.equal(schema.lists.LISTANNEXIII.length, 19);
  const c = tableByCode['b_02.02'].columns.find((x) => x.code === 'b_02.02.0060');
  assert.equal(c.kind, 'list');
  assert.equal(c.required, true);
});

test('validation des formats', () => {
  assert.ok(isValidLei(makeLei('969500BANQUEXMPL01')));
  assert.ok(!isValidLei('969500BANQUEXMPL0100'));
  const col = (code) => tableByCode[code.slice(0, 7)].columns.find((c) => c.code === code);
  assert.equal(checkValue(schema, col('b_02.02.0070'), '2025-02-30'), 'Date attendue au format AAAA-MM-JJ');
  assert.equal(checkValue(schema, col('b_02.02.0040'), 'FR_CRN'), null);
  assert.match(checkValue(schema, col('b_02.02.0040'), 'SIREN'), /Format attendu/);
  assert.equal(checkValue(schema, col('b_06.01.0010'), 'F12'), null);
  assert.match(checkValue(schema, col('b_02.02.0060'), 'eba_TA:S99'), /liste/);
  assert.equal(checkValue(schema, col('b_02.02.0010'), ''), 'Champ obligatoire');
});

test('lecteur global : voit tout, ne modifie rien', async () => {
  const api = await login('lecteur.global');
  const reg = await api('/api/register');
  assert.equal(count(reg, 'b_05.01'), 3);
  assert.equal(count(reg, 'b_02.01'), 3);
  const p = reg.body.tables['b_05.01'][0];
  const r = await api(`/api/records/${p.id}`, { method: 'PUT', body: { data: p.data } });
  assert.equal(r.status, 403);
  assert.equal((await api('/api/users')).status, 403);
});

test('lecteur des tiers : ne voit que ses prestataires et leurs accords', async () => {
  const api = await login('lecteur.tiers');
  const reg = await api('/api/register');
  assert.equal(count(reg, 'b_05.01'), 1);
  assert.equal(reg.body.tables['b_05.01'][0].data['b_05.01.0030'], 'InfoGérance Services SAS');
  assert.deepEqual(
    reg.body.tables['b_02.01'].map((r) => r.data['b_02.01.0010']),
    ['CTR-2024-002'],
  );
  assert.equal(count(reg, 'b_01.02'), 2, 'le référentiel des entités reste lisible');
  const r = await api('/api/records', { method: 'POST', body: { table: 'b_07.01', data: {} } });
  assert.equal(r.status, 403);
});

test('administrateur de tiers : modifie son périmètre, pas celui des autres', async () => {
  const api = await login('admin.tiers');
  const reg = await api('/api/register');
  assert.equal(count(reg, 'b_05.01'), 2);
  const me = (await api('/api/me')).body;
  const cloud = me.providers.find((p) => p.name === 'CloudCo Europe');

  // Création d'un accord complet pour un prestataire rattaché.
  const ok = await api('/api/contracts', {
    method: 'POST',
    body: {
      general: { 'b_02.01.0010': 'CTR-2026-010', 'b_02.01.0020': 'eba_CO:x1', 'b_02.01.0040': 'eba_CU:EUR', 'b_02.01.0050': '1000' },
      specific: { 'b_02.02.0030': cloud.code, 'b_02.02.0040': 'LEI', 'b_02.02.0050': 'F1', 'b_02.02.0060': 'eba_TA:S18' },
    },
  });
  assert.equal(ok.status, 201);

  // Accord pour un prestataire non rattaché : refusé.
  const ko = await api('/api/contracts', {
    method: 'POST',
    body: {
      general: { 'b_02.01.0010': 'CTR-2026-011', 'b_02.01.0020': 'eba_CO:x1' },
      specific: { 'b_02.02.0030': '552100554', 'b_02.02.0040': 'FR_CRN', 'b_02.02.0050': 'F1' },
    },
  });
  assert.equal(ko.status, 403);

  // Le référentiel (entités, fonctions) n'est pas modifiable.
  const fn = await api('/api/records', { method: 'POST', body: { table: 'b_06.01', data: { 'b_06.01.0010': 'F9' } } });
  assert.equal(fn.status, 403);

  // Nouveau prestataire : rattaché automatiquement à son créateur.
  const np = await api('/api/records', {
    method: 'POST',
    body: { table: 'b_05.01', data: { 'b_05.01.0010': 'FR12345678901', 'b_05.01.0020': 'FR_VAT', 'b_05.01.0030': 'Nouveau SaaS' } },
  });
  assert.equal(np.status, 201);
  assert.equal(count(await api('/api/register'), 'b_05.01'), 3);

  // Format invalide : refusé avec le détail par champ.
  const bad = await api('/api/records', {
    method: 'POST',
    body: { table: 'b_07.01', data: { 'b_07.01.0010': 'CTR-2024-001', 'b_07.01.0020': cloud.code, 'b_07.01.0070': '31/12/2025' } },
  });
  assert.equal(bad.status, 422);
  assert.ok(bad.body.errors['b_07.01.0070']);

  // Suppression d'un prestataire réservée à l'administrateur global.
  const del = await api(`/api/records/${cloud.id}`, { method: 'DELETE' });
  assert.equal(del.status, 403);
});

test('administrateur global : utilisateurs, contrôles, export puis import', async () => {
  const api = await login('admin.global');
  const providers = (await api('/api/register')).body.tables['b_05.01'];
  const created = await api('/api/users', {
    method: 'POST',
    body: { username: 'nouveau.lecteur', displayName: 'Nouveau', role: 'tiers_reader', password: 'motdepasse-solide', providerIds: [providers[2].id] },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.providerIds, [providers[2].id]);
  const weak = await api('/api/users', { method: 'POST', body: { username: 'x.y', role: 'global_reader', password: 'court' } });
  assert.equal(weak.status, 400);

  // Contrôle de cohérence : référence vers un accord inexistant.
  await api('/api/records', {
    method: 'POST',
    body: { table: 'b_03.01', data: { 'b_03.01.0010': 'CTR-INCONNU', 'b_03.01.0020': makeLei('969500BANQUEXMPL01') } },
  });
  const checks = (await api('/api/checks')).body.issues;
  assert.ok(checks.some((i) => i.table === 'b_03.01' && i.level === 'erreur' && /absent/.test(i.message)));

  // Export au format du template puis relecture.
  const exp = await api('/api/export.xlsx');
  assert.equal(exp.status, 200);
  const parsed = await importWorkbook(exp.body);
  const before = (await api('/api/register')).body.tables;
  for (const t of schema.tables) assert.equal(parsed.tables[t.code].length, before[t.code].length, t.code);
  assert.equal(parsed.tables['b_03.01'][0]['b_03.01.0030'], 'true');

  // Import en remplacement : mêmes volumes, rattachements conservés.
  const imp = await api('/api/import?mode=replace', { method: 'POST', body: exp.body, raw: true });
  assert.equal(imp.status, 200);
  const after = (await api('/api/register')).body.tables;
  for (const t of schema.tables) assert.equal(after[t.code].length, before[t.code].length, t.code);
  const tiers = await login('lecteur.tiers');
  assert.equal(count(await tiers('/api/register'), 'b_05.01'), 1);
});

test('les requêtes de modification sans en-tête applicatif sont refusées (CSRF)', async () => {
  const res = await fetch(`${base}/api/logout`, { method: 'POST' });
  assert.equal(res.status, 403);
});
