// Modèle des tiers et de leurs prestations, partagé entre le navigateur et le serveur.
//
// Un tiers est toute entreprise ou personne qui fournit une prestation, qu'elle relève de DORA ou non.
// Ce sont les prestations qui portent les qualifications réglementaires ; une même prestation peut
// en cumuler plusieurs (par exemple DORA et PECI).

export const QUALIFICATIONS = [
  {
    code: 'DORA',
    label: 'DORA',
    name: 'Service TIC (DORA)',
    desc: 'Service informatique ou de données fourni par un prestataire tiers, à déclarer au registre d’information DORA.',
    criticalLabel: 'Soutient une fonction critique ou importante',
    color: 'blue',
  },
  {
    code: 'PECI',
    label: 'PECI',
    name: 'Prestation essentielle, critique ou importante',
    desc: 'Prestation externalisée jugée essentielle, critique ou importante au titre du contrôle interne.',
    criticalLabel: null,
    color: 'red',
  },
  {
    code: 'PBE',
    label: 'PBE',
    name: 'Prestation bancaire externalisée',
    desc: 'Opération de banque ou service connexe confié à un tiers.',
    criticalLabel: null,
    color: 'purple',
  },
  {
    code: 'RES',
    label: 'Résolution',
    name: 'Résolution bancaire',
    desc: 'Prestation nécessaire à la continuité des fonctions critiques en cas de résolution.',
    criticalLabel: 'Service critique pour la résolution',
    color: 'orange',
  },
  {
    code: 'ABE',
    label: 'Externalisation ABE',
    name: 'Externalisation au sens de l’ABE',
    desc: 'Accord d’externalisation au sens des orientations de l’ABE, à inscrire au registre des externalisations.',
    criticalLabel: 'Fonction critique ou importante',
    color: 'green',
  },
];
export const QUALIF_BY_CODE = Object.fromEntries(QUALIFICATIONS.map((q) => [q.code, q]));

export const TIERS_CATEGORIES = [
  'Prestataire informatique',
  'Prestataire de services',
  'Établissement financier',
  'Société du groupe',
  'Conseil et audit',
  'Logistique et sûreté',
  'Services généraux',
  'Autre',
];

export const ID_TYPES = ['SIREN', 'LEI', 'TVA', 'EUID', 'Autre'];

export const PRESTATION_DOMAINS = [
  'Informatique et données',
  'Paiements',
  'Crédit',
  'Back-office',
  'Relation client',
  'Conformité et risques',
  'Ressources humaines',
  'Logistique et sûreté',
  'Immobilier et services généraux',
  'Autre',
];

export const STATUSES = [
  { code: 'projet', label: 'En projet', cls: '' },
  { code: 'active', label: 'En cours', cls: 'ok' },
  { code: 'terminee', label: 'Terminée', cls: '' },
];
export const STATUS_BY_CODE = Object.fromEntries(STATUSES.map((s) => [s.code, s]));

const str = (v, max = 500) => (v === null || v === undefined ? '' : String(v).trim().slice(0, max));
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Nettoie une fiche tiers ; renvoie { data, errors }. */
export function cleanTiers(input = {}) {
  const data = {
    name: str(input.name, 200),
    category: str(input.category, 80),
    idType: str(input.idType, 20),
    identifier: str(input.identifier, 60),
    country: str(input.country, 2).toUpperCase(),
    group: str(input.group, 200),
    contactName: str(input.contactName, 120),
    contactEmail: str(input.contactEmail, 200),
    notes: str(input.notes, 4000),
    // Code du prestataire TIC dans le registre DORA (b_05.01.0010) quand le tiers y figure.
    doraCode: str(input.doraCode, 60),
  };
  const errors = {};
  if (!data.name) errors.name = 'Le nom du tiers est obligatoire';
  if (data.country && !/^[A-Z]{2}$/.test(data.country)) errors.country = 'Code pays à deux lettres (ex. FR)';
  if (data.contactEmail && !EMAIL_RE.test(data.contactEmail)) errors.contactEmail = 'Adresse e-mail invalide';
  return { data, errors };
}

/** Nettoie une prestation ; renvoie { data, errors }. */
export function cleanPrestation(input = {}) {
  const qualifications = {};
  for (const q of QUALIFICATIONS) {
    const v = input.qualifications?.[q.code];
    if (!v) continue;
    qualifications[q.code] = { critical: !!(q.criticalLabel && v.critical), note: str(v.note, 2000) };
  }
  const data = {
    title: str(input.title, 200),
    description: str(input.description, 4000),
    domain: str(input.domain, 80),
    entity: str(input.entity, 200),
    owner: str(input.owner, 120),
    status: STATUS_BY_CODE[input.status] ? input.status : 'active',
    start: str(input.start, 10),
    end: str(input.end, 10),
    annualCost: str(input.annualCost, 20).replace(',', '.').replace(/\s/g, ''),
    nextReview: str(input.nextReview, 10),
    doraContract: str(input.doraContract, 120),
    qualifications,
  };
  const errors = {};
  if (!data.title) errors.title = 'L’intitulé de la prestation est obligatoire';
  for (const k of ['start', 'end', 'nextReview']) if (data[k] && !DATE_RE.test(data[k])) errors[k] = 'Date au format AAAA-MM-JJ';
  if (data.start && data.end && DATE_RE.test(data.start) && DATE_RE.test(data.end) && data.end < data.start) {
    errors.end = 'La fin précède le début';
  }
  if (data.annualCost && !Number.isFinite(Number(data.annualCost))) errors.annualCost = 'Montant numérique attendu';
  return { data, errors };
}
