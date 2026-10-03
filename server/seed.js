// Données et comptes de démonstration (fictifs).
import { hashPassword } from './auth.js';
import { insertRecord, tx } from './db.js';
import { tableByCode } from './schema.js';
import { allPrestations, insertPrestation, insertTiers, syncFromDora, updatePrestation } from './tiers.js';

export const DEMO_PASSWORD = 'Demo-DORA-2026';

/** Construit un LEI valide (clé ISO 17442) à partir d'un préfixe de 18 caractères. */
export function makeLei(prefix18) {
  const digits = `${prefix18}00`.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return prefix18 + String(98 - rest).padStart(2, '0');
}

const LEI_BANK = makeLei('969500BANQUEXMPL01');
const LEI_INSUR = makeLei('969500ASSUREXMPL02');
const LEI_CLOUD = makeLei('549300CLOUDCOEXMP3');

const fill = (tbl, data) => {
  const out = {};
  for (const c of tableByCode[tbl].columns) out[c.code] = c.kind === 'link' ? 'true' : (data[c.short] ?? '');
  return out;
};

const DATA = [
  ['b_01.01', { '0010': LEI_BANK, '0020': 'Banque Exemple SA', '0030': 'eba_GA:FR', '0040': 'eba_CT:x12', '0050': 'ACPR', '0060': '2025-12-31' }],
  ['b_01.02', { '0010': LEI_BANK, '0020': 'Banque Exemple SA', '0030': 'eba_GA:FR', '0040': 'eba_CT:x12', '0050': 'eba_RP:x53', '0060': LEI_BANK, '0070': '2025-11-30', '0080': '2025-01-15', '0090': '9999-12-31', '0100': 'eba_CU:EUR', '0110': '12500000000' }],
  ['b_01.02', { '0010': LEI_INSUR, '0020': 'Exemple Assurances', '0030': 'eba_GA:FR', '0040': 'eba_CT:x309', '0050': 'eba_RP:x56', '0060': LEI_BANK, '0070': '2025-11-30', '0080': '2025-01-15', '0090': '9999-12-31', '0100': 'eba_CU:EUR', '0110': '2300000000' }],
  ['b_01.03', { '0010': 'BEX-LU-01', '0020': LEI_BANK, '0030': 'Banque Exemple Luxembourg', '0040': 'eba_GA:LU' }],
  ['b_06.01', { '0010': 'F1', '0020': 'eba_TA:x28', '0030': 'Paiements clients', '0040': LEI_BANK, '0050': 'eba_BT:x28', '0060': 'Interruption directe du service aux clients', '0070': '2025-06-30', '0080': '4', '0090': '1', '0100': 'eba_ZZ:x793' }],
  ['b_06.01', { '0010': 'F2', '0020': 'eba_TA:x163', '0030': 'Octroi de crédits', '0040': LEI_BANK, '0050': 'eba_BT:x29', '0070': '2025-06-30', '0080': '48', '0090': '24', '0100': 'eba_ZZ:x792' }],
  ['b_05.01', { '0010': LEI_CLOUD, '0020': 'LEI', '0030': 'CloudCo Europe', '0040': 'eba_CT:x212', '0050': 'eba_GA:IE', '0060': 'eba_CU:EUR', '0070': '1850000' }],
  ['b_05.01', { '0010': '552100554', '0020': 'FR_CRN', '0030': 'InfoGérance Services SAS', '0040': 'eba_CT:x212', '0050': 'eba_GA:FR', '0060': 'eba_CU:EUR', '0070': '620000' }],
  ['b_05.01', { '0010': 'DE811569869', '0020': 'DE_VAT', '0030': 'PayRoll Software GmbH', '0040': 'eba_CT:x212', '0050': 'eba_GA:DE', '0060': 'eba_CU:EUR', '0070': '95000' }],
  ['b_02.01', { '0010': 'CTR-2024-001', '0020': 'eba_CO:x1', '0040': 'eba_CU:EUR', '0050': '1850000' }],
  ['b_02.01', { '0010': 'CTR-2024-002', '0020': 'eba_CO:x1', '0040': 'eba_CU:EUR', '0050': '620000' }],
  ['b_02.01', { '0010': 'CTR-2025-003', '0020': 'eba_CO:x1', '0040': 'eba_CU:EUR', '0050': '95000' }],
  ['b_02.02', { '0010': 'CTR-2024-001', '0020': LEI_BANK, '0030': LEI_CLOUD, '0040': 'LEI', '0050': 'F1', '0060': 'eba_TA:S17', '0070': '2024-03-01', '0080': '2029-02-28', '0100': '180', '0110': '365', '0120': 'eba_GA:IE', '0130': 'eba_GA:IE', '0140': 'eba_BT:x28', '0150': 'eba_GA:IE', '0160': 'eba_GA:FR', '0170': 'eba_ZZ:x793', '0180': 'eba_ZZ:x797' }],
  ['b_02.02', { '0010': 'CTR-2024-002', '0020': LEI_BANK, '0030': '552100554', '0040': 'FR_CRN', '0050': 'F1', '0060': 'eba_TA:S14', '0070': '2024-07-01', '0080': '2027-06-30', '0100': '90', '0110': '180', '0120': 'eba_GA:FR', '0130': 'eba_GA:FR', '0140': 'eba_BT:x29', '0180': 'eba_ZZ:x796' }],
  ['b_02.02', { '0010': 'CTR-2025-003', '0020': LEI_INSUR, '0030': 'DE811569869', '0040': 'DE_VAT', '0050': 'F2', '0060': 'eba_TA:S19', '0070': '2025-01-01', '0080': '2026-12-31', '0140': 'eba_BT:x28', '0150': 'eba_GA:DE', '0160': 'eba_GA:DE', '0170': 'eba_ZZ:x792' }],
  ['b_03.01', { '0010': 'CTR-2024-001', '0020': LEI_BANK }],
  ['b_03.01', { '0010': 'CTR-2024-002', '0020': LEI_BANK }],
  ['b_03.01', { '0010': 'CTR-2025-003', '0020': LEI_INSUR }],
  ['b_03.02', { '0010': 'CTR-2024-001', '0020': LEI_CLOUD, '0030': 'LEI' }],
  ['b_03.02', { '0010': 'CTR-2024-002', '0020': '552100554', '0030': 'FR_CRN' }],
  ['b_03.02', { '0010': 'CTR-2025-003', '0020': 'DE811569869', '0030': 'DE_VAT' }],
  ['b_04.01', { '0010': 'CTR-2024-001', '0020': LEI_BANK, '0030': 'eba_ZZ:x839' }],
  ['b_04.01', { '0010': 'CTR-2024-001', '0020': LEI_BANK, '0030': 'eba_ZZ:x838', '0040': 'BEX-LU-01' }],
  ['b_04.01', { '0010': 'CTR-2024-002', '0020': LEI_BANK, '0030': 'eba_ZZ:x839' }],
  ['b_04.01', { '0010': 'CTR-2025-003', '0020': LEI_INSUR, '0030': 'eba_ZZ:x839' }],
  ['b_05.02', { '0010': 'CTR-2024-001', '0020': 'eba_TA:S17', '0030': LEI_CLOUD, '0040': 'LEI', '0050': '1', '0060': 'Not applicable', '0070': 'Not applicable' }],
  ['b_05.02', { '0010': 'CTR-2024-002', '0020': 'eba_TA:S14', '0030': '552100554', '0040': 'FR_CRN', '0050': '1', '0060': 'Not applicable', '0070': 'Not applicable' }],
  ['b_07.01', { '0010': 'CTR-2024-001', '0020': LEI_CLOUD, '0030': 'LEI', '0040': 'eba_TA:S17', '0050': 'eba_ZZ:x960', '0060': 'eba_ZZ:x964', '0070': '2025-09-15', '0080': 'eba_BT:x28', '0090': 'eba_ZZ:x967', '0100': 'eba_ZZ:x793', '0110': 'eba_BT:x28', '0120': 'Deux hébergeurs européens présélectionnés' }],
  ['b_07.01', { '0010': 'CTR-2024-002', '0020': '552100554', '0030': 'FR_CRN', '0040': 'eba_TA:S14', '0050': 'eba_ZZ:x961', '0070': '9999-12-31', '0080': 'eba_BT:x29', '0090': 'eba_ZZ:x966', '0100': 'eba_ZZ:x792', '0110': 'eba_BT:x21' }],
];

// Tiers hors registre DORA et leurs prestations (fictifs).
const OTHER_TIERS = [
  [
    { name: 'Transval Sécurité', category: 'Logistique et sûreté', idType: 'SIREN', identifier: '412345678', country: 'FR', contacts: [
      { role: 'Directeur général (DG)', firstName: 'Bertrand', lastName: 'Caron', email: 'b.caron@transval.example', phone: '01 40 00 00 01' },
      { role: 'Responsable commercial', firstName: 'Claire', lastName: 'Martin', email: 'claire.martin@transval.example', phone: '06 12 34 56 78' },
      { role: 'Délégué à la protection des données (DPO)', firstName: 'Hugo', lastName: 'Perrin', email: 'dpo@transval.example', phone: '' },
    ] },
    [
      { title: 'Transport de fonds et approvisionnement des automates', domain: 'Logistique et sûreté', org: 'OPS', start: '2023-01-01', end: '2026-12-31', annualCost: '410000', nextReview: '2026-06-30', qualifications: { PECI: { note: 'Indispensable à la disponibilité des espèces' }, PBE: {} } },
    ],
  ],
  [
    { name: 'Éditique Nord', category: 'Prestataire de services', idType: 'SIREN', identifier: '523456789', country: 'FR', contacts: [{ role: 'Interlocuteur opérationnel', firstName: 'Paul', lastName: 'Lefèvre', email: 'p.lefevre@editique-nord.example', phone: '03 20 00 00 10' }] },
    [
      { title: 'Impression et envoi des relevés de compte', domain: 'Relation client', org: 'OPS', start: '2022-04-01', end: '2027-03-31', annualCost: '180000', nextReview: '2025-12-31', qualifications: { PECI: {}, ABE: { critical: true, note: 'Information réglementaire des clients' } } },
    ],
  ],
  [
    { name: 'Banque Partenaire Europe', category: 'Établissement financier', idType: 'LEI', identifier: makeLei('969500PARTENAIRE01'), country: 'BE' },
    [
      { title: 'Compensation et règlement des virements SEPA', domain: 'Paiements', org: 'FIN', start: '2020-01-01', annualCost: '950000', nextReview: '2026-03-31', qualifications: { PBE: {}, PECI: {}, RES: { critical: true, note: 'Accès aux systèmes de paiement' }, ABE: { critical: true } } },
      { title: 'Tenue de compte nostro en devises', domain: 'Paiements', org: 'FIN', start: '2021-06-01', qualifications: { PBE: {}, RES: {} } },
    ],
  ],
  [
    { name: 'Archives & Co', category: 'Services généraux', idType: 'SIREN', identifier: '634567890', country: 'FR' },
    [{ title: 'Archivage physique des dossiers de crédit', domain: 'Back-office', org: 'OPS', start: '2019-09-01', end: '2025-08-31', status: 'terminee', annualCost: '35000', qualifications: { ABE: {} } }],
  ],
  [
    { name: 'Cabinet Delorme Conseil', category: 'Conseil et audit', idType: 'SIREN', identifier: '745678901', country: 'FR' },
    [{ title: 'Accompagnement à la mise en conformité DORA', domain: 'Conformité et risques', org: 'RISK', start: '2025-02-01', end: '2026-01-31', annualCost: '60000', qualifications: {} }],
  ],
];

// Organisation de la structure (fictive) : directions COMEX et responsables de tiers.
const DIRECTIONS = [
  ['OPS', 'Direction des Opérations', 'Sophie Bernard', ['Julie', 'Petit', 'julie.petit@banque-exemple.example', '01 45 00 10 01']],
  ['DSI', 'Direction des Systèmes d’Information', 'Marc Dubois', ['Thomas', 'Roux', 'thomas.roux@banque-exemple.example', '01 45 00 10 02']],
  ['FIN', 'Direction Financière', 'Isabelle Moreau', ['Nadia', 'Benali', 'nadia.benali@banque-exemple.example', '01 45 00 10 03']],
  ['RISK', 'Direction des Risques et de la Conformité', 'Antoine Lambert', ['Éric', 'Fontaine', 'eric.fontaine@banque-exemple.example', '']],
];

function seedOrganisation(db) {
  const org = {};
  DIRECTIONS.forEach(([key, title, head, [firstName, lastName, email, phone]], i) => {
    const directionId = Number(db.prepare('INSERT INTO directions (data, position) VALUES (?, ?)').run(JSON.stringify({ title, head }), i).lastInsertRowid);
    const managerId = Number(
      db.prepare('INSERT INTO tiers_managers (data) VALUES (?)').run(JSON.stringify({ firstName, lastName, email, phone, directionId })).lastInsertRowid,
    );
    org[key] = { directionId, managerId };
  });
  return org;
}

const EXTRA_QUALIFS = {
  'CTR-2024-001': { PECI: { note: 'Hébergement des systèmes de paiement' }, ABE: { critical: true }, RES: { critical: true } },
  'CTR-2024-002': { PECI: {}, ABE: { critical: true } },
};

function seedTiers(db) {
  const org = seedOrganisation(db);
  const ids = [];
  for (const [tiers, prestations] of OTHER_TIERS) {
    const id = insertTiers(db, { contacts: [], group: '', notes: '', doraCode: '', ...tiers }, null);
    ids.push(id);
    for (const { org: key, ...p } of prestations) {
      insertPrestation(db, id, { description: '', entity: 'Banque Exemple SA', status: 'active', start: '', end: '', annualCost: '', nextReview: '', doraContract: '', owner: '', ...org[key], ...p }, null);
    }
  }
  syncFromDora(db, null);
  for (const p of allPrestations(db)) {
    const extra = EXTRA_QUALIFS[p.data.doraContract];
    if (extra) updatePrestation(db, p.id, p.tiers_id, { ...p.data, ...org.DSI, nextReview: '2026-09-30', qualifications: { ...p.data.qualifications, ...extra } }, null);
  }
  return ids;
}

export function seedDemo(db) {
  return tx(db, () => {
    const ids = DATA.map(([tbl, d]) => [tbl, insertRecord(db, tbl, fill(tbl, d), null)]);
    const providers = ids.filter(([t]) => t === 'b_05.01').map(([, id]) => id);
    const tiers = seedTiers(db);
    const users = [
      ['admin.global', 'Administrateur global (démo)', 'global_admin', [], []],
      ['lecteur.global', 'Lecteur global (démo)', 'global_reader', [], []],
      ['admin.tiers', 'Administrateur de tiers (démo)', 'tiers_admin', [providers[0], providers[2]], [tiers[0]]],
      ['lecteur.tiers', 'Lecteur des tiers rattachés (démo)', 'tiers_reader', [providers[1]], [tiers[1]]],
    ];
    const hash = hashPassword(DEMO_PASSWORD);
    for (const [username, name, role, pids, tids] of users) {
      const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      const uid = exists
        ? exists.id
        : Number(
            db
              .prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
              .run(username, name, hash, role).lastInsertRowid,
          );
      for (const pid of pids) db.prepare('INSERT OR IGNORE INTO user_providers VALUES (?, ?)').run(uid, pid);
      for (const tid of tids) db.prepare('INSERT OR IGNORE INTO user_tiers VALUES (?, ?)').run(uid, tid);
    }
    return { records: ids.length, users: users.map((u) => u[0]) };
  });
}
