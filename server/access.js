// Droits par profil et périmètre des tiers rattachés.
//
// - global_admin  : lecture/écriture de tout le registre, utilisateurs, import, journal.
// - global_reader : lecture de tout le registre, export.
// - tiers_admin   : lecture/écriture des données liées à ses prestataires TIC rattachés
//                   (+ lecture du référentiel entités/fonctions).
// - tiers_reader  : lecture des données liées à ses prestataires TIC rattachés
//                   (+ lecture du référentiel entités/fonctions).
import { REFERENTIAL_TABLES } from './schema.js';

export const isGlobal = (user) => user.role === 'global_admin' || user.role === 'global_reader';
export const canManageUsers = (user) => user.role === 'global_admin';
export const canImport = (user) => user.role === 'global_admin';

export function canWriteTable(user, tbl) {
  if (user.role === 'global_admin') return true;
  if (user.role === 'tiers_admin') return !REFERENTIAL_TABLES.includes(tbl);
  return false;
}

const byTable = (records) => {
  const out = {};
  for (const r of records) (out[r.tbl] ||= []).push(r);
  return out;
};

/** Calcule le périmètre d'un utilisateur rattaché à des tiers ; null pour un profil global. */
export function computeScope(user, records) {
  if (isGlobal(user)) return null;
  const t = byTable(records);
  const providerIds = new Set(user.providerIds);
  const providerCodes = new Set(
    (t['b_05.01'] || []).filter((r) => providerIds.has(r.id)).map((r) => r.data['b_05.01.0010']).filter(Boolean),
  );
  const contracts = new Set();
  const functions = new Set();
  for (const r of t['b_02.02'] || []) {
    if (providerCodes.has(r.data['b_02.02.0030'])) {
      contracts.add(r.data['b_02.02.0010']);
      functions.add(r.data['b_02.02.0050']);
    }
  }
  for (const r of t['b_03.02'] || []) {
    if (providerCodes.has(r.data['b_03.02.0020'])) contracts.add(r.data['b_03.02.0010']);
  }
  contracts.delete(undefined);
  functions.delete(undefined);
  return { providerIds, providerCodes, contracts, functions };
}

/** La ligne appartient-elle au périmètre (hors référentiel) ? */
export function inScope(scope, tbl, data, id) {
  if (!scope) return true;
  const P = scope.providerCodes;
  const C = scope.contracts;
  switch (tbl) {
    case 'b_05.01':
      return scope.providerIds.has(id);
    case 'b_02.02':
      return P.has(data['b_02.02.0030']);
    case 'b_03.02':
      return P.has(data['b_03.02.0020']) || C.has(data['b_03.02.0010']);
    case 'b_07.01':
      return P.has(data['b_07.01.0020']);
    case 'b_05.02':
      return C.has(data['b_05.02.0010']) || P.has(data['b_05.02.0030']);
    case 'b_02.03':
      return C.has(data['b_02.03.0010']) || C.has(data['b_02.03.0020']);
    case 'b_02.01':
    case 'b_03.01':
    case 'b_03.03':
    case 'b_04.01':
      return C.has(data[`${tbl}.0010`]);
    default:
      return false;
  }
}

export function canRead(user, scope, record) {
  if (isGlobal(user)) return true;
  if (REFERENTIAL_TABLES.includes(record.tbl)) return true;
  return inScope(scope, record.tbl, record.data, record.id);
}

export function visibleRecords(user, records) {
  const scope = computeScope(user, records);
  return records.filter((r) => canRead(user, scope, r));
}
