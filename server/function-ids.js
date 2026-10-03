// Identifiants de fonction : l'entité garde son identifiant local (ex. BRED-CRIT-F4) dans le registre ;
// l'export au format EBA utilise un identifiant conforme (F suivi d'un nombre), attribué une fois pour
// toutes et conservé d'un export à l'autre.
import { FUNCTION_RE } from '../public/shared/validate.js';

export function listFunctionIds(db) {
  return db.prepare('SELECT local, eba FROM function_ids ORDER BY CAST(SUBSTR(eba, 2) AS INTEGER)').all();
}

/** Renvoie la correspondance identifiant local → identifiant EBA, en attribuant ceux qui manquent. */
export function ebaFunctionIds(db, localIds) {
  const known = new Map(listFunctionIds(db).map((r) => [r.local, r.eba]));
  const used = new Set(known.values());
  const insert = db.prepare('INSERT INTO function_ids (local, eba) VALUES (?, ?)');
  const ids = [...new Set(localIds.filter(Boolean).map((v) => String(v).trim()))];
  // Les identifiants déjà conformes sont réservés tels quels, avant toute numérotation.
  for (const id of ids) {
    if (!known.has(id) && FUNCTION_RE.test(id) && !used.has(id)) {
      insert.run(id, id);
      known.set(id, id);
      used.add(id);
    }
  }
  let next = Math.max(0, ...[...used].map((v) => Number(v.slice(1)) || 0)) + 1;
  for (const id of ids) {
    if (known.has(id)) continue;
    while (used.has(`F${next}`)) next++;
    insert.run(id, `F${next}`);
    known.set(id, `F${next}`);
    used.add(`F${next}`);
  }
  return known;
}
