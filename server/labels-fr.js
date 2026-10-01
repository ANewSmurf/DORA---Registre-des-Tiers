// Libellés français des tableaux et colonnes du registre d'information DORA.
// Les libellés officiels (anglais) du template EBA restent disponibles dans schema.json
// et sont affichés en aide contextuelle dans l'interface.

export const TABLES_FR = {
  'b_01.01': { title: "Entité tenant le registre d'information", group: 'Entités' },
  'b_01.02': { title: 'Entités dans le périmètre du registre', group: 'Entités' },
  'b_01.03': { title: 'Succursales', group: 'Entités' },
  'b_02.01': { title: 'Accords contractuels – informations générales', group: 'Contrats' },
  'b_02.02': { title: 'Accords contractuels – informations spécifiques', group: 'Contrats' },
  'b_02.03': { title: 'Accords contractuels intragroupe', group: 'Contrats' },
  'b_03.01': { title: 'Entités signataires (bénéficiaires des services TIC)', group: 'Signataires' },
  'b_03.02': { title: 'Prestataires TIC signataires', group: 'Signataires' },
  'b_03.03': { title: 'Entités du groupe signataires (fournisseurs de services TIC)', group: 'Signataires' },
  'b_04.01': { title: 'Entités utilisatrices des services TIC', group: 'Contrats' },
  'b_05.01': { title: 'Prestataires tiers de services TIC', group: 'Tiers' },
  'b_05.02': { title: "Chaînes d'approvisionnement des services TIC", group: 'Tiers' },
  'b_06.01': { title: 'Identification des fonctions', group: 'Fonctions' },
  'b_07.01': { title: 'Évaluation des services TIC', group: 'Tiers' },
};

export const COLUMNS_FR = {
  'b_01.01.0010': "LEI de l'entité tenant le registre",
  'b_01.01.0020': "Nom de l'entité",
  'b_01.01.0030': "Pays de l'entité",
  'b_01.01.0040': "Type d'entité",
  'b_01.01.0050': 'Autorité compétente',
  'b_01.01.0060': 'Date de déclaration',

  'b_01.02.0010': "LEI de l'entité",
  'b_01.02.0020': "Nom de l'entité",
  'b_01.02.0030': "Pays de l'entité",
  'b_01.02.0040': "Type d'entité",
  'b_01.02.0050': "Position de l'entité dans le groupe",
  'b_01.02.0060': "LEI de l'entreprise mère directe",
  'b_01.02.0070': 'Date de dernière mise à jour',
  'b_01.02.0080': "Date d'intégration au registre",
  'b_01.02.0090': 'Date de suppression du registre',
  'b_01.02.0100': 'Devise',
  'b_01.02.0110': "Total de l'actif de l'entité financière",

  'b_01.03.0010': 'Code d’identification de la succursale',
  'b_01.03.0020': "LEI du siège de l'entité financière",
  'b_01.03.0030': 'Nom de la succursale',
  'b_01.03.0040': 'Pays de la succursale',

  'b_02.01.0010': "Référence de l'accord contractuel",
  'b_02.01.0020': "Type d'accord contractuel",
  'b_02.01.0030': "Référence de l'accord-cadre",
  'b_02.01.0040': 'Devise du montant (0050)',
  'b_02.01.0050': 'Dépense annuelle ou coût estimé (année passée)',

  'b_02.02.0010': "Référence de l'accord contractuel",
  'b_02.02.0020': "LEI de l'entité utilisatrice du service TIC",
  'b_02.02.0030': 'Code d’identification du prestataire TIC',
  'b_02.02.0040': 'Type de code du prestataire TIC',
  'b_02.02.0050': 'Identifiant de la fonction',
  'b_02.02.0060': 'Type de services TIC',
  'b_02.02.0070': "Date de début de l'accord",
  'b_02.02.0080': "Date de fin de l'accord",
  'b_02.02.0090': 'Motif de résiliation ou de fin',
  'b_02.02.0100': "Préavis pour l'entité financière (jours)",
  'b_02.02.0110': 'Préavis pour le prestataire TIC (jours)',
  'b_02.02.0120': 'Pays du droit applicable',
  'b_02.02.0130': 'Pays de fourniture des services TIC',
  'b_02.02.0140': 'Stockage de données',
  'b_02.02.0150': 'Localisation des données au repos (stockage)',
  'b_02.02.0160': 'Localisation de la gestion des données (traitement)',
  'b_02.02.0170': 'Sensibilité des données stockées par le prestataire',
  'b_02.02.0180': 'Niveau de dépendance au service TIC (fonction critique ou importante)',

  'b_02.03.0010': "Référence de l'accord contractuel",
  'b_02.03.0020': 'Accord contractuel lié',
  'b_02.03.0030': 'Lien',

  'b_03.01.0010': "Référence de l'accord contractuel",
  'b_03.01.0020': "LEI de l'entité signataire",
  'b_03.01.0030': 'Lien',

  'b_03.02.0010': "Référence de l'accord contractuel",
  'b_03.02.0020': 'Code d’identification du prestataire TIC',
  'b_03.02.0030': 'Type de code du prestataire TIC',
  'b_03.02.0045': 'Lien',

  'b_03.03.0010': "Référence de l'accord contractuel",
  'b_03.03.0020': "LEI de l'entité fournissant les services TIC",
  'b_03.03.0031': 'Lien',

  'b_04.01.0010': "Référence de l'accord contractuel",
  'b_04.01.0020': "LEI de l'entité utilisatrice du service TIC",
  'b_04.01.0030': "Nature de l'entité utilisatrice",
  'b_04.01.0040': 'Code d’identification de la succursale',

  'b_05.01.0010': 'Code d’identification du prestataire TIC',
  'b_05.01.0020': 'Type de code du prestataire TIC',
  'b_05.01.0030': 'Nom du prestataire TIC',
  'b_05.01.0040': 'Type de personne',
  'b_05.01.0050': 'Pays du siège',
  'b_05.01.0060': 'Devise du montant (0070)',
  'b_05.01.0070': 'Dépense annuelle totale ou coût estimé',
  'b_05.01.0080': "Code d’identification de l'entreprise mère ultime",
  'b_05.01.0090': "Type de code de l'entreprise mère ultime",

  'b_05.02.0010': "Référence de l'accord contractuel",
  'b_05.02.0020': 'Type de services TIC',
  'b_05.02.0030': 'Code d’identification du prestataire TIC',
  'b_05.02.0040': 'Type de code du prestataire TIC',
  'b_05.02.0050': 'Rang',
  'b_05.02.0060': 'Code du destinataire des services sous-traités',
  'b_05.02.0070': 'Type de code du destinataire',

  'b_06.01.0010': 'Identifiant de la fonction',
  'b_06.01.0020': 'Activité agréée',
  'b_06.01.0030': 'Nom de la fonction',
  'b_06.01.0040': "LEI de l'entité financière",
  'b_06.01.0050': 'Fonction critique ou importante',
  'b_06.01.0060': 'Motifs de la criticité ou importance',
  'b_06.01.0070': 'Date de la dernière évaluation',
  'b_06.01.0080': 'RTO de la fonction (heures)',
  'b_06.01.0090': 'RPO de la fonction (heures)',
  'b_06.01.0100': "Impact de l'arrêt de la fonction",

  'b_07.01.0010': "Référence de l'accord contractuel",
  'b_07.01.0020': 'Code d’identification du prestataire TIC',
  'b_07.01.0030': 'Type de code du prestataire TIC',
  'b_07.01.0040': 'Type de services TIC',
  'b_07.01.0050': 'Substituabilité du prestataire TIC',
  'b_07.01.0060': 'Motif de non-substituabilité',
  'b_07.01.0070': 'Date du dernier audit du prestataire',
  'b_07.01.0080': "Existence d'un plan de sortie",
  'b_07.01.0090': 'Possibilité de réinternalisation',
  'b_07.01.0100': "Impact de l'arrêt des services TIC",
  'b_07.01.0110': 'Prestataires alternatifs identifiés ?',
  'b_07.01.0120': 'Prestataires alternatifs (précisions)',
};

export const TYPES_FR = {
  Alphanumerical: 'Alphanumérique',
  Country: 'Pays (ISO 3166-1)',
  Currency: 'Devise (ISO 4217)',
  'Closed set of options': 'Liste de valeurs',
  Date: 'Date (AAAA-MM-JJ)',
  Monetary: 'Montant',
  'Natural number': 'Entier naturel',
  Pattern: 'Format imposé',
  '[Yes/No]': 'Oui / Non',
  link: 'Lien (renseigné automatiquement)',
};

// Conditions de remplissage (colonne « Fill-in Option » du template).
export const CONDITIONS_FR = {
  'Mandatory in case of reporting': 'Obligatoire en cas de remise à l’autorité compétente',
  'Mandatory if the entity is a financial entity': 'Obligatoire si l’entité est une entité financière',
  'Mandatory if the contractual arrangement is terminated': 'Obligatoire si l’accord est résilié ou terminé',
  'Mandatory if the ICT service is supporting a critical or important function':
    'Obligatoire si le service TIC soutient une fonction critique ou importante',
  'Mandatory if ’Yes’ is reported in RT.02.02.0140': 'Obligatoire si « Oui » en b_02.02.0140 (stockage de données)',
  'Mandatory if the ICT service is based on or foresees data processing':
    'Obligatoire si le service TIC repose sur un traitement de données ou le prévoit',
  'Mandatory if the ICT third-party service provider stores data and if the ICT service is supporting a critical or important function or material part thereof':
    'Obligatoire si le prestataire stocke des données et si le service soutient une fonction critique ou importante (ou une partie significative)',
  'Mandatory if the ICT service is supporting a critical or important function or material part thereof':
    'Obligatoire si le service TIC soutient une fonction critique ou importante (ou une partie significative)',
  'Mandatory if the entity making use of the ICT service(s) is a branch of a financial entity (RT.04.01.0030)':
    'Obligatoire si l’entité utilisatrice est une succursale (b_04.01.0030)',
  'Mandatory if RT.05.01.0070 is reported': 'Obligatoire si b_05.01.0070 est renseigné',
  'Mandatory if the ICT third-party service provider is a direct ICT third-party service provider':
    'Obligatoire si le prestataire est un prestataire TIC direct',
  'Mandatory if the ICT third-party service provider is not the ultimate parent undertaking':
    'Obligatoire si le prestataire n’est pas l’entreprise mère ultime',
  'Mandatory Not applicable for rank 1': 'Obligatoire ; « Not applicable » pour le rang 1',
  'Mandatory in case “not substitutable” or “highly complex substitutability” is selected in RT.07.01.0050':
    'Obligatoire si « non substituable » ou « substituabilité très complexe » en b_07.01.0050',
};

// Traduction des valeurs des listes EBA les plus utilisées (clé = code EBA).
// Les pays et devises sont traduits côté navigateur (Intl.DisplayNames).
export const VALUES_FR = {
  // Types de services TIC (annexe III)
  'eba_TA:S01': 'Gestion de projets TIC',
  'eba_TA:S02': 'Développement TIC',
  'eba_TA:S03': 'Centre de services et support de premier niveau',
  'eba_TA:S04': 'Services de gestion de la sécurité TIC',
  'eba_TA:S05': 'Fourniture de données',
  'eba_TA:S06': 'Analyse de données',
  'eba_TA:S07': 'Hébergement et infrastructures TIC (hors cloud)',
  'eba_TA:S08': 'Puissance de calcul',
  'eba_TA:S09': 'Stockage de données (hors cloud)',
  'eba_TA:S10': 'Opérateur de télécommunications',
  'eba_TA:S11': 'Infrastructure réseau',
  'eba_TA:S12': 'Matériel et équipements physiques',
  'eba_TA:S13': 'Licences logicielles (hors SaaS)',
  'eba_TA:S14': 'Exploitation TIC (y compris maintenance)',
  'eba_TA:S15': 'Conseil TIC',
  'eba_TA:S16': 'Gestion des risques TIC',
  'eba_TA:S17': 'Cloud : IaaS',
  'eba_TA:S18': 'Cloud : PaaS',
  'eba_TA:S19': 'Cloud : SaaS',
  // Oui / non
  'eba_BT:x28': 'Oui',
  'eba_BT:x29': 'Non',
  'eba_BT:x21': 'Évaluation non réalisée',
  // Niveaux
  'eba_ZZ:x791': 'Faible',
  'eba_ZZ:x792': 'Moyen',
  'eba_ZZ:x793': 'Élevé',
  'eba_ZZ:x799': 'Évaluation non réalisée',
  // Dépendance au service
  'eba_ZZ:x794': 'Non significative',
  'eba_ZZ:x795': 'Faible',
  'eba_ZZ:x796': 'Importante',
  'eba_ZZ:x797': 'Totale',
  // Substituabilité
  'eba_ZZ:x959': 'Non substituable',
  'eba_ZZ:x960': 'Substitution très complexe',
  'eba_ZZ:x961': 'Substitution moyennement complexe',
  'eba_ZZ:x962': 'Facilement substituable',
  'eba_ZZ:x963': "Absence d'alternative réelle",
  'eba_ZZ:x964': 'Difficultés de migration ou de réinternalisation',
  'eba_ZZ:x965': "Absence d'alternative et difficultés de migration",
  // Réinternalisation
  'eba_ZZ:x798': 'Facile',
  'eba_ZZ:x966': 'Difficile',
  'eba_ZZ:x967': 'Très complexe',
  // Nature de l'entité utilisatrice
  'eba_ZZ:x838': "Succursale d'une entité financière",
  'eba_ZZ:x839': 'Hors succursale',
  // Types d'accord
  'eba_CO:x1': 'Accord autonome',
  'eba_CO:x2': 'Accord-cadre',
  'eba_CO:x3': 'Accord subséquent ou associé',
  // Motifs de fin
  'eba_CO:x4': 'Fin sans faute : arrivé à échéance, non renouvelé',
  'eba_CO:x5': 'Résiliation pour faute : manquement du prestataire',
  'eba_CO:x6': 'Résiliation pour faute : obstacle affectant la fonction soutenue',
  'eba_CO:x7': 'Résiliation pour faute : faiblesses sur la sécurité des données',
  'eba_CO:x8': "Résiliation à la demande de l'autorité compétente",
  'eba_CO:x9': 'Autre motif de résiliation',
  // Type de personne
  'eba_CT:x212': 'Personne morale',
  'eba_CT:x213': 'Personne physique agissant à titre professionnel',
  // Position dans le groupe
  'eba_RP:x53': 'Société mère ultime',
  'eba_RP:x551': 'Société mère (non ultime)',
  'eba_RP:x56': 'Filiale',
  'eba_RP:x21': 'Entité hors groupe',
  'eba_RP:x210': 'Externalisation',
  // Types d'entité (principaux)
  'eba_CT:x12': 'Établissement de crédit',
  'eba_CT:x599': "Entreprise d'investissement",
  'eba_CT:x300': 'Établissement de paiement',
  'eba_CT:x302': 'Établissement de monnaie électronique',
  'eba_CT:x309': "Entreprise d'assurance ou de réassurance",
  'eba_CT:x639': 'Société de gestion',
  'eba_CT:x316': 'Autre entité financière',
};
