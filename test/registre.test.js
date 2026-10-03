import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { openDb, SCHEMA_VERSION } from '../server/db.js';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { seedDemo, DEMO_PASSWORD, makeLei } from '../server/seed.js';
import { schema, tableByCode } from '../server/schema.js';
import { isValidLei, checkValue } from '../public/shared/validate.js';
import { importWorkbook } from '../server/xlsx.js';
import ExcelJS from 'exceljs';

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
  assert.equal(checkValue(schema, col('b_06.01.0010'), 'BRED-CRIT-F4'), null);
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

test('tiers et prestations : qualifications cumulables et périmètre', async () => {
  const admin = await login('admin.global');
  const all = (await admin('/api/tiers')).body;
  assert.equal(all.tiers.length, 8);
  const cloud = all.tiers.find((t) => t.data.name === 'CloudCo Europe');
  assert.ok(cloud.data.doraCode, 'tiers repris du registre DORA');
  const cloudPresta = all.prestations.find((p) => p.tiers_id === cloud.id);
  assert.deepEqual(Object.keys(cloudPresta.data.qualifications).sort(), ['ABE', 'DORA', 'PECI', 'RES']);
  assert.equal(cloudPresta.data.doraContract, 'CTR-2024-001');

  // Reprise idempotente du registre DORA (le premier appel reprend le prestataire créé plus haut).
  await admin('/api/tiers/sync-dora', { method: 'POST' });
  assert.deepEqual((await admin('/api/tiers/sync-dora', { method: 'POST' })).body, { newTiers: 0, linkedTiers: 0, newPrestations: 0 });
  assert.equal((await admin('/api/tiers', { method: 'POST', body: { data: { name: ' ' } } })).status, 422);

  // Lecteur des tiers : son tiers direct + celui de son prestataire TIC, en lecture seule.
  const reader = await login('lecteur.tiers');
  const mine = (await reader('/api/tiers')).body;
  assert.deepEqual(mine.tiers.map((t) => t.data.name).sort(), ['InfoGérance Services SAS', 'Éditique Nord']);
  assert.ok(mine.tiers.every((t) => !t.editable));
  assert.equal((await reader('/api/prestations', { method: 'POST', body: { tiersId: mine.tiers[0].id, data: { title: 'X' } } })).status, 403);

  // Administrateur de tiers : ajoute une prestation DORA + PECI à son tiers, pas à celui d'un autre.
  const ta = await login('admin.tiers');
  const scope = (await ta('/api/tiers')).body;
  const transval = scope.tiers.find((t) => t.data.name === 'Transval Sécurité');
  const created = await ta('/api/prestations', {
    method: 'POST',
    body: { tiersId: transval.id, data: { title: 'Supervision des automates', status: 'projet', qualifications: { DORA: { critical: true }, PECI: { critical: true, note: 'Disponibilité' }, XYZ: {} } } },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.data.qualifications, { DORA: { critical: true, note: '' }, PECI: { critical: false, note: 'Disponibilité' } });
  const other = all.tiers.find((t) => t.data.name === 'Banque Partenaire Europe');
  assert.ok(!scope.tiers.some((t) => t.id === other.id));
  assert.equal((await ta(`/api/tiers/${other.id}`, { method: 'PUT', body: { data: { name: 'Pirate' } } })).status, 403);
  assert.equal((await ta('/api/prestations', { method: 'POST', body: { tiersId: other.id, data: { title: 'X' } } })).status, 403);
  const newTiers = await ta('/api/tiers', { method: 'POST', body: { data: { name: 'Nouveau sous-traitant', country: 'fr' } } });
  assert.equal(newTiers.status, 201);
  assert.equal(newTiers.body.data.country, 'FR');
  assert.ok((await ta('/api/tiers')).body.tiers.some((t) => t.id === newTiers.body.id && t.editable));

  const xlsx = await admin('/api/tiers/export.xlsx');
  assert.equal(xlsx.status, 200);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(xlsx.body);
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Tiers', 'Prestations']);
  assert.equal(wb.getWorksheet('Prestations').rowCount, (await admin('/api/tiers')).body.prestations.length + 1);
});

test('régulations paramétrables par l’administrateur global', async () => {
  const admin = await login('admin.global');
  const reader = await login('lecteur.global');
  const initial = (await admin('/api/regulations')).body.regulations;
  assert.deepEqual(initial.map((r) => r.code), ['DORA', 'PECI', 'PBE', 'RES', 'ABE']);
  const s2 = { code: 's2', label: 'Solvabilité II', name: 'Externalisation Solvabilité II', color: 'teal', criticalLabel: 'Importante ou critique' };
  assert.equal((await reader('/api/regulations', { method: 'POST', body: { data: s2 } })).status, 403);
  const created = await admin('/api/regulations', { method: 'POST', body: { data: s2 } });
  assert.equal(created.status, 201);
  assert.equal(created.body.code, 'S2');
  assert.equal((await admin('/api/regulations', { method: 'POST', body: { data: s2 } })).status, 409);

  // Une prestation peut porter la nouvelle qualification.
  const tiers = (await admin('/api/tiers')).body.tiers[0];
  const p = await admin('/api/prestations', { method: 'POST', body: { tiersId: tiers.id, data: { title: 'Gestion des sinistres', qualifications: { S2: { critical: true }, PECI: {} } } } });
  assert.deepEqual(Object.keys(p.body.data.qualifications).sort(), ['PECI', 'S2']);

  // Désactivée : plus proposée, mais conservée sur les prestations existantes ; non supprimable si utilisée.
  assert.equal((await admin('/api/regulations/S2', { method: 'PUT', body: { data: s2, active: false } })).status, 200);
  const edited = await admin(`/api/prestations/${p.body.id}`, { method: 'PUT', body: { data: { title: 'Gestion des sinistres', qualifications: { PECI: {} } } } });
  assert.deepEqual(Object.keys(edited.body.data.qualifications).sort(), ['PECI', 'S2']);
  const other = await admin('/api/prestations', { method: 'POST', body: { tiersId: tiers.id, data: { title: 'Autre', qualifications: { S2: {} } } } });
  assert.deepEqual(other.body.data.qualifications, {});
  assert.equal((await admin('/api/regulations/S2', { method: 'DELETE' })).status, 409);
  assert.equal((await admin('/api/regulations/DORA', { method: 'DELETE' })).status, 400);
  assert.equal((await admin('/api/regulations/DORA', { method: 'PUT', body: { data: initial[0], active: false } })).status, 400);

  // Ordre et paramètres de l'organisation.
  await admin('/api/regulations/ABE/move', { method: 'POST', body: { dir: -1 } });
  assert.deepEqual((await admin('/api/regulations')).body.regulations.map((r) => r.code), ['DORA', 'PECI', 'PBE', 'ABE', 'RES', 'S2']);
  assert.equal((await admin('/api/settings', { method: 'PUT', body: { data: { orgName: 'Banque Exemple' } } })).body.orgName, 'Banque Exemple');
  assert.equal((await reader('/api/regulations')).body.settings.orgName, 'Banque Exemple');
  await admin(`/api/prestations/${p.body.id}`, { method: 'DELETE' });
  await admin(`/api/prestations/${other.body.id}`, { method: 'DELETE' });
  assert.equal((await admin('/api/regulations/S2', { method: 'DELETE' })).status, 200);
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

test('import au format de remise EBA (onglets b_xx_xx, codes c0010 en ligne 1)', async () => {
  const wb = new ExcelJS.Workbook();
  const sheet = (name, header, rows) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(header);
    rows.forEach((r) => ws.addRow(r));
  };
  const lei = makeLei('969500PRESTATAIRE1');
  sheet('RECAPITULATIF', ['Tableau', 'Lignes'], [['b_05_01', 2]]);
  sheet(
    'b_05_01',
    ['c0010', 'c0020', 'c0030', 'c0040', 'c0050', 'c0060', 'c0070', 'c0080', 'c0090', 'c0100', 'c0110', 'c0120'],
    [
      [lei, 'eba_qCO:qx2000', null, null, 'Presta LEI', 'Presta LEI', 'eba_CT:x212', 'eba_GA:FR', 'eba_CU:EUR', 1200.5, null, null],
      [552100554, 'eba_qCO:qx2003', 'FR62552100554', 'eba_qCO:qx2004', 'Presta SIREN', 'Presta SIREN', 'eba_CT:x212', 'eba_GA:BE', 'eba_CU:EUR', 300, lei, 'eba_qCO:qx2000'],
    ],
  );
  sheet('b_03_02', ['c0010', 'c0020', 'c0030'], [['CTR-1', 552100554, 'eba_qCO:qx2003']]);
  sheet('b_02_02', ['c0010', 'c0130', 'c0150', 'c0070'], [['CTR-1', 'eba_GA:qx2007', 'eba_GA:FR', new Date(Date.UTC(2024, 0, 31))]]);
  const { tables, warnings } = await importWorkbook(await wb.xlsx.writeBuffer());

  const [p1, p2] = tables['b_05.01'];
  assert.deepEqual(
    [p1['b_05.01.0020'], p1['b_05.01.0030'], p1['b_05.01.0050'], p1['b_05.01.0070']],
    ['LEI', 'Presta LEI', 'eba_GA:FR', '1200.5'],
  );
  assert.deepEqual(
    [p2['b_05.01.0010'], p2['b_05.01.0020'], p2['b_05.01.0080'], p2['b_05.01.0090']],
    ['552100554', 'BE_CRN', lei, 'LEI'],
  );
  assert.deepEqual(tables['b_03.02'][0], { 'b_03.02.0010': 'CTR-1', 'b_03.02.0020': '552100554', 'b_03.02.0030': 'BE_CRN', 'b_03.02.0045': 'true' });
  assert.equal(tables['b_02.02'][0]['b_02.02.0070'], '2024-01-31');
  assert.equal(checkValue(schema, tableByCode['b_02.02'].columns.find((c) => c.code === 'b_02.02.0130'), 'eba_GA:qx2007'), null);
  assert.ok(warnings.some((w) => /c0030/.test(w)));
  assert.ok(warnings.some((w) => /RECAPITULATIF/.test(w)));
});

test('les requêtes de modification sans en-tête applicatif sont refusées (CSRF)', async () => {
  const res = await fetch(`${base}/api/logout`, { method: 'POST' });
  assert.equal(res.status, 403);
});

test('identifiants de fonction locaux : identifiant EBA stable à l’export, restitué à l’import', async () => {
  const admin = await login('admin.global');
  const lei = makeLei('969500BANQUEXMPL01');
  for (const id of ['BANQ-CRIT-F9', 'F7']) {
    const r = await admin('/api/records', {
      method: 'POST',
      body: { table: 'b_06.01', data: { 'b_06.01.0010': id, 'b_06.01.0020': 'eba_TA:x28', 'b_06.01.0030': `Fonction ${id}`, 'b_06.01.0040': lei } },
    });
    assert.equal(r.status, 201);
  }
  const exportFunctions = async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await admin('/api/export.xlsx')).body);
    const ids = [];
    wb.getWorksheet('b_06.01').eachRow((row, r) => r >= 7 && ids.push(String(row.getCell(2).value)));
    return { wb, ids };
  };
  const first = await exportFunctions();
  assert.ok(first.ids.every((id) => /^F\d+$/.test(id)), first.ids.join(','));
  assert.ok(first.ids.includes('F7'), 'un identifiant déjà conforme est conservé');
  const mapping = (await admin('/api/function-ids')).body;
  const local = mapping.find((m) => m.local === 'BANQ-CRIT-F9');
  assert.ok(local && local.eba !== 'F7');
  assert.deepEqual((await exportFunctions()).ids, first.ids, 'même identifiant d’un export à l’autre');

  const sheet = first.wb.getWorksheet('Identifiants de fonction');
  assert.equal(sheet.getRow(2).getCell(1).value, local.eba);
  assert.equal(sheet.getRow(2).getCell(2).value, 'BANQ-CRIT-F9');
  const parsed = await importWorkbook(await first.wb.xlsx.writeBuffer());
  assert.ok(parsed.tables['b_06.01'].some((d) => d['b_06.01.0010'] === 'BANQ-CRIT-F9'));
  assert.ok(!parsed.warnings.some((w) => /Identifiants de fonction/.test(w)));
});

test('base sur disque : données conservées, structure mise à jour avec copie de sécurité', () => {
  const dir = mkdtempSync(join(tmpdir(), 'registre-'));
  try {
    const file = join(dir, 'registre.db');
    // Base créée par une version antérieure du code (sans numéro de version de structure).
    const old = new DatabaseSync(file);
    old.exec("CREATE TABLE tiers (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER)");
    old.prepare('INSERT INTO tiers (data) VALUES (?)').run(JSON.stringify({ name: 'Tiers existant' }));
    old.close();

    let db = openDb(file);
    assert.equal(db.migration.from, 0);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    assert.equal(JSON.parse(db.prepare('SELECT data FROM tiers').get().data).name, 'Tiers existant');
    assert.ok(db.prepare('SELECT 1 FROM regulations').get(), 'tables ajoutées');
    assert.ok(db.migration.backup);
    assert.equal(readdirSync(join(dir, 'sauvegardes')).length, 1);
    db.prepare('INSERT INTO tiers (data) VALUES (?)').run(JSON.stringify({ name: 'Ajouté' }));
    db.close();

    // Redémarrage : rien à migrer, aucune nouvelle copie, données intactes.
    db = openDb(file);
    assert.equal(db.migration.backup, null);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tiers').get().n, 2);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    db.close();

    // Base plus récente que le code : refus d'ouvrir plutôt que risquer de l'abîmer.
    assert.throws(() => openDb(file), /plus récente/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
