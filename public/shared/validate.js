// Contrôles de saisie d'une ligne du registre, partagés entre le serveur et le navigateur.

const listCache = new WeakMap();

function listSet(schema, name) {
  let cache = listCache.get(schema);
  if (!cache) listCache.set(schema, (cache = {}));
  if (!cache[name]) cache[name] = new Set((schema.lists[name] || []).map((i) => i.code));
  return cache[name];
}

/** Clé de contrôle ISO 17442 (ISO 7064 MOD 97-10) d'un LEI. */
export function isValidLei(value) {
  if (!/^[A-Z0-9]{18}[0-9]{2}$/.test(value)) return false;
  const digits = value.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  return rest === 1;
}

export const CODE_TYPE_RE = /^(LEI|EUID|[A-Z]{2}_(CRN|VAT|PNR|NIN))$/;
// Format EBA d'un identifiant de fonction (F suivi d'un nombre). Dans le registre, l'entité peut garder
// son identifiant local (ex. BRED-CRIT-F4) : l'export au format EBA lui attribue un identifiant conforme.
export const FUNCTION_RE = /^F[0-9]+$/;
export const LOCAL_FUNCTION_RE = /^[\p{L}\p{N}][\p{L}\p{N} ._\/-]{0,99}$/u;

export function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function isEmpty(v) {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** Vérifie la valeur d'une colonne ; renvoie un message d'erreur ou null. */
export function checkValue(schema, col, value, row = {}) {
  if (isEmpty(value)) return col.required ? 'Champ obligatoire' : null;
  const v = typeof value === 'string' ? value.trim() : value;
  switch (col.kind) {
    case 'list':
      return listSet(schema, col.list).has(v) ? null : 'Valeur absente de la liste du template';
    case 'date':
      return isValidDate(String(v)) ? null : 'Date attendue au format AAAA-MM-JJ';
    case 'money':
      return Number.isFinite(Number(v)) ? null : 'Montant numérique attendu';
    case 'int':
      return /^\d+$/.test(String(v)) ? null : 'Entier positif ou nul attendu';
    case 'function':
      return LOCAL_FUNCTION_RE.test(v) ? null : 'Identifiant de 1 à 100 caractères : lettres, chiffres, espace, . _ / -';
    case 'codeType':
      if (col.code === 'b_05.02.0070' && v === 'Not applicable') return null;
      return CODE_TYPE_RE.test(v) ? null : 'Format attendu : LEI, EUID ou PAYS_TYPE (ex. FR_CRN, DE_VAT)';
    case 'lei':
      return isValidLei(String(v)) ? null : 'LEI invalide (20 caractères, clé ISO 17442)';
    case 'text': {
      // Un code prestataire de type LEI doit être un LEI valide.
      const typeCol = col.codeType;
      if (typeCol && row[typeCol] === 'LEI' && !isValidLei(String(v))) {
        return 'Le type de code est « LEI » : LEI invalide (20 caractères, clé ISO 17442)';
      }
      return null;
    }
    default:
      return null;
  }
}

/** Valide une ligne complète ; renvoie { col: message }. */
export function validateRow(schema, table, row) {
  const errors = {};
  for (const col of table.columns) {
    if (col.kind === 'link') continue;
    const msg = checkValue(schema, col, row[col.code], row);
    if (msg) errors[col.code] = msg;
  }
  return errors;
}
