// Schéma enrichi du registre : structure extraite du template EBA (schema.json)
// + libellés français, nature de chaque champ, caractère obligatoire et références croisées.
import { readFileSync } from 'node:fs';
import { TABLES_FR, COLUMNS_FR, TYPES_FR, CONDITIONS_FR, VALUES_FR } from './labels-fr.js';

const raw = JSON.parse(readFileSync(new URL('./schema.json', import.meta.url), 'utf8'));

// Colonnes « code d'identification » → colonne « type de code » associée.
export const CODE_TYPE_PAIRS = {
  'b_05.01.0010': 'b_05.01.0020',
  'b_05.01.0080': 'b_05.01.0090',
  'b_02.02.0030': 'b_02.02.0040',
  'b_03.02.0020': 'b_03.02.0030',
  'b_05.02.0030': 'b_05.02.0040',
  'b_05.02.0060': 'b_05.02.0070',
  'b_07.01.0020': 'b_07.01.0030',
};

const CONTRACT = { table: 'b_02.01', column: 'b_02.01.0010' };
const ENTITY = { table: 'b_01.02', column: 'b_01.02.0010' };
const PROVIDER = { table: 'b_05.01', column: 'b_05.01.0010' };

// Références vers d'autres tableaux (suggestions dans les formulaires et contrôles de cohérence).
export const REFS = {
  'b_01.03.0020': ENTITY,
  'b_02.01.0030': CONTRACT,
  'b_02.02.0010': CONTRACT,
  'b_02.02.0020': ENTITY,
  'b_02.02.0030': PROVIDER,
  'b_02.02.0050': { table: 'b_06.01', column: 'b_06.01.0010' },
  'b_02.03.0010': CONTRACT,
  'b_02.03.0020': CONTRACT,
  'b_03.01.0010': CONTRACT,
  'b_03.01.0020': ENTITY,
  'b_03.02.0010': CONTRACT,
  'b_03.02.0020': PROVIDER,
  'b_03.03.0010': CONTRACT,
  'b_03.03.0020': ENTITY,
  'b_04.01.0010': CONTRACT,
  'b_04.01.0020': ENTITY,
  'b_04.01.0040': { table: 'b_01.03', column: 'b_01.03.0010' },
  'b_05.02.0010': CONTRACT,
  'b_05.02.0030': PROVIDER,
  'b_06.01.0040': ENTITY,
  'b_07.01.0010': CONTRACT,
  'b_07.01.0020': PROVIDER,
};

// Colonnes formant la clé fonctionnelle d'une ligne (contrôle des doublons).
export const KEYS = {
  'b_01.01': ['b_01.01.0010'],
  'b_01.02': ['b_01.02.0010'],
  'b_01.03': ['b_01.03.0010', 'b_01.03.0020'],
  'b_02.01': ['b_02.01.0010'],
  'b_02.02': ['b_02.02.0010', 'b_02.02.0020', 'b_02.02.0030', 'b_02.02.0050', 'b_02.02.0060'],
  'b_02.03': ['b_02.03.0010', 'b_02.03.0020'],
  'b_03.01': ['b_03.01.0010', 'b_03.01.0020'],
  'b_03.02': ['b_03.02.0010', 'b_03.02.0020'],
  'b_03.03': ['b_03.03.0010', 'b_03.03.0020'],
  'b_04.01': ['b_04.01.0010', 'b_04.01.0020', 'b_04.01.0040'],
  'b_05.01': ['b_05.01.0010', 'b_05.01.0020'],
  'b_05.02': ['b_05.02.0010', 'b_05.02.0020', 'b_05.02.0030', 'b_05.02.0050', 'b_05.02.0060'],
  'b_06.01': ['b_06.01.0010'],
  'b_07.01': ['b_07.01.0010', 'b_07.01.0020', 'b_07.01.0040'],
};

// Tableaux de référentiel (entités, fonctions) : lisibles par tous, modifiables par l'administrateur global.
export const REFERENTIAL_TABLES = ['b_01.01', 'b_01.02', 'b_01.03', 'b_06.01'];

// Colonnes marquées « Mandatory » dans le template mais dont la consigne les rend conditionnelles.
const CONDITIONAL = {
  'b_02.01.0030': "Obligatoire si l'accord est « Subsequent or associated arrangement » (sans objet sinon)",
};

function kindOf(col) {
  const type = col.type || '';
  if (type.startsWith('Fill with')) return 'link';
  if (col.list) return 'list';
  if (type === 'Date') return 'date';
  if (type === 'Monetary') return 'money';
  if (type === 'Natural number') return 'int';
  if (type === 'Pattern') {
    return col.code === 'b_06.01.0010' || col.code === 'b_02.02.0050' ? 'function' : 'codeType';
  }
  if (/\bLEI\b/.test(col.name || '') && !/Identification code/i.test(col.name || '')) return 'lei';
  return 'text';
}

function buildSchema() {
  const tables = raw.tables.map((t) => {
    const fr = TABLES_FR[t.code] || {};
    return {
      code: t.code,
      template: t.title,
      title: fr.title || t.title,
      group: fr.group || 'Autres',
      referential: REFERENTIAL_TABLES.includes(t.code),
      keys: KEYS[t.code] || [],
      columns: t.columns.map((c) => {
        const option = (c.option || '').trim();
        const kind = kindOf(c);
        return {
          code: c.code,
          short: c.code.slice(-4),
          label: COLUMNS_FR[c.code] || c.name,
          name: c.name,
          type: c.type,
          typeLabel: TYPES_FR[kind === 'link' ? 'link' : c.type] || c.type,
          kind,
          list: c.list || null,
          required: option === 'Mandatory' && !CONDITIONAL[c.code],
          condition:
            CONDITIONAL[c.code] ||
            (option && option !== 'Mandatory' && option !== 'Optional' ? CONDITIONS_FR[option] || option : null),
          instruction: c.instruction,
          ref: REFS[c.code] || null,
          codeType: CODE_TYPE_PAIRS[c.code] || null,
          codeTypeOf: Object.entries(CODE_TYPE_PAIRS).find(([, t2]) => t2 === c.code)?.[0] || null,
        };
      }),
    };
  });
  const lists = Object.fromEntries(
    Object.entries(raw.lists).map(([name, items]) => [
      name,
      items.map((it) => (VALUES_FR[it.code] ? { ...it, fr: VALUES_FR[it.code] } : it)),
    ]),
  );
  // Le format de remise EBA (DPM 4.0) ajoute « Non applicable » aux listes de pays
  // (pays de prestation ou de stockage des données quand il n'y en a pas).
  if (lists.LISTCOUNTRY && !lists.LISTCOUNTRY.some((it) => it.code === 'eba_GA:qx2007')) {
    lists.LISTCOUNTRY.push({ code: 'eba_GA:qx2007', label: 'Not applicable', fr: 'Non applicable' });
  }
  return { source: raw.source, tables, lists };
}

export const schema = buildSchema();
export const tableByCode = Object.fromEntries(schema.tables.map((t) => [t.code, t]));
export const tableCodes = schema.tables.map((t) => t.code);
