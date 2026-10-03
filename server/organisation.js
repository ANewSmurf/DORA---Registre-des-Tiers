// Organisation de la structure : directions représentées au COMEX et responsables de tiers,
// gérées par l'administrateur global et reprises dans la description des prestations.
import { personName } from '../public/shared/tiers-model.js';

const parse = (r) => ({ id: r.id, ...JSON.parse(r.data) });

export function listDirections(db) {
  return db.prepare('SELECT * FROM directions ORDER BY position, id').all().map(parse);
}
export function getDirection(db, id) {
  const r = db.prepare('SELECT * FROM directions WHERE id = ?').get(id);
  return r ? parse(r) : null;
}
export function listManagers(db) {
  return db
    .prepare('SELECT * FROM tiers_managers ORDER BY id')
    .all()
    .map(parse)
    .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`, 'fr'));
}
export function getManager(db, id) {
  const r = db.prepare('SELECT * FROM tiers_managers WHERE id = ?').get(id);
  return r ? parse(r) : null;
}

/** Organisation complète, avec le nombre de prestations (et de responsables) rattachés. */
export function getOrganisation(db) {
  const prestations = db.prepare('SELECT data FROM prestations').all().map((r) => JSON.parse(r.data));
  const managers = listManagers(db);
  const count = (key, id) => prestations.filter((p) => p[key] === id).length;
  return {
    directions: listDirections(db).map((d) => ({
      ...d,
      usage: count('directionId', d.id),
      managers: managers.filter((m) => m.directionId === d.id).length,
    })),
    managers: managers.map((m) => ({ ...m, usage: count('managerId', m.id) })),
  };
}

/** Libellés de l'organisation interne d'une prestation (pour les exports). */
export function organisationLabels(db) {
  const directions = new Map(listDirections(db).map((d) => [d.id, d]));
  const managers = new Map(listManagers(db).map((m) => [m.id, m]));
  return (p) => {
    const d = directions.get(p.directionId);
    return { direction: d?.title || '', comexHead: d?.head || '', manager: personName(managers.get(p.managerId)) || p.owner || '' };
  };
}
