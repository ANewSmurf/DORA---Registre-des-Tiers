// Contrôles de complétude et de cohérence du registre (règles du template + références croisées).
import { schema, tableByCode, REFS, CODE_TYPE_PAIRS } from './schema.js';
import { validateRow, isEmpty } from '../public/shared/validate.js';

const YES = 'eba_BT:x28';
const BRANCH = 'eba_ZZ:x838';
const HARD_TO_SUBSTITUTE = ['eba_ZZ:x959', 'eba_ZZ:x960'];

function issue(record, column, level, message) {
  return { recordId: record.id, table: record.tbl, column, level, message };
}

/**
 * Contrôle un ensemble de lignes. `reference` contient toutes les lignes servant de
 * référentiel (pour ne pas signaler à tort une référence hors du périmètre de l'utilisateur).
 */
export function runChecks(records, reference = records) {
  const issues = [];
  const values = {};
  for (const r of reference) {
    for (const [code, v] of Object.entries(r.data)) {
      if (!isEmpty(v)) (values[code] ||= new Set()).add(String(v).trim());
    }
  }
  const has = (col, v) => values[col]?.has(String(v).trim());
  const providerType = new Map();
  for (const r of reference.filter((x) => x.tbl === 'b_05.01')) {
    providerType.set(r.data['b_05.01.0010'], r.data['b_05.01.0020']);
  }

  const seenKeys = {};
  for (const r of records) {
    const table = tableByCode[r.tbl];
    if (!table) continue;
    const d = r.data;

    // 1. Format et caractère obligatoire de chaque champ.
    for (const [col, msg] of Object.entries(validateRow(schema, table, d))) {
      issues.push(issue(r, col, msg === 'Champ obligatoire' ? 'incomplet' : 'erreur', msg));
    }

    // 2. Références vers les autres tableaux.
    for (const col of table.columns) {
      const ref = REFS[col.code];
      const v = d[col.code];
      if (!ref || isEmpty(v) || has(ref.column, v)) continue;
      issues.push(issue(r, col.code, 'erreur', `« ${v} » est absent du tableau ${ref.table} (${ref.column})`));
    }

    // 3. Type de code cohérent avec la fiche prestataire (b_05.01).
    for (const [codeCol, typeCol] of Object.entries(CODE_TYPE_PAIRS)) {
      if (!codeCol.startsWith(r.tbl) || r.tbl === 'b_05.01' || codeCol === 'b_05.02.0060') continue;
      const known = providerType.get(d[codeCol]);
      if (known && d[typeCol] && known !== d[typeCol]) {
        issues.push(issue(r, typeCol, 'erreur', `Type de code « ${d[typeCol]} » différent de b_05.01 (« ${known} »)`));
      }
    }

    // 4. Doublons sur la clé fonctionnelle.
    if (table.keys.length) {
      const key = table.keys.map((k) => String(d[k] ?? '').trim()).join('|');
      if (key.replace(/\|/g, '')) {
        const bucket = (seenKeys[r.tbl] ||= new Map());
        if (bucket.has(key)) {
          issues.push(issue(r, table.keys[0], 'erreur', `Doublon de la ligne n°${bucket.get(key)} (même clé)`));
        } else bucket.set(key, r.id);
      }
    }

    // 5. Règles conditionnelles du template.
    const need = (col, cond, why) => {
      if (cond && isEmpty(d[col])) issues.push(issue(r, col, 'incomplet', `Obligatoire : ${why}`));
    };
    if (r.tbl === 'b_02.02') {
      need('b_02.02.0150', d['b_02.02.0140'] === YES, 'stockage de données = Oui');
      const end = d['b_02.02.0080'];
      const today = new Date().toISOString().slice(0, 10);
      need('b_02.02.0090', end && end < today, 'accord terminé (date de fin passée)');
    }
    if (r.tbl === 'b_02.01') need('b_02.01.0030', d['b_02.01.0020'] === 'eba_CO:x3', 'accord subséquent ou associé');
    if (r.tbl === 'b_04.01') need('b_04.01.0040', d['b_04.01.0030'] === BRANCH, 'entité utilisatrice = succursale');
    if (r.tbl === 'b_05.01') need('b_05.01.0060', !isEmpty(d['b_05.01.0070']), 'montant 0070 renseigné');
    if (r.tbl === 'b_05.02' && Number(d['b_05.02.0050']) > 1) {
      need('b_05.02.0060', true, 'rang > 1');
      need('b_05.02.0070', true, 'rang > 1');
    }
    if (r.tbl === 'b_07.01') {
      need('b_07.01.0060', HARD_TO_SUBSTITUTE.includes(d['b_07.01.0050']), 'prestataire non ou difficilement substituable');
    }
  }

  // 6. Accords sans informations spécifiques (b_02.02).
  for (const r of records.filter((x) => x.tbl === 'b_02.01')) {
    const ref = r.data['b_02.01.0010'];
    if (ref && !has('b_02.02.0010', ref)) {
      issues.push(issue(r, 'b_02.01.0010', 'avertissement', 'Aucune ligne b_02.02 pour cet accord'));
    }
  }
  return issues;
}
