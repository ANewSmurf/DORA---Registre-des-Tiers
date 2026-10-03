// Tiers (toutes les entreprises qui fournissent une prestation) et prestations qualifiées
// DORA, PECI, PBE, Résolution ou Externalisation ABE.
import ExcelJS from 'exceljs';
import { schema } from './schema.js';
import { allRecords, audit } from './db.js';
import { computeScope, isGlobal } from './access.js';
import { STATUS_BY_CODE } from '../public/shared/tiers-model.js';

const YES = 'eba_BT:x28';

const parse = (r) => ({ ...r, data: JSON.parse(r.data) });

export function allTiers(db) {
  return db.prepare('SELECT * FROM tiers ORDER BY id').all().map(parse);
}
export function allPrestations(db) {
  return db.prepare('SELECT * FROM prestations ORDER BY id').all().map(parse);
}
export function getTiers(db, id) {
  const r = db.prepare('SELECT * FROM tiers WHERE id = ?').get(id);
  return r ? parse(r) : null;
}
export function getPrestation(db, id) {
  const r = db.prepare('SELECT * FROM prestations WHERE id = ?').get(id);
  return r ? parse(r) : null;
}

export function insertTiers(db, data, userId) {
  return Number(db.prepare('INSERT INTO tiers (data, updated_by) VALUES (?, ?)').run(JSON.stringify(data), userId ?? null).lastInsertRowid);
}
export function updateTiers(db, id, data, userId) {
  db.prepare("UPDATE tiers SET data = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(JSON.stringify(data), userId ?? null, id);
}
export function insertPrestation(db, tiersId, data, userId) {
  return Number(
    db.prepare('INSERT INTO prestations (tiers_id, data, updated_by) VALUES (?, ?, ?)').run(tiersId, JSON.stringify(data), userId ?? null)
      .lastInsertRowid,
  );
}
export function updatePrestation(db, id, tiersId, data, userId) {
  db.prepare("UPDATE prestations SET tiers_id = ?, data = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?").run(
    tiersId,
    JSON.stringify(data),
    userId ?? null,
    id,
  );
}

/**
 * Identifiants des tiers visibles par un utilisateur rattaché ; null pour un profil global.
 * Un tiers est dans le périmètre s'il est rattaché directement à l'utilisateur ou s'il correspond
 * à l'un de ses prestataires TIC du registre DORA.
 */
export function tiersScope(db, user) {
  if (isGlobal(user)) return null;
  const scope = computeScope(user, allRecords(db));
  const ids = new Set(user.tiersIds || []);
  for (const t of allTiers(db)) if (t.data.doraCode && scope.providerCodes.has(t.data.doraCode)) ids.add(t.id);
  return ids;
}

export const canEditTiers = (user, scopeIds, tiersId) =>
  user.role === 'global_admin' || (user.role === 'tiers_admin' && scopeIds?.has(tiersId));

const listLabel = (list, code) => {
  const it = schema.lists[list]?.find((x) => x.code === code);
  return it ? it.fr || it.label : code;
};

function idTypeOf(codeType) {
  if (codeType === 'LEI' || codeType === 'EUID') return codeType;
  if (/_CRN$/.test(codeType || '')) return codeType.startsWith('FR') ? 'SIREN' : 'Autre';
  if (/_VAT$/.test(codeType || '')) return 'TVA';
  return codeType ? 'Autre' : '';
}

/**
 * Crée les tiers et prestations qualifiées DORA correspondant au registre d'information :
 * un tiers par prestataire TIC (b_05.01), une prestation par accord et prestataire (b_02.02).
 * Les tiers et prestations déjà reliés au registre sont conservés tels quels.
 */
export function syncFromDora(db, user) {
  const t = {};
  for (const r of allRecords(db)) (t[r.tbl] ||= []).push(r.data);
  const tiers = allTiers(db);
  const byDora = new Map();
  for (const x of tiers) {
    if (x.data.doraCode) byDora.set(x.data.doraCode, x.id);
  }
  const byIdentifier = new Map(tiers.filter((x) => x.data.identifier).map((x) => [x.data.identifier.toUpperCase(), x]));
  let newTiers = 0;
  let linkedTiers = 0;
  let newPrestations = 0;

  for (const p of t['b_05.01'] || []) {
    const code = p['b_05.01.0010'];
    if (!code || byDora.has(code)) continue;
    const existing = byIdentifier.get(code.toUpperCase());
    if (existing) {
      updateTiers(db, existing.id, { ...existing.data, doraCode: code }, user?.id);
      byDora.set(code, existing.id);
      linkedTiers++;
      continue;
    }
    const country = (/^eba_GA:([A-Z]{2})$/.exec(p['b_05.01.0050'] || '') || [])[1] || '';
    const id = insertTiers(
      db,
      {
        name: p['b_05.01.0030'] || code,
        category: 'Prestataire informatique',
        idType: idTypeOf(p['b_05.01.0020']),
        identifier: code,
        country,
        group: p['b_05.01.0080'] || '',
        contacts: [],
        notes: '',
        doraCode: code,
      },
      user?.id,
    );
    byDora.set(code, id);
    newTiers++;
  }

  const general = new Map((t['b_02.01'] || []).map((g) => [g['b_02.01.0010'], g]));
  const fnCritical = new Map((t['b_06.01'] || []).map((f) => [f['b_06.01.0010'], f['b_06.01.0050'] === YES]));
  const entities = new Map((t['b_01.02'] || []).map((e) => [e['b_01.02.0010'], e['b_01.02.0020']]));
  const groups = new Map();
  for (const d of t['b_02.02'] || []) {
    const key = `${d['b_02.02.0010']}|${d['b_02.02.0030']}`;
    if (!groups.has(key)) groups.set(key, { ref: d['b_02.02.0010'], provider: d['b_02.02.0030'], rows: [] });
    groups.get(key).rows.push(d);
  }
  const existing = new Set(allPrestations(db).filter((p) => p.data.doraContract).map((p) => `${p.data.doraContract}|${p.tiers_id}`));
  const today = new Date().toISOString().slice(0, 10);
  for (const g of groups.values()) {
    const tiersId = byDora.get(g.provider);
    if (!tiersId || !g.ref || existing.has(`${g.ref}|${tiersId}`)) continue;
    const uniq = (arr) => [...new Set(arr.filter(Boolean))];
    const services = uniq(g.rows.map((d) => d['b_02.02.0060'])).map((s) => listLabel('LISTANNEXIII', s));
    const starts = uniq(g.rows.map((d) => d['b_02.02.0070'])).sort();
    const ends = uniq(g.rows.map((d) => d['b_02.02.0080'])).sort();
    const end = ends.at(-1) && !ends.at(-1).startsWith('9999') && !ends.at(-1).startsWith('2999') ? ends.at(-1) : '';
    const amount = general.get(g.ref)?.['b_02.01.0050'] || '';
    insertPrestation(
      db,
      tiersId,
      {
        title: services.join(', ') || `Contrat ${g.ref}`,
        description: '',
        domain: 'Informatique et données',
        entity: uniq(g.rows.map((d) => entities.get(d['b_02.02.0020']) || d['b_02.02.0020'])).join(', '),
        directionId: null,
        managerId: null,
        owner: '',
        status: end && end < today ? 'terminee' : 'active',
        start: starts[0] || '',
        end,
        annualCost: amount,
        nextReview: '',
        doraContract: g.ref,
        qualifications: {
          DORA: { critical: g.rows.some((d) => fnCritical.get(d['b_02.02.0050'])), note: '' },
        },
      },
      user?.id,
    );
    existing.add(`${g.ref}|${tiersId}`);
    newPrestations++;
  }
  const summary = { newTiers, linkedTiers, newPrestations };
  if (newTiers || linkedTiers || newPrestations) audit(db, user, 'reprise du registre DORA dans les tiers', { detail: summary });
  return summary;
}

/** Classeur Excel des tiers et prestations (une colonne Oui/Non par qualification). */
export async function exportTiersWorkbook(tiers, prestations, regulations, orgLabels = () => ({})) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Registre des tiers';
  const head = (ws, cols) => {
    ws.columns = cols.map(([header, key, width]) => ({ header, key, width: width || 18 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
  };
  const wsT = wb.addWorksheet('Tiers');
  head(wsT, [
    ['Tiers', 'name', 36],
    ['Catégorie', 'category', 24],
    ['Type d’identifiant', 'idType'],
    ['Identifiant', 'identifier', 24],
    ['Pays', 'country', 8],
    ['Groupe', 'group', 24],
    ['Contacts', 'contactCount', 10],
    ['Prestations', 'count', 12],
    ...regulations.map((q) => [q.label, q.code, 12]),
    ['Notes', 'notes', 40],
  ]);
  const byTiers = new Map();
  for (const p of prestations) (byTiers.get(p.tiers_id) || byTiers.set(p.tiers_id, []).get(p.tiers_id)).push(p);
  for (const t of tiers) {
    const own = byTiers.get(t.id) || [];
    const row = { ...t.data, count: own.length, contactCount: (t.data.contacts || []).length };
    for (const q of regulations) row[q.code] = own.some((p) => p.data.qualifications?.[q.code]) ? 'Oui' : 'Non';
    wsT.addRow(row);
  }
  const wsP = wb.addWorksheet('Prestations');
  head(wsP, [
    ['Tiers', 'tiers', 32],
    ['Prestation', 'title', 40],
    ['Domaine', 'domain', 22],
    ['Entité bénéficiaire', 'entity', 26],
    ['Direction COMEX', 'direction', 28],
    ['Responsable COMEX', 'comexHead', 22],
    ['Responsable du tiers', 'manager', 22],
    ['Statut', 'status', 12],
    ['Début', 'start', 12],
    ['Fin', 'end', 12],
    ['Coût annuel', 'annualCost', 14],
    ['Prochaine revue', 'nextReview', 14],
    ['Contrat DORA', 'doraContract', 18],
    ...regulations.flatMap((q) => [[q.label, q.code, 12], ...(q.criticalLabel ? [[`${q.label} – critique`, `${q.code}_crit`, 14]] : [])]),
    ['Description', 'description', 40],
  ]);
  const names = new Map(tiers.map((t) => [t.id, t.data.name]));
  for (const p of prestations) {
    const d = p.data;
    const row = { ...d, ...orgLabels(d), tiers: names.get(p.tiers_id), status: STATUS_BY_CODE[d.status]?.label || d.status };
    row.annualCost = d.annualCost ? Number(d.annualCost) : null;
    for (const q of regulations) {
      const v = d.qualifications?.[q.code];
      row[q.code] = v ? 'Oui' : 'Non';
      if (q.criticalLabel) row[`${q.code}_crit`] = v ? (v.critical ? 'Oui' : 'Non') : '';
    }
    wsP.addRow(row);
  }
  const wsC = wb.addWorksheet('Contacts des tiers');
  head(wsC, [
    ['Tiers', 'tiers', 32],
    ['Fonction', 'role', 30],
    ['Prénom', 'firstName', 16],
    ['Nom', 'lastName', 20],
    ['E-mail', 'email', 30],
    ['Téléphone', 'phone', 18],
  ]);
  for (const t of tiers) for (const c of t.data.contacts || []) wsC.addRow({ ...c, tiers: t.data.name });
  return wb.xlsx.writeBuffer();
}
