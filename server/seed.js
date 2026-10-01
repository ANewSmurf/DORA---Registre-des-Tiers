// Données et comptes de démonstration (fictifs).
import { hashPassword } from './auth.js';
import { insertRecord, tx } from './db.js';
import { tableByCode } from './schema.js';

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

export function seedDemo(db) {
  return tx(db, () => {
    const ids = DATA.map(([tbl, d]) => [tbl, insertRecord(db, tbl, fill(tbl, d), null)]);
    const providers = ids.filter(([t]) => t === 'b_05.01').map(([, id]) => id);
    const users = [
      ['admin.global', 'Administrateur global (démo)', 'global_admin', []],
      ['lecteur.global', 'Lecteur global (démo)', 'global_reader', []],
      ['admin.tiers', 'Administrateur de tiers (démo)', 'tiers_admin', [providers[0], providers[2]]],
      ['lecteur.tiers', 'Lecteur des tiers rattachés (démo)', 'tiers_reader', [providers[1]]],
    ];
    const hash = hashPassword(DEMO_PASSWORD);
    for (const [username, name, role, pids] of users) {
      const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      const uid = exists
        ? exists.id
        : Number(
            db
              .prepare('INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)')
              .run(username, name, hash, role).lastInsertRowid,
          );
      for (const pid of pids) db.prepare('INSERT OR IGNORE INTO user_providers VALUES (?, ?)').run(uid, pid);
    }
    return { records: ids.length, users: users.map((u) => u[0]) };
  });
}
