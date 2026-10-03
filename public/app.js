// Interface web du registre d'information DORA (application monopage, sans framework).
import { checkValue, isEmpty } from './shared/validate.js';
import { TIERS_CATEGORIES, ID_TYPES, PRESTATION_DOMAINS, STATUSES, STATUS_BY_CODE, REGULATION_CATALOG, REGULATION_COLORS, CONTACT_ROLES, personName } from './shared/tiers-model.js';

const state = { me: null, schema: null, tables: {}, issues: [], lists: {}, tiers: [], prestations: [], regulations: [], settings: {}, doraCode: 'DORA', org: { directions: [], managers: [] } };
const $app = document.getElementById('app');
const $modal = document.getElementById('modal-root');

// ---------------------------------------------------------------------------------------
// Utilitaires DOM (construction sans innerHTML pour éviter toute injection)
// ---------------------------------------------------------------------------------------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v; // CSSOM : compatible avec la CSP (pas de style inline)
    else if (k === 'value') el.value = v;
    else if (k === 'checked') el.checked = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function toast(msg) {
  const t = h('div', { class: 't' }, msg);
  document.getElementById('toast').append(t);
  setTimeout(() => t.remove(), 3500);
}

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-Requested-With': 'dora-app' };
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: raw ? body : body === undefined ? undefined : JSON.stringify(body) });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && path !== '/api/login') {
    state.me = null;
    renderLogin(data?.error);
    throw Object.assign(new Error(data?.error || 'Non connecté'), { handled: true });
  }
  if (!res.ok) throw Object.assign(new Error(data?.error || `Erreur ${res.status}`), { data, status: res.status });
  return data;
}

// ---------------------------------------------------------------------------------------
// Schéma et formatage
// ---------------------------------------------------------------------------------------
const T = (code) => state.schema.tables.find((t) => t.code === code);
const colOf = (code) => T(code.slice(0, 7)).columns.find((c) => c.code === code);

const regionNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['fr'], { type: 'region' }) : null;
const currencyNames = typeof Intl.DisplayNames === 'function' ? new Intl.DisplayNames(['fr'], { type: 'currency' }) : null;

/** Libellé d'une valeur de liste EBA : traduction française si disponible, sinon libellé du template. */
function listLabel(listName, code) {
  if (!code) return '';
  try {
    if (listName === 'LISTCOUNTRY' && regionNames) return regionNames.of(code.replace('eba_GA:', '')) || code;
    if (listName === 'LISTCURRENCY' && currencyNames) return currencyNames.of(code.replace('eba_CU:', '')) || code;
  } catch {
    // code non reconnu par le navigateur : libellé du template
  }
  return state.lists[listName]?.get(code) ?? code;
}

function fmt(col, v) {
  if (isEmpty(v)) return '';
  if (col.kind === 'list') {
    const label = listLabel(col.list, v);
    return col.list === 'LISTCOUNTRY' ? `${v.replace('eba_GA:', '')} – ${label}` : label;
  }
  if (col.kind === 'money') return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  if (col.kind === 'date') return v === '9999-12-31' ? 'Sans date (9999-12-31)' : new Date(`${v}T00:00:00`).toLocaleDateString('fr-FR');
  return String(v);
}

function providerName(code) {
  const p = (state.tables['b_05.01'] || []).find((r) => r.data['b_05.01.0010'] === code);
  return p ? p.data['b_05.01.0030'] : null;
}
function entityName(lei) {
  const e = (state.tables['b_01.02'] || []).find((r) => r.data['b_01.02.0010'] === lei);
  return e ? e.data['b_01.02.0020'] : null;
}
function functionName(id) {
  const f = (state.tables['b_06.01'] || []).find((r) => r.data['b_06.01.0010'] === id);
  return f ? f.data['b_06.01.0030'] : null;
}

/** Libellé lisible d'une valeur de référence (nom du prestataire, de l'entité, de la fonction). */
function refHint(col, v) {
  if (!col.ref || isEmpty(v)) return null;
  if (col.ref.table === 'b_05.01') return providerName(v);
  if (col.ref.table === 'b_01.02') return entityName(v);
  if (col.ref.table === 'b_06.01') return functionName(v);
  return null;
}

const canWrite = (tbl) => state.me.permissions.writeTables.includes(tbl);

// ---------------------------------------------------------------------------------------
// Chargement des données
// ---------------------------------------------------------------------------------------
async function loadAll() {
  const [me, schema] = await Promise.all([api('/api/me'), state.schema ? state.schema : api('/api/schema')]);
  state.me = me;
  if (!state.schema) {
    state.schema = schema;
    state.lists = Object.fromEntries(Object.entries(schema.lists).map(([k, items]) => [k, new Map(items.map((i) => [i.code, i.fr || i.label]))]));
  }
  await refresh();
}

async function refresh() {
  const [reg, checks, me, tiers, regulations, org] = await Promise.all([
    api('/api/register'),
    api('/api/checks'),
    api('/api/me'),
    api('/api/tiers'),
    api('/api/regulations'),
    api('/api/organisation'),
  ]);
  state.org = org;
  state.regulations = regulations.regulations;
  state.settings = regulations.settings;
  state.doraCode = regulations.doraCode;
  state.tables = reg.tables;
  state.tiers = tiers.tiers;
  state.prestations = tiers.prestations;
  state.issues = checks.issues;
  state.me = me;
}

// ---------------------------------------------------------------------------------------
// Connexion
// ---------------------------------------------------------------------------------------
function renderLogin(message) {
  $modal.replaceChildren();
  const err = h('div', { class: 'alert error', hidden: !message }, message || '');
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, autofocus: true });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const form = h(
    'form',
    {
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api('/api/login', { method: 'POST', body: { username: user.value, password: pass.value } });
          await loadAll();
          route();
        } catch (ex) {
          err.hidden = false;
          err.textContent = ex.message;
        }
      },
    },
    err,
    h('div', { class: 'field' }, h('label', {}, 'Identifiant'), user),
    h('div', { class: 'field' }, h('label', {}, 'Mot de passe'), pass),
    h('button', { class: 'btn primary', type: 'submit' }, 'Se connecter'),
  );
  $app.replaceChildren(
    h(
      'div',
      { class: 'login' },
      h(
        'div',
        { class: 'card' },
        h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), h('div', {}, 'Registre des tiers', h('small', {}, 'Gestion des tiers et de leurs prestations'))),
        form,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------
// Coque de l'application
// ---------------------------------------------------------------------------------------
// Bouton menu (☰) : masque ou affiche le menu latéral sur grand écran, ouvre le menu en surimpression sur mobile.
const MENU_KEY = 'dora-menu-replie';
const isNarrow = () => window.matchMedia('(max-width: 860px)').matches;
function menuCollapsed() {
  try {
    return localStorage.getItem(MENU_KEY) === '1';
  } catch {
    return false;
  }
}
function toggleMenu() {
  if (isNarrow()) {
    document.getElementById('sidebar')?.classList.toggle('open');
    return;
  }
  const layout = document.querySelector('.layout');
  const collapsed = !layout.classList.contains('collapsed');
  layout.classList.toggle('collapsed', collapsed);
  try {
    if (collapsed) localStorage.setItem(MENU_KEY, '1');
    else localStorage.removeItem(MENU_KEY);
  } catch {
    // préférence non mémorisée
  }
}

// Sections du menu latéral, repliées par défaut (y compris « Registre d'information DORA » et
// « Administration ») ; l'état ouvert/fermé est conservé pendant la session.
const NAV_SECTIONS = [
  { key: 'Tiers', label: 'Prestataires TIC' },
  { key: 'Contrats', label: 'Contrats' },
  { key: 'Signataire', label: 'Signataire' },
  { key: 'Entités', label: 'Entités' },
  { key: 'Fonctions', label: 'Fonctions' },
];
const openSections = new Set();

function navSection(sec, items, cls = '') {
  const nodes = items.flat(Infinity).filter(Boolean);
  const hasActive = nodes.some((a) => a.classList?.contains('active') || a.querySelector?.('a.active'));
  const details = h('details', { class: `nav-group ${cls}`, open: openSections.has(sec.key) || hasActive }, h('summary', {}, h('span', {}, sec.label)), nodes);
  details.addEventListener('toggle', () => (details.open ? openSections.add(sec.key) : openSections.delete(sec.key)));
  return details;
}

function issuesFor(tbl) {
  return state.issues.filter((i) => i.table === tbl && i.level === 'erreur').length;
}

function shell(content) {
  const hash = location.hash || '#/';
  const link = (href, label, extra) =>
    h('a', { href, class: hash === href || (href !== '#/' && hash.startsWith(href + '/')) ? 'active' : '' }, h('span', {}, label), extra);
  const me = state.me;
  const simple = simpleMode();
  const count = (n) => h('span', { class: 'code' }, n);
  let dora;
  if (simple) {
    dora = [
      link('#/dora', 'Synthèse DORA'),
      link('#/dora/prestataires', 'Prestataires TIC'),
      link('#/dora/contrats', 'Contrats'),
      link('#/echanges', 'Exporter'),
      h('button', { class: 'btn link small nav-toggle', onclick: () => setDetailView(true) }, 'Vue détaillée du registre →'),
    ];
  } else {
    dora = [
      link('#/dora', 'Tableau de bord DORA'),
      isReader() ? h('button', { class: 'btn link small nav-toggle', onclick: () => setDetailView(false) }, '← Vue simplifiée du registre') : null,
      NAV_SECTIONS.map((sec) => {
        const items = [];
        if (sec.key === 'Tiers') items.push(link('#/dora/prestataires', 'Fiches prestataires', h('span', { class: 'badge' }, (state.tables['b_05.01'] || []).length)));
        for (const t of state.schema.tables.filter((x) => x.group === sec.key)) {
          const n = issuesFor(t.code);
          items.push(link(`#/table/${t.code}`, t.title, h('span', { class: n ? 'badge erreur' : 'code' }, n ? `${n} ⚠` : t.code.replace('b_', ''))));
        }
        return navSection(sec, items);
      }),
    ];
  }
  const admin = [];
  if (!simple) {
    const errs = state.issues.some((i) => i.level === 'erreur');
    admin.push(link('#/controles', 'Contrôles DORA', h('span', { class: `badge ${errs ? 'erreur' : 'ok'}` }, state.issues.length)));
    admin.push(link('#/echanges', 'Import / export'));
    if (me.permissions.manageUsers) {
      admin.push(link('#/organisation', 'Organisation de la structure'), link('#/regulations', 'Régulations'), link('#/utilisateurs', 'Utilisateurs'), link('#/journal', "Journal d'audit"));
    }
  }
  const subtitle = state.settings.orgName || regs().map((r) => r.label).join(' · ');
  const sidebar = h(
    'nav',
    { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), h('div', {}, 'Registre des tiers', h('small', {}, subtitle))),
    h(
      'div',
      { class: 'nav' },
      link('#/', 'Accueil'),
      link('#/tiers', 'Tiers', count(state.tiers.length)),
      link('#/prestations', 'Prestations', count(state.prestations.length)),
      navSection({ key: 'DORA', label: 'Registre d’information DORA' }, dora, 'nav-top'),
      admin.length ? navSection({ key: 'Administration', label: 'Administration' }, admin, 'nav-top') : null,
    ),
  );
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn menu-btn', title: 'Afficher / masquer le menu', 'aria-label': 'Afficher ou masquer le menu', onclick: toggleMenu }, '☰'),
    h('div', { class: 'muted small' }, me.permissions.global ? 'Périmètre : tous les tiers' : `Périmètre : ${plural(me.tiersCount || 0, 'tiers rattaché', 'tiers rattachés')}`),
    h(
      'div',
      { class: 'who' },
      h('span', {}, me.displayName),
      h('span', { class: 'badge role' }, me.roleLabel),
      h('button', { class: 'btn link', onclick: passwordModal }, 'Mot de passe'),
      h(
        'button',
        {
          class: 'btn',
          onclick: async () => {
            await api('/api/logout', { method: 'POST' });
            state.me = null;
            location.hash = '#/';
            renderLogin();
          },
        },
        'Déconnexion',
      ),
    ),
  );
  sidebar.addEventListener('click', (e) => e.target.closest('a') && sidebar.classList.remove('open'));
  $app.replaceChildren(h('div', { class: `layout${menuCollapsed() ? ' collapsed' : ''}` }, sidebar, h('div', { class: 'main' }, topbar, h('main', { class: 'content' }, content))));
}

// ---------------------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------------------
function route() {
  if (!state.me) return renderLogin();
  $modal.replaceChildren();
  const [page, arg, sub] = (location.hash || '#/').slice(2).split('/').map(decodeURIComponent);
  const simple = simpleMode();
  let view;
  if (!page) view = homeView();
  else if (page === 'tiers' && arg) view = tiersPage(Number(arg));
  else if (page === 'tiers') view = tiersList();
  else if (page === 'prestations') view = prestationsList(arg);
  else if (page === 'dora' && !arg) view = simple ? readerHome() : dashboard();
  else if (page === 'dora' && arg === 'prestataires' && sub) view = simple ? readerProvider(Number(sub)) : providerSheet(Number(sub));
  else if (page === 'dora' && arg === 'prestataires') view = simple ? readerProviders() : providersList();
  else if (page === 'dora' && arg === 'contrats') view = readerContracts();
  else if (page === 'echanges') view = simple ? readerExport() : exchangeView();
  else if (simple) view = h('div', { class: 'empty' }, 'Page introuvable.');
  else if (page === 'table' && T(arg)) view = tableView(arg);
  else if (page === 'controles') view = checksView();
  else if (page === 'utilisateurs' && state.me.permissions.manageUsers) view = usersView();
  else if (page === 'journal' && state.me.permissions.manageUsers) view = auditView();
  else if (page === 'regulations' && state.me.permissions.manageUsers) view = regulationsView();
  else if (page === 'organisation' && state.me.permissions.manageUsers) view = organisationView();
  else view = h('div', { class: 'empty' }, 'Page introuvable.');
  shell(view);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', () => state.me && route());

async function reloadAndRender() {
  await refresh();
  route();
}

// ---------------------------------------------------------------------------------------
// Tableau de bord
// ---------------------------------------------------------------------------------------
function dashboard() {
  const t = state.tables;
  const contracts = t['b_02.02'] || [];
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10);
  const expiring = contracts
    .filter((r) => r.data['b_02.02.0080'] && r.data['b_02.02.0080'] >= today && r.data['b_02.02.0080'] <= horizon)
    .sort((a, b) => a.data['b_02.02.0080'].localeCompare(b.data['b_02.02.0080']));
  const criticalFns = new Set((t['b_06.01'] || []).filter((r) => r.data['b_06.01.0050'] === 'eba_BT:x28').map((r) => r.data['b_06.01.0010']));
  const criticalContracts = contracts.filter((r) => criticalFns.has(r.data['b_02.02.0050']));
  const errors = state.issues.filter((i) => i.level === 'erreur').length;
  const incomplete = state.issues.length - errors;
  const totalSpend = (t['b_02.01'] || []).reduce((s, r) => s + (Number(r.data['b_02.01.0050']) || 0), 0);

  const byService = {};
  for (const r of contracts) {
    const k = r.data['b_02.02.0060'];
    if (k) byService[k] = (byService[k] || 0) + 1;
  }
  const max = Math.max(1, ...Object.values(byService));

  const kpi = (v, l, href) => h(href ? 'a' : 'div', { class: 'kpi', href }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Tableau de bord'), h('div', { class: 'muted' }, `Bonjour ${state.me.displayName}. Vue ${state.me.permissions.global ? 'de l’ensemble du registre' : 'limitée à vos prestataires rattachés'}.`))),
    h(
      'div',
      { class: 'grid kpis' },
      kpi((t['b_05.01'] || []).length, 'Prestataires TIC', '#/dora/prestataires'),
      kpi((t['b_02.01'] || []).length, 'Accords contractuels', '#/table/b_02.01'),
      kpi(criticalContracts.length, 'Accords soutenant une fonction critique ou importante', '#/table/b_02.02'),
      kpi(totalSpend.toLocaleString('fr-FR', { maximumFractionDigits: 0 }), 'Dépense annuelle déclarée (b_02.01)'),
      kpi(errors, 'Erreurs de cohérence', '#/controles'),
      kpi(incomplete, 'Champs à compléter', '#/controles'),
    ),
    h(
      'div',
      { class: 'grid two', style: 'margin-top:16px' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Accords arrivant à échéance (180 jours)'),
        expiring.length
          ? h(
              'table',
              { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', {}, 'Accord'), h('th', {}, 'Prestataire'), h('th', {}, 'Fin'))),
              h(
                'tbody',
                {},
                expiring.map((r) =>
                  h(
                    'tr',
                    { onclick: () => recordModal('b_02.02', r) },
                    h('td', {}, r.data['b_02.02.0010']),
                    h('td', {}, providerName(r.data['b_02.02.0030']) || r.data['b_02.02.0030']),
                    h('td', {}, fmt(colOf('b_02.02.0080'), r.data['b_02.02.0080'])),
                  ),
                ),
              ),
            )
          : h('div', { class: 'empty' }, 'Aucun accord n’arrive à échéance dans les 180 prochains jours.'),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Accords par type de service TIC'),
        Object.keys(byService).length
          ? Object.entries(byService)
              .sort((a, b) => b[1] - a[1])
              .map(([k, n]) =>
                h('div', { class: 'bar' }, h('span', { title: k }, listLabel('LISTANNEXIII', k)), h('div', { class: 'track' }, h('div', { class: 'fill', style: `width:${(n / max) * 100}%` })), h('b', {}, n)),
              )
          : h('div', { class: 'empty' }, 'Aucun accord saisi.'),
      ),
    ),
    !state.me.permissions.global
      ? h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Vos prestataires rattachés'),
          state.me.providers.length
            ? h('ul', {}, state.me.providers.map((p) => h('li', {}, h('a', { href: `#/dora/prestataires/${p.id}` }, p.name || p.code), ' ', h('span', { class: 'code muted' }, p.code))))
            : h('div', { class: 'empty' }, 'Aucun prestataire ne vous est rattaché. Contactez l’administrateur global.'),
        )
      : null,
  );
}

// ---------------------------------------------------------------------------------------
// Prestataires TIC
// ---------------------------------------------------------------------------------------
function providersList() {
  const providers = state.tables['b_05.01'] || [];
  const contracts = state.tables['b_02.02'] || [];
  const assess = state.tables['b_07.01'] || [];
  const search = h('input', { class: 'search', placeholder: 'Rechercher un prestataire…', type: 'search' });
  const tbody = h('tbody');
  const draw = () => {
    const q = search.value.toLowerCase();
    const rows = providers.filter((p) => !q || Object.values(p.data).join(' ').toLowerCase().includes(q));
    tbody.replaceChildren(
      ...rows.map((p) => {
        const code = p.data['b_05.01.0010'];
        const pc = contracts.filter((c) => c.data['b_02.02.0030'] === code);
        const subst = assess.filter((a) => a.data['b_07.01.0020'] === code).map((a) => listLabel('LIST0701050', a.data['b_07.01.0050']));
        return h(
          'tr',
          { onclick: () => (location.hash = `#/dora/prestataires/${p.id}`) },
          h('td', {}, h('b', {}, p.data['b_05.01.0030'] || '(sans nom)')),
          h('td', { class: 'code' }, code, ' ', h('span', { class: 'badge' }, p.data['b_05.01.0020'])),
          h('td', {}, fmt(colOf('b_05.01.0050'), p.data['b_05.01.0050'])),
          h('td', { class: 'num' }, new Set(pc.map((c) => c.data['b_02.02.0010'])).size),
          h('td', { class: 'num' }, fmt(colOf('b_05.01.0070'), p.data['b_05.01.0070'])),
          h('td', {}, [...new Set(subst)].join(', ')),
        );
      }),
    );
    if (!rows.length) tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Aucun prestataire.')));
  };
  search.addEventListener('input', draw);
  draw();
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Prestataires tiers de services TIC'), h('div', { class: 'muted' }, 'Fiches consolidées à partir des tableaux b_05.01, b_02.02, b_07.01 et b_05.02.')),
      h('div', { class: 'toolbar' }, search, canWrite('b_05.01') ? h('button', { class: 'btn primary', onclick: () => recordModal('b_05.01') }, '+ Nouveau prestataire') : null),
    ),
    h(
      'div',
      { class: 'table-wrap' },
      h(
        'table',
        { class: 'data' },
        h('thead', {}, h('tr', {}, ['Nom', 'Code d’identification', 'Pays du siège', 'Accords', 'Dépense annuelle', 'Substituabilité'].map((x) => h('th', {}, x)))),
        tbody,
      ),
    ),
  );
}

function miniTable(tbl, rows, cols, opts = {}) {
  const table = T(tbl);
  const columns = cols.map((c) => table.columns.find((x) => x.code === `${tbl}.${c}`));
  if (!rows.length) return h('div', { class: 'empty' }, opts.empty || 'Aucune ligne.');
  return h(
    'div',
    { class: 'table-wrap' },
    h(
      'table',
      { class: 'data' },
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { title: c.name }, c.label)))),
      h(
        'tbody',
        {},
        rows.map((r) =>
          h(
            'tr',
            { onclick: () => recordModal(tbl, r) },
            columns.map((c) => {
              const hint = refHint(c, r.data[c.code]);
              return h('td', { class: c.kind === 'money' || c.kind === 'int' ? 'num' : '' }, hint ? `${hint}` : fmt(c, r.data[c.code]));
            }),
          ),
        ),
      ),
    ),
  );
}

function providerSheet(id) {
  const p = (state.tables['b_05.01'] || []).find((r) => r.id === id);
  if (!p) return h('div', { class: 'empty' }, 'Prestataire introuvable ou hors de votre périmètre.');
  const code = p.data['b_05.01.0010'];
  const type = p.data['b_05.01.0020'];
  const specifics = (state.tables['b_02.02'] || []).filter((r) => r.data['b_02.02.0030'] === code);
  const refs = new Set(specifics.map((r) => r.data['b_02.02.0010']));
  const general = (state.tables['b_02.01'] || []).filter((r) => refs.has(r.data['b_02.01.0010']));
  const assess = (state.tables['b_07.01'] || []).filter((r) => r.data['b_07.01.0020'] === code);
  const chain = (state.tables['b_05.02'] || []).filter((r) => refs.has(r.data['b_05.02.0010']) || r.data['b_05.02.0030'] === code);
  const table = T('b_05.01');
  const issues = state.issues.filter((i) => i.recordId === p.id).length;

  const section = (title, tbl, content, addBtn) =>
    h('div', { class: 'card' }, h('div', { class: 'page-head', style: 'margin-bottom:8px' }, h('h2', {}, title, ' ', h('span', { class: 'code muted' }, tbl)), addBtn), content);
  const add = (tbl, preset, label = '+ Ajouter') => (canWrite(tbl) ? h('button', { class: 'btn', onclick: () => recordModal(tbl, null, preset) }, label) : null);

  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('a', { href: '#/dora/prestataires', class: 'small' }, '← Prestataires TIC'), h('h1', {}, p.data['b_05.01.0030'] || '(sans nom)'), h('div', { class: 'code muted' }, `${type} · ${code}`)),
      h(
        'div',
        { class: 'toolbar' },
        issues ? h('a', { class: 'badge erreur', href: '#/controles' }, `${issues} point(s) de contrôle`) : h('span', { class: 'badge ok' }, 'Fiche cohérente'),
        h('button', { class: 'btn', onclick: () => recordModal('b_05.01', p) }, canWrite('b_05.01') ? 'Modifier la fiche' : 'Voir le détail'),
        canWrite('b_02.02') ? h('button', { class: 'btn primary', onclick: () => contractWizard(p) }, '+ Nouvel accord contractuel') : null,
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h(
        'dl',
        { class: 'dl' },
        table.columns.flatMap((c) => [h('dt', {}, c.label), h('dd', {}, fmt(c, p.data[c.code]) || h('span', { class: 'muted' }, '—'))]),
      ),
    ),
    section('Accords contractuels – informations générales', 'b_02.01', miniTable('b_02.01', general, ['0010', '0020', '0040', '0050'], { empty: 'Aucun accord.' })),
    section(
      'Accords contractuels – informations spécifiques',
      'b_02.02',
      miniTable('b_02.02', specifics, ['0010', '0020', '0050', '0060', '0070', '0080', '0180'], { empty: 'Aucun accord.' }),
    ),
    section(
      'Évaluation des services TIC',
      'b_07.01',
      miniTable('b_07.01', assess, ['0010', '0040', '0050', '0070', '0080', '0100', '0110']),
      add('b_07.01', { 'b_07.01.0020': code, 'b_07.01.0030': type }),
    ),
    section(
      "Chaîne d'approvisionnement",
      'b_05.02',
      miniTable('b_05.02', chain, ['0010', '0020', '0030', '0050', '0060']),
      add('b_05.02', { 'b_05.02.0030': code, 'b_05.02.0040': type, 'b_05.02.0050': '1', 'b_05.02.0060': 'Not applicable', 'b_05.02.0070': 'Not applicable' }),
    ),
  );
}

// ---------------------------------------------------------------------------------------
// Vue générique d'un tableau du template
// ---------------------------------------------------------------------------------------
const tableUi = { sort: null, desc: false };

function tableView(code) {
  const table = T(code);
  const rows = state.tables[code] || [];
  const issuesByRecord = {};
  for (const i of state.issues) if (i.table === code) (issuesByRecord[i.recordId] ||= []).push(i);
  const cols = table.columns.filter((c) => c.kind !== 'link');
  const search = h('input', { class: 'search', placeholder: 'Rechercher…', type: 'search' });
  const thead = h('thead');
  const tbody = h('tbody');
  const display = (c, v) => {
    const hint = refHint(c, v);
    return hint ? `${v} (${hint})` : fmt(c, v);
  };
  const draw = () => {
    const q = search.value.toLowerCase();
    let list = rows.filter((r) => !q || cols.some((c) => display(c, r.data[c.code]).toLowerCase().includes(q)));
    if (tableUi.sort && tableUi.sort.startsWith(code)) {
      const c = cols.find((x) => x.code === tableUi.sort);
      list = [...list].sort((a, b) => {
        const va = a.data[c.code] ?? '';
        const vb = b.data[c.code] ?? '';
        const cmp = c.kind === 'money' || c.kind === 'int' ? Number(va) - Number(vb) : display(c, va).localeCompare(display(c, vb), 'fr');
        return tableUi.desc ? -cmp : cmp;
      });
    }
    thead.replaceChildren(
      h(
        'tr',
        {},
        h('th', {}, ''),
        cols.map((c) =>
          h(
            'th',
            {
              title: `${c.name}\n${c.typeLabel}`,
              onclick: () => {
                tableUi.desc = tableUi.sort === c.code ? !tableUi.desc : false;
                tableUi.sort = c.code;
                draw();
              },
            },
            c.label,
            tableUi.sort === c.code ? (tableUi.desc ? ' ▼' : ' ▲') : '',
            h('span', { class: 'code' }, c.short),
          ),
        ),
      ),
    );
    tbody.replaceChildren(
      ...list.map((r) => {
        const iss = issuesByRecord[r.id] || [];
        const err = iss.some((i) => i.level === 'erreur');
        return h(
          'tr',
          { onclick: () => recordModal(code, r) },
          h('td', {}, iss.length ? h('span', { class: `badge ${err ? 'erreur' : 'incomplet'}`, title: iss.map((i) => `${i.column} : ${i.message}`).join('\n') }, iss.length) : h('span', { class: 'badge ok' }, '✓')),
          cols.map((c) => h('td', { class: c.kind === 'money' || c.kind === 'int' ? 'num' : '', title: display(c, r.data[c.code]) }, display(c, r.data[c.code]))),
        );
      }),
    );
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: cols.length + 1, class: 'empty' }, rows.length ? 'Aucun résultat.' : 'Aucune ligne dans ce tableau.')));
  };
  search.addEventListener('input', draw);
  draw();
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, table.title), h('div', { class: 'muted small' }, h('span', { class: 'code' }, table.code), ' · ', table.template), table.referential && !canWrite(code) ? h('div', { class: 'muted small' }, 'Référentiel en lecture seule pour votre profil.') : null),
      h('div', { class: 'toolbar' }, search, h('span', { class: 'muted small' }, `${rows.length} ligne(s)`), canWrite(code) ? h('button', { class: 'btn primary', onclick: () => recordModal(code) }, '+ Ajouter une ligne') : null),
    ),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, thead, tbody)),
  );
}

// ---------------------------------------------------------------------------------------
// Formulaires
// ---------------------------------------------------------------------------------------
function openModal({ title, body, footer, narrow }) {
  const close = () => $modal.replaceChildren();
  const modal = h(
    'div',
    { class: 'modal-backdrop', onmousedown: (e) => e.target === e.currentTarget && close() },
    h('div', { class: `modal${narrow ? ' narrow' : ''}`, role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'modal-head' }, h('h2', { style: 'margin:0' }, title), h('button', { class: 'btn link', onclick: close, 'aria-label': 'Fermer' }, '✕')), h('div', { class: 'modal-body' }, body), footer ? h('div', { class: 'modal-foot' }, footer) : null),
  );
  const onKey = (e) => {
    if (e.key === 'Escape') {
      close();
      document.removeEventListener('keydown', onKey);
    }
  };
  document.addEventListener('keydown', onKey);
  $modal.replaceChildren(modal);
  modal.querySelector('input:not([disabled]), select:not([disabled])')?.focus();
  return close;
}

/** Valeurs proposées pour une colonne référençant un autre tableau. */
function refOptions(col) {
  const rows = state.tables[col.ref.table] || [];
  const seen = new Map();
  for (const r of rows) {
    const v = r.data[col.ref.column];
    if (!v || seen.has(v)) continue;
    const label =
      col.ref.table === 'b_05.01' ? r.data['b_05.01.0030'] : col.ref.table === 'b_01.02' ? r.data['b_01.02.0020'] : col.ref.table === 'b_06.01' ? r.data['b_06.01.0030'] : col.ref.table === 'b_01.03' ? r.data['b_01.03.0030'] : null;
    seen.set(v, label);
  }
  return [...seen.entries()];
}

let uid = 0;
/** Construit les champs d'un tableau ; renvoie { nodes, read, showErrors }. */
function buildFields(table, data, { readOnly = false, skip = [], locked = [] } = {}) {
  const inputs = {};
  const errs = {};
  const fields = {};
  const nodes = [];
  for (const col of table.columns) {
    if (col.kind === 'link' || skip.includes(col.code)) continue;
    const id = `f${++uid}`;
    const v = data[col.code] ?? '';
    const disabled = readOnly || locked.includes(col.code);
    let input;
    if (col.kind === 'list') {
      input = h('select', { id, disabled }, h('option', { value: '' }, '— Non renseigné —'), state.schema.lists[col.list].map((it) => h('option', { value: it.code }, col.list === 'LISTCOUNTRY' ? `${it.code.replace('eba_GA:', '')} – ${listLabel(col.list, it.code)}` : listLabel(col.list, it.code))));
      input.value = v;
    } else if (col.kind === 'date') {
      input = h('input', { id, type: 'date', value: v, disabled, min: '1900-01-01', max: '9999-12-31' });
    } else if (col.kind === 'money' || col.kind === 'int') {
      input = h('input', { id, type: 'number', step: col.kind === 'int' ? '1' : 'any', min: col.kind === 'int' ? '0' : null, value: v, disabled });
    } else {
      const listId = `${id}-dl`;
      let options = [];
      if (col.ref) options = refOptions(col);
      else if (col.kind === 'codeType') options = ['LEI', 'EUID', 'FR_CRN', 'FR_VAT', 'DE_VAT', 'LU_CRN', 'IE_CRN', 'US_CRN'].map((x) => [x, null]).concat(col.code === 'b_05.02.0070' ? [['Not applicable', 'rang 1']] : []);
      else if (col.code === 'b_05.02.0060') options = [['Not applicable', 'rang 1'], ...refOptions({ ref: { table: 'b_05.01', column: 'b_05.01.0010' } })];
      input = h('input', { id, value: v, disabled, list: options.length ? listId : null, autocomplete: 'off', spellcheck: 'false' });
      if (options.length) nodes.push(h('datalist', { id: listId }, options.map(([val, label]) => h('option', { value: val }, label || val))));
    }
    const err = h('div', { class: 'err', hidden: true });
    const hintEl = h('div', { class: 'meta' });
    const updateHint = () => {
      const hint = refHint(col, input.value);
      hintEl.textContent = `${col.code} · ${col.typeLabel}${hint ? ` · ${hint}` : ''}`;
    };
    updateHint();
    input.addEventListener('input', updateHint);
    const field = h(
      'div',
      { class: 'field' },
      h('label', { for: id, title: col.name }, col.label, col.required ? h('span', { class: 'req', title: 'Obligatoire' }, ' *') : null),
      hintEl,
      input,
      col.condition ? h('div', { class: 'cond' }, `Condition : ${col.condition}`) : null,
      err,
      h('details', {}, h('summary', {}, 'Consigne EBA'), h('div', {}, col.name), col.instruction ? h('div', {}, col.instruction) : null),
    );
    inputs[col.code] = input;
    errs[col.code] = err;
    fields[col.code] = field;
    nodes.push(field);
  }
  // Remplissage automatique du type de code à partir de la fiche prestataire.
  for (const col of table.columns) {
    if (col.codeType && inputs[col.code] && inputs[col.codeType] && col.ref?.table === 'b_05.01') {
      inputs[col.code].addEventListener('change', () => {
        const p = (state.tables['b_05.01'] || []).find((r) => r.data['b_05.01.0010'] === inputs[col.code].value);
        if (p && !inputs[col.codeType].disabled) inputs[col.codeType].value = p.data['b_05.01.0020'];
      });
    }
  }
  const read = () => {
    const out = { ...data };
    for (const [code, input] of Object.entries(inputs)) out[code] = input.value.trim();
    return out;
  };
  const showErrors = (errors = {}) => {
    for (const [code, el] of Object.entries(errs)) {
      el.hidden = !errors[code];
      el.textContent = errors[code] || '';
      fields[code].classList.toggle('has-err', !!errors[code]);
    }
  };
  const liveCheck = () => {
    const d = read();
    const errors = {};
    for (const col of table.columns) {
      if (!inputs[col.code]) continue;
      const msg = checkValue(state.schema, col, d[col.code], d);
      if (msg && msg !== 'Champ obligatoire') errors[col.code] = msg;
    }
    showErrors(errors);
    return errors;
  };
  for (const input of Object.values(inputs)) input.addEventListener('change', liveCheck);
  return { nodes, read, showErrors, liveCheck, inputs };
}

function recordModal(tbl, record = null, preset = {}) {
  const table = T(tbl);
  const writable = canWrite(tbl);
  const data = record ? { ...record.data } : { ...preset };
  const form = buildFields(table, data, { readOnly: !writable });
  const alert = h('div', { class: 'alert error', hidden: true });
  const issues = record ? state.issues.filter((i) => i.recordId === record.id) : [];
  const save = async () => {
    alert.hidden = true;
    if (Object.keys(form.liveCheck()).length) {
      alert.hidden = false;
      alert.textContent = 'Corrigez les valeurs signalées avant d’enregistrer.';
      return;
    }
    try {
      if (record) await api(`/api/records/${record.id}`, { method: 'PUT', body: { data: form.read() } });
      else await api('/api/records', { method: 'POST', body: { table: tbl, data: form.read() } });
      close();
      toast(record ? 'Ligne mise à jour' : 'Ligne ajoutée');
      await reloadAndRender();
    } catch (e) {
      if (e.handled) return;
      alert.hidden = false;
      alert.textContent = e.message;
      if (e.data?.errors) form.showErrors(e.data.errors);
    }
  };
  const del = async () => {
    if (!confirm('Supprimer définitivement cette ligne du registre ?')) return;
    try {
      await api(`/api/records/${record.id}`, { method: 'DELETE' });
      close();
      toast('Ligne supprimée');
      await reloadAndRender();
    } catch (e) {
      if (!e.handled) {
        alert.hidden = false;
        alert.textContent = e.message;
      }
    }
  };
  const close = openModal({
    title: `${record ? (writable ? 'Modifier' : 'Consulter') : 'Ajouter'} – ${table.title} (${tbl})`,
    body: [
      alert,
      issues.length
        ? h('div', { class: 'alert warn' }, h('b', {}, 'Contrôles : '), h('ul', { style: 'margin:4px 0 0' }, issues.map((i) => h('li', {}, `${colOf(i.column)?.label || i.column} – ${i.message}`))))
        : null,
      !writable ? h('div', { class: 'alert info' }, 'Consultation seule : votre profil ne permet pas de modifier ce tableau.') : null,
      h('div', { class: 'form-grid' }, form.nodes),
      record ? h('p', { class: 'muted small' }, `Dernière modification : ${record.updated_at} (UTC)`) : null,
    ],
    footer: [
      record && writable && !(tbl === 'b_05.01' && state.me.role !== 'global_admin') ? h('button', { class: 'btn danger', onclick: del, style: 'margin-right:auto' }, 'Supprimer') : null,
      h('button', { class: 'btn', onclick: () => close() }, writable ? 'Annuler' : 'Fermer'),
      writable ? h('button', { class: 'btn primary', onclick: save }, 'Enregistrer') : null,
    ],
  });
}

function contractWizard(provider) {
  const code = provider.data['b_05.01.0010'];
  const type = provider.data['b_05.01.0020'];
  const g = buildFields(T('b_02.01'), {});
  const s = buildFields(T('b_02.02'), { 'b_02.02.0030': code, 'b_02.02.0040': type }, { skip: ['b_02.02.0010'], locked: ['b_02.02.0030', 'b_02.02.0040'] });
  const alert = h('div', { class: 'alert error', hidden: true });
  const close = openModal({
    title: `Nouvel accord contractuel – ${provider.data['b_05.01.0030']}`,
    body: [
      h('div', { class: 'alert info' }, 'L’accord est créé dans b_02.01 (informations générales) et b_02.02 (informations spécifiques). Les tableaux b_03.xx, b_04.01 et b_07.01 se complètent ensuite.'),
      alert,
      h('div', { class: 'form-grid' }, h('div', { class: 'form-section' }, 'Informations générales (b_02.01)'), g.nodes, h('div', { class: 'form-section' }, 'Informations spécifiques (b_02.02)'), s.nodes),
    ],
    footer: [
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            alert.hidden = true;
            if (Object.keys({ ...g.liveCheck(), ...s.liveCheck() }).length) {
              alert.hidden = false;
              alert.textContent = 'Corrigez les valeurs signalées avant d’enregistrer.';
              return;
            }
            try {
              await api('/api/contracts', { method: 'POST', body: { general: g.read(), specific: s.read() } });
              close();
              toast('Accord créé');
              await reloadAndRender();
            } catch (e) {
              if (e.handled) return;
              alert.hidden = false;
              alert.textContent = e.message;
              if (e.data?.errors) {
                g.showErrors(e.data.errors);
                s.showErrors(e.data.errors);
              }
            }
          },
        },
        'Créer l’accord',
      ),
    ],
  });
}

function passwordModal() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  const alert = h('div', { class: 'alert error', hidden: true });
  const close = openModal({
    narrow: true,
    title: 'Changer mon mot de passe',
    body: [alert, h('div', { class: 'field' }, h('label', {}, 'Mot de passe actuel'), cur), h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, 'Nouveau mot de passe (10 caractères minimum)'), next)],
    footer: [
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            try {
              await api('/api/me/password', { method: 'PUT', body: { current: cur.value, next: next.value } });
              close();
              toast('Mot de passe modifié');
            } catch (e) {
              if (e.handled) return;
              alert.hidden = false;
              alert.textContent = e.message;
            }
          },
        },
        'Enregistrer',
      ),
    ],
  });
}

// ---------------------------------------------------------------------------------------
// Contrôles
// ---------------------------------------------------------------------------------------
const LEVELS = { erreur: 'Erreurs', incomplet: 'Champs à compléter', avertissement: 'Avertissements' };

function checksView() {
  const filter = h('select', { style: 'max-width:240px' }, h('option', { value: '' }, 'Tous les niveaux'), Object.entries(LEVELS).map(([k, l]) => h('option', { value: k }, l)));
  const out = h('div');
  const records = Object.fromEntries(Object.values(state.tables).flat().map((r) => [r.id, r]));
  const draw = () => {
    const list = state.issues.filter((i) => !filter.value || i.level === filter.value);
    const byTable = {};
    for (const i of list) (byTable[i.table] ||= []).push(i);
    out.replaceChildren(
      ...(list.length
        ? state.schema.tables
            .filter((t) => byTable[t.code])
            .map((t) =>
              h(
                'div',
                { class: 'card' },
                h('h2', {}, t.title, ' ', h('span', { class: 'code muted' }, t.code), ' ', h('span', { class: 'badge' }, byTable[t.code].length)),
                h(
                  'div',
                  { class: 'table-wrap' },
                  h(
                    'table',
                    { class: 'data' },
                    h('thead', {}, h('tr', {}, h('th', {}, 'Niveau'), h('th', {}, 'Ligne'), h('th', {}, 'Colonne'), h('th', {}, 'Constat'))),
                    h(
                      'tbody',
                      {},
                      byTable[t.code].map((i) => {
                        const r = records[i.recordId];
                        const key = r ? t.keys.map((k) => r.data[k]).filter(Boolean).join(' / ') : `#${i.recordId}`;
                        return h(
                          'tr',
                          { onclick: () => r && recordModal(t.code, r) },
                          h('td', {}, h('span', { class: `badge ${i.level}` }, i.level)),
                          h('td', { class: 'code' }, key || `#${i.recordId}`),
                          h('td', {}, colOf(i.column)?.label || i.column, h('div', { class: 'code muted' }, i.column)),
                          h('td', {}, i.message),
                        );
                      }),
                    ),
                  ),
                ),
              ),
            )
        : [h('div', { class: 'card empty' }, 'Aucun point de contrôle : le registre visible est complet et cohérent.')]),
    );
  };
  filter.addEventListener('change', draw);
  draw();
  const count = (lvl) => state.issues.filter((i) => i.level === lvl).length;
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Contrôles de complétude et de cohérence'), h('div', { class: 'muted' }, 'Formats (LEI, dates, listes EBA), champs obligatoires et conditionnels du template, références entre tableaux, doublons.')),
      h('div', { class: 'toolbar' }, Object.keys(LEVELS).map((l) => h('span', { class: `badge ${l}` }, `${count(l)} ${LEVELS[l].toLowerCase()}`)), filter),
    ),
    out,
  );
}

// ---------------------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------------------
/** Correspondance des identifiants de fonction locaux avec les identifiants EBA (F1, F2…). */
function functionIdsBox() {
  const box = h('div', { class: 'fn-ids' });
  api('/api/function-ids')
    .then((rows) => {
      if (!rows.length) return;
      box.replaceChildren(
        h('h3', { style: 'margin-top:16px' }, 'Identifiants de fonction'),
        h('p', { class: 'muted small' }, 'Le format EBA impose « F » suivi d’un nombre. Vos identifiants locaux restent dans le registre ; l’export utilise ces équivalents, toujours les mêmes d’un export à l’autre, et les liste dans un onglet « Identifiants de fonction ». Ils sont attribués à chaque export pour les nouvelles fonctions.'),
        h(
          'div',
          { class: 'table-wrap fn-ids-table' },
          h('table', { class: 'data' }, h('thead', {}, h('tr', {}, h('th', {}, 'Identifiant local'), h('th', {}, 'Identifiant EBA'))), h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r.local), h('td', { class: 'code' }, r.eba))))),
        ),
      );
    })
    .catch(() => {});
  return box;
}

function exchangeView() {
  const canImp = state.me.permissions.import;
  const file = h('input', { type: 'file', accept: '.xlsx' });
  const mode = h('select', {}, h('option', { value: 'append' }, 'Ajouter les lignes au registre existant'), h('option', { value: 'replace' }, 'Remplacer les tableaux présents dans le fichier'));
  const result = h('div');
  const doImport = async () => {
    if (!file.files[0]) return toast('Choisissez un fichier .xlsx');
    if (mode.value === 'replace' && !confirm('Les tableaux présents dans le fichier vont remplacer les données actuelles. Continuer ?')) return;
    try {
      const r = await api(`/api/import?mode=${mode.value}`, { method: 'POST', body: file.files[0], raw: true });
      await refresh();
      route();
      toast(`Import terminé : ${Object.values(r.summary).reduce((a, b) => a + b, 0)} ligne(s), ${r.tiers.newTiers} nouveau(x) tiers, ${r.tiers.newPrestations} prestation(s) DORA`);
    } catch (e) {
      if (!e.handled) result.replaceChildren(h('div', { class: 'alert error' }, e.message));
    }
  };
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Import / export'), h('div', { class: 'muted' }, 'Tiers et prestations, et registre d’information DORA au format EBA.'))),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Tiers et prestations'),
      h('p', {}, 'Un classeur avec un onglet Tiers et un onglet Prestations, et une colonne par qualification (DORA, PECI, PBE, Résolution, Externalisation ABE).'),
      h(
        'div',
        { class: 'toolbar' },
        h('a', { class: 'btn primary', href: '/api/tiers/export.xlsx' }, 'Télécharger les tiers (.xlsx)'),
        canImp
          ? h(
              'button',
              {
                class: 'btn',
                onclick: async () => {
                  try {
                    const r = await api('/api/tiers/sync-dora', { method: 'POST' });
                    await reloadAndRender();
                    toast(`Reprise du registre DORA : ${r.newTiers} tiers créé(s), ${r.linkedTiers} relié(s), ${r.newPrestations} prestation(s)`);
                  } catch (e) {
                    if (!e.handled) toast(e.message);
                  }
                },
              },
              'Reprendre les prestataires du registre DORA',
            )
          : null,
      ),
      canImp ? h('p', { class: 'muted small' }, 'Chaque prestataire TIC du registre devient un tiers et chaque accord une prestation qualifiée DORA. C’est fait automatiquement après chaque import du registre ; les tiers existants ne sont pas modifiés.') : null,
    ),
    h(
      'div',
      { class: 'grid two' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Exporter le registre DORA'),
        h('p', {}, 'Génère un classeur Excel reprenant la structure du template : un onglet par tableau (b_01.01 à b_07.01), codes colonnes en ligne 4, libellés en ligne 5, types en ligne 6, données à partir de la ligne 7, listes de valeurs EBA dans l’onglet « Drop down ».'),
        h('p', { class: 'muted small' }, state.me.permissions.global ? 'L’export contient l’ensemble du registre.' : 'L’export est limité à vos prestataires rattachés et au référentiel.'),
        h('a', { class: 'btn primary', href: '/api/export.xlsx' }, 'Télécharger le registre (.xlsx)'),
        functionIdsBox(),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Importer un registre DORA'),
        canImp
          ? [
              h('p', {}, 'Importez un classeur .xlsx au format du template (par exemple le template EBA rempli puis enregistré au format .xlsx, ou un export de cette application) ou au format de remise EBA (onglets b_01_02, b_05_01… avec les codes c0010, c0020… en première ligne). Les listes de valeurs acceptent le code EBA ou le libellé.'),
              h('div', { class: 'field' }, h('label', {}, 'Fichier'), file),
              h('div', { class: 'field', style: 'margin-top:12px' }, h('label', {}, 'Mode'), mode),
              h('p', {}, h('button', { class: 'btn primary', onclick: doImport }, 'Importer')),
              result,
            ]
          : h('p', { class: 'muted' }, 'L’import est réservé à l’administrateur global de la plateforme.'),
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------
// Administration : utilisateurs et journal
// ---------------------------------------------------------------------------------------
const ROLE_LABELS = {
  global_admin: 'Administrateur global de la plateforme',
  tiers_admin: 'Administrateur de tiers',
  global_reader: 'Lecteur global',
  tiers_reader: 'Lecteur des tiers rattachés',
};
const ROLE_HELP = {
  global_admin: 'Tous les droits : registre complet, référentiel, utilisateurs, import, journal.',
  tiers_admin: 'Lecture et modification des données de ses prestataires rattachés ; lecture du référentiel.',
  global_reader: 'Lecture et export de l’ensemble du registre.',
  tiers_reader: 'Lecture et export des données de ses prestataires rattachés.',
};

function usersView() {
  const out = h('div', {}, h('div', { class: 'empty' }, 'Chargement…'));
  api('/api/users')
    .then((users) => {
      const providers = Object.fromEntries((state.tables['b_05.01'] || []).map((p) => [p.id, p.data['b_05.01.0030'] || p.data['b_05.01.0010']]));
      const tiersNames = Object.fromEntries(state.tiers.map((t) => [t.id, t.data.name]));
      out.replaceChildren(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data' },
            h('thead', {}, h('tr', {}, ['Identifiant', 'Nom', 'Profil', 'Rattachements', 'Statut'].map((x) => h('th', {}, x)))),
            h(
              'tbody',
              {},
              users.map((u) =>
                h(
                  'tr',
                  { onclick: () => userModal(u) },
                  h('td', { class: 'code' }, u.username),
                  h('td', {}, u.displayName),
                  h('td', {}, h('span', { class: 'badge role' }, ROLE_LABELS[u.role])),
                  h('td', {}, u.role.startsWith('tiers') ? [...new Set([...u.tiersIds.map((id) => tiersNames[id]), ...u.providerIds.map((id) => providers[id])].filter(Boolean))].join(', ') || h('span', { class: 'badge erreur' }, 'aucun') : h('span', { class: 'muted' }, 'tous les tiers')),
                  h('td', {}, u.active ? h('span', { class: 'badge ok' }, 'actif') : h('span', { class: 'badge' }, 'désactivé')),
                ),
              ),
            ),
          ),
        ),
      );
    })
    .catch((e) => !e.handled && out.replaceChildren(h('div', { class: 'alert error' }, e.message)));
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Utilisateurs et profils'), h('div', { class: 'muted' }, 'Quatre profils : lecteur global, lecteur des tiers rattachés, administrateur de tiers, administrateur global.')),
      h('button', { class: 'btn primary', onclick: () => userModal(null) }, '+ Nouvel utilisateur'),
    ),
    h('div', { class: 'grid kpis', style: 'margin-bottom:16px' }, Object.entries(ROLE_LABELS).map(([k, l]) => h('div', { class: 'kpi' }, h('b', {}, l), h('div', { class: 'l' }, ROLE_HELP[k])))),
    out,
  );
}

function userModal(user) {
  const username = h('input', { value: user?.username || '', disabled: !!user, autocomplete: 'off' });
  const displayName = h('input', { value: user?.displayName || '' });
  const role = h('select', {}, Object.entries(ROLE_LABELS).map(([k, l]) => h('option', { value: k }, l)));
  role.value = user?.role || 'tiers_reader';
  const password = h('input', { type: 'password', autocomplete: 'new-password', placeholder: user ? 'Laisser vide pour ne pas changer' : '10 caractères minimum' });
  const active = h('input', { type: 'checkbox', checked: user ? user.active : true });
  const selected = new Set(user?.providerIds || []);
  const providers = state.tables['b_05.01'] || [];
  const provBox = h(
    'div',
    { class: 'field' },
    h('label', {}, 'Prestataires TIC rattachés (registre DORA)'),
    providers.length
      ? h(
          'div',
          { class: 'checks' },
          providers.map((p) =>
            h(
              'label',
              {},
              h('input', { type: 'checkbox', value: p.id, checked: selected.has(p.id), onchange: (e) => (e.target.checked ? selected.add(p.id) : selected.delete(p.id)) }),
              p.data['b_05.01.0030'] || '(sans nom)',
              h('span', { class: 'code muted' }, p.data['b_05.01.0010']),
            ),
          ),
        )
      : h('div', { class: 'muted' }, 'Aucun prestataire dans le registre.'),
  );
  const selectedTiers = new Set(user?.tiersIds || []);
  const tiersBox = h(
    'div',
    { class: 'field' },
    h('label', {}, 'Tiers rattachés'),
    h('div', { class: 'meta' }, 'Les tiers liés aux prestataires TIC cochés ci-dessus sont rattachés automatiquement.'),
    state.tiers.length
      ? h(
          'div',
          { class: 'checks' },
          [...state.tiers]
            .sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'))
            .map((t) =>
              h(
                'label',
                {},
                h('input', { type: 'checkbox', checked: selectedTiers.has(t.id), onchange: (e) => (e.target.checked ? selectedTiers.add(t.id) : selectedTiers.delete(t.id)) }),
                t.data.name,
                t.data.doraCode ? h('span', { class: 'qchip q-blue small' }, 'DORA') : null,
              ),
            ),
        )
      : h('div', { class: 'muted' }, 'Aucun tiers.'),
  );
  const help = h('div', { class: 'alert info' });
  const syncRole = () => {
    provBox.hidden = !role.value.startsWith('tiers');
    tiersBox.hidden = provBox.hidden;
    help.textContent = ROLE_HELP[role.value];
  };
  role.addEventListener('change', syncRole);
  syncRole();
  const alert = h('div', { class: 'alert error', hidden: true });
  const fail = (e) => {
    if (e.handled) return;
    alert.hidden = false;
    alert.textContent = e.message;
  };
  const close = openModal({
    narrow: true,
    title: user ? `Utilisateur ${user.username}` : 'Nouvel utilisateur',
    body: [
      alert,
      h(
        'div',
        { style: 'display:grid;gap:12px' },
        h('div', { class: 'field' }, h('label', {}, 'Identifiant'), username),
        h('div', { class: 'field' }, h('label', {}, 'Nom affiché'), displayName),
        h('div', { class: 'field' }, h('label', {}, 'Profil'), role),
        help,
        tiersBox,
        provBox,
        h('div', { class: 'field' }, h('label', {}, user ? 'Réinitialiser le mot de passe' : 'Mot de passe initial'), password),
        h('label', {}, active, ' Compte actif'),
      ),
    ],
    footer: [
      user && user.id !== state.me.id
        ? h(
            'button',
            {
              class: 'btn danger',
              style: 'margin-right:auto',
              onclick: async () => {
                if (!confirm(`Supprimer le compte ${user.username} ?`)) return;
                try {
                  await api(`/api/users/${user.id}`, { method: 'DELETE' });
                  close();
                  route();
                } catch (e) {
                  fail(e);
                }
              },
            },
            'Supprimer',
          )
        : null,
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: async () => {
            const body = { displayName: displayName.value, role: role.value, active: active.checked, providerIds: [...selected], tiersIds: [...selectedTiers] };
            if (password.value) body.password = password.value;
            try {
              if (user) await api(`/api/users/${user.id}`, { method: 'PUT', body });
              else await api('/api/users', { method: 'POST', body: { ...body, username: username.value } });
              close();
              toast('Utilisateur enregistré');
              await reloadAndRender();
            } catch (e) {
              fail(e);
            }
          },
        },
        'Enregistrer',
      ),
    ],
  });
}

function auditView() {
  const out = h('div', { class: 'empty' }, 'Chargement…');
  api('/api/audit')
    .then((rows) =>
      out.replaceWith(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data' },
            h('thead', {}, h('tr', {}, ['Date (UTC)', 'Utilisateur', 'Action', 'Tableau', 'Détail'].map((x) => h('th', {}, x)))),
            h(
              'tbody',
              {},
              rows.map((r) =>
                h('tr', {}, h('td', { class: 'code' }, r.ts), h('td', {}, r.username || '—'), h('td', {}, r.action), h('td', { class: 'code' }, r.tbl ? `${r.tbl}${r.record_id ? ` #${r.record_id}` : ''}` : ''), h('td', { class: 'code', title: r.detail || '' }, (r.detail || '').slice(0, 160))),
              ),
            ),
          ),
        ),
      ),
    )
    .catch((e) => !e.handled && out.replaceWith(h('div', { class: 'alert error' }, e.message)));
  return h('div', {}, h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, "Journal d'audit"), h('div', { class: 'muted' }, '500 dernières actions (connexions, modifications, imports, exports, gestion des utilisateurs).'))), out);
}

// ---------------------------------------------------------------------------------------
// Vue simplifiée des profils lecteurs : prestataires et contrats en langage clair,
// sans tableaux ni codes du registre EBA.
// ---------------------------------------------------------------------------------------
const YES = 'eba_BT:x28';
const NO = 'eba_BT:x29';
const HARD_SUBST = ['eba_ZZ:x959', 'eba_ZZ:x960'];
const DETAIL_KEY = 'dora-vue-detaillee';

const isReader = () => state.me?.role === 'global_reader' || state.me?.role === 'tiers_reader';
function simpleMode() {
  if (!isReader()) return false;
  try {
    return localStorage.getItem(DETAIL_KEY) !== '1';
  } catch {
    return true;
  }
}
function setDetailView(on) {
  try {
    if (on) localStorage.setItem(DETAIL_KEY, '1');
    else localStorage.removeItem(DETAIL_KEY);
  } catch {
    // stockage indisponible : la vue simplifiée reste active
  }
  location.hash = '#/dora';
  route();
}

const today = () => new Date().toISOString().slice(0, 10);
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const frDate = (v) => (!v ? '—' : v === '9999-12-31' ? 'sans échéance' : new Date(`${v}T00:00:00`).toLocaleDateString('fr-FR'));
const money = (v, cur) => {
  if (isEmpty(v)) return '—';
  const c = cur ? cur.replace('eba_CU:', '') : null;
  try {
    return Number(v).toLocaleString('fr-FR', c ? { style: 'currency', currency: c, maximumFractionDigits: 0 } : { maximumFractionDigits: 0 });
  } catch {
    return Number(v).toLocaleString('fr-FR');
  }
};
const L = (list, v) => (isEmpty(v) ? '—' : listLabel(list, v));
const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/** Regroupe les lignes b_02.01 / b_02.02 / b_04.01 par contrat. */
function contractModels() {
  const t = state.tables;
  const fns = new Map((t['b_06.01'] || []).map((r) => [r.data['b_06.01.0010'], r.data]));
  const general = new Map((t['b_02.01'] || []).map((r) => [r.data['b_02.01.0010'], r.data]));
  const byRef = new Map();
  for (const r of t['b_02.02'] || []) {
    const d = r.data;
    const ref = d['b_02.02.0010'];
    if (!byRef.has(ref)) {
      const g = general.get(ref) || {};
      byRef.set(ref, {
        ref,
        providerCode: d['b_02.02.0030'],
        providerName: providerName(d['b_02.02.0030']) || d['b_02.02.0030'],
        type: g['b_02.01.0020'],
        amount: g['b_02.01.0050'],
        currency: g['b_02.01.0040'],
        services: new Set(),
        functions: new Map(),
        entities: new Set(),
        start: d['b_02.02.0070'],
        end: d['b_02.02.0080'],
        noticeEntity: d['b_02.02.0100'],
        noticeProvider: d['b_02.02.0110'],
        law: d['b_02.02.0120'],
        storage: d['b_02.02.0140'],
        dataAtRest: new Set(),
        dataProcessing: new Set(),
        sensitivity: d['b_02.02.0170'],
        reliance: d['b_02.02.0180'],
        rows: [],
      });
    }
    const c = byRef.get(ref);
    c.rows.push(r);
    if (d['b_02.02.0060']) c.services.add(d['b_02.02.0060']);
    if (d['b_02.02.0020']) c.entities.add(entityName(d['b_02.02.0020']) || d['b_02.02.0020']);
    if (d['b_02.02.0150']) c.dataAtRest.add(d['b_02.02.0150']);
    if (d['b_02.02.0160']) c.dataProcessing.add(d['b_02.02.0160']);
    const fid = d['b_02.02.0050'];
    if (fid) {
      const f = fns.get(fid) || {};
      c.functions.set(fid, { id: fid, name: f['b_06.01.0030'] || fid, critical: f['b_06.01.0050'] === YES });
    }
    if (d['b_02.02.0070'] && (!c.start || d['b_02.02.0070'] < c.start)) c.start = d['b_02.02.0070'];
    if (d['b_02.02.0080'] && (!c.end || d['b_02.02.0080'] > c.end)) c.end = d['b_02.02.0080'];
  }
  for (const c of byRef.values()) {
    c.critical = [...c.functions.values()].some((f) => f.critical);
    if (c.end && c.end < today()) c.status = { key: 'termine', label: 'Terminé', cls: '' };
    else if (c.end && c.end <= inDays(180)) c.status = { key: 'echeance', label: 'Échéance proche', cls: 'incomplet' };
    else c.status = { key: 'actif', label: 'En cours', cls: 'ok' };
  }
  return [...byRef.values()].sort((a, b) => a.ref.localeCompare(b.ref, 'fr'));
}

/** Vue synthétique d'un prestataire : identité, contrats, évaluation, sous-traitance. */
function providerModels() {
  const contracts = contractModels();
  const t = state.tables;
  return (t['b_05.01'] || [])
    .map((p) => {
      const d = p.data;
      const code = d['b_05.01.0010'];
      const own = contracts.filter((c) => c.providerCode === code);
      const assess = (t['b_07.01'] || []).filter((r) => r.data['b_07.01.0020'] === code).map((r) => r.data);
      const audits = assess.map((a) => a['b_07.01.0070']).filter((x) => x && x !== '9999-12-31').sort();
      const refs = new Set(own.map((c) => c.ref));
      const subcontractors = (t['b_05.02'] || [])
        .filter((r) => refs.has(r.data['b_05.02.0010']) && Number(r.data['b_05.02.0050']) > 1)
        .map((r) => ({ name: providerName(r.data['b_05.02.0030']) || r.data['b_05.02.0030'], rank: r.data['b_05.02.0050'], service: r.data['b_05.02.0020'] }));
      const hardToReplace = assess.some((a) => HARD_SUBST.includes(a['b_07.01.0050']));
      const noExitPlan = assess.some((a) => a['b_07.01.0080'] === NO);
      const critical = own.some((c) => c.critical);
      return {
        id: p.id,
        name: d['b_05.01.0030'] || '(sans nom)',
        code,
        codeType: d['b_05.01.0020'],
        country: d['b_05.01.0050'],
        spend: d['b_05.01.0070'],
        currency: d['b_05.01.0060'],
        parent: d['b_05.01.0080'],
        personType: d['b_05.01.0040'],
        contracts: own,
        assess,
        lastAudit: audits.at(-1) || null,
        subcontractors,
        critical,
        hardToReplace,
        noExitPlan,
        nextEnd: own.map((c) => c.end).filter((e) => e && e >= today()).sort()[0] || null,
        attention: critical && (hardToReplace || noExitPlan || !audits.length),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

function providerBadges(p) {
  return [
    p.critical ? h('span', { class: 'badge erreur' }, 'Fonction critique') : null,
    p.hardToReplace ? h('span', { class: 'badge incomplet' }, 'Difficile à remplacer') : null,
    p.noExitPlan ? h('span', { class: 'badge incomplet' }, 'Sans plan de sortie') : null,
  ];
}

function providerCard(p) {
  return h(
    'a',
    { class: 'pcard', href: `#/dora/prestataires/${p.id}` },
    h('div', { class: 'pcard-head' }, h('b', {}, p.name), h('span', { class: 'muted small' }, L('LISTCOUNTRY', p.country))),
    h('div', { class: 'pcard-badges' }, providerBadges(p)),
    h(
      'div',
      { class: 'pcard-meta muted small' },
      h('span', {}, plural(p.contracts.length, 'contrat', 'contrats')),
      h('span', {}, `Prochaine échéance : ${p.nextEnd ? frDate(p.nextEnd) : '—'}`),
      h('span', {}, `Dépense annuelle : ${money(p.spend, p.currency)}`),
    ),
  );
}

function readerHome() {
  const providers = providerModels();
  const contracts = contractModels();
  const active = contracts.filter((c) => c.status.key !== 'termine');
  const expiring = contracts.filter((c) => c.status.key === 'echeance').sort((a, b) => a.end.localeCompare(b.end));
  const attention = providers.filter((p) => p.attention);
  const kpi = (v, l, href) => h('a', { class: 'kpi', href }, h('div', { class: 'v' }, v), h('div', { class: 'l' }, l));
  const why = (p) =>
    [p.hardToReplace ? 'difficile à remplacer' : null, p.noExitPlan ? 'pas de plan de sortie' : null, !p.lastAudit ? 'jamais audité' : null].filter(Boolean).join(', ');
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Synthèse DORA'), h('div', { class: 'muted' }, 'L’essentiel sur les prestataires informatiques du registre d’information DORA.'))),
    h(
      'div',
      { class: 'grid kpis' },
      kpi(providers.length, 'Prestataires', '#/dora/prestataires'),
      kpi(active.length, 'Contrats en cours', '#/dora/contrats'),
      kpi(providers.filter((p) => p.critical).length, 'Prestataires soutenant une fonction critique', '#/dora/prestataires'),
      kpi(expiring.length, 'Contrats arrivant à échéance dans les 6 mois', '#/dora/contrats'),
    ),
    h(
      'div',
      { class: 'grid two', style: 'margin-top:16px' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Points d’attention'),
        attention.length
          ? h('ul', { class: 'plain' }, attention.map((p) => h('li', {}, h('a', { href: `#/dora/prestataires/${p.id}` }, p.name), h('div', { class: 'muted small' }, `Fonction critique : ${why(p)}`))))
          : h('div', { class: 'empty' }, 'Aucun point d’attention sur les prestataires critiques.'),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Prochaines échéances'),
        expiring.length
          ? h('ul', { class: 'plain' }, expiring.map((c) => h('li', {}, h('b', {}, frDate(c.end)), ' · ', c.providerName, h('div', { class: 'muted small' }, `Contrat ${c.ref} · ${[...c.services].map((s) => L('LISTANNEXIII', s)).join(', ')}`))))
          : h('div', { class: 'empty' }, 'Aucun contrat n’arrive à échéance dans les 6 prochains mois.'),
      ),
    ),
    h('h2', { style: 'margin-top:8px' }, 'Vos prestataires'),
    providers.length ? h('div', { class: 'pcards' }, providers.map(providerCard)) : h('div', { class: 'card empty' }, 'Aucun prestataire ne vous est rattaché. Contactez l’administrateur de la plateforme.'),
  );
}

function readerProviders() {
  const providers = providerModels();
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Rechercher un prestataire…' });
  const onlyCritical = h('input', { type: 'checkbox' });
  const grid = h('div', { class: 'pcards' });
  const draw = () => {
    const q = search.value.toLowerCase();
    const list = providers.filter((p) => (!q || `${p.name} ${p.code}`.toLowerCase().includes(q)) && (!onlyCritical.checked || p.critical));
    grid.replaceChildren(...(list.length ? list.map(providerCard) : [h('div', { class: 'empty' }, 'Aucun prestataire.')]));
  };
  search.addEventListener('input', draw);
  onlyCritical.addEventListener('change', draw);
  draw();
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Prestataires'), h('div', { class: 'toolbar' }, search, h('label', { class: 'small' }, onlyCritical, ' Fonction critique uniquement'))),
    grid,
  );
}

function readerProvider(id) {
  const p = providerModels().find((x) => x.id === id);
  if (!p) return h('div', { class: 'empty' }, 'Prestataire introuvable ou hors de votre périmètre.');
  const item = (label, value) => [h('dt', {}, label), h('dd', {}, value ?? '—')];
  const a = p.assess;
  const pick = (col, list) => [...new Set(a.map((x) => x[col]).filter(Boolean))].map((v) => (list ? L(list, v) : v)).join(', ') || '—';
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('a', { href: '#/dora/prestataires', class: 'small' }, '← Prestataires'), h('h1', {}, p.name), h('div', { class: 'pcard-badges' }, providerBadges(p))),
    ),
    h(
      'div',
      { class: 'grid two' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'En bref'),
        h(
          'dl',
          { class: 'dl' },
          item('Pays du siège', L('LISTCOUNTRY', p.country)),
          item('Identifiant', `${p.code} (${p.codeType === 'LEI' ? 'LEI' : p.codeType || '—'})`),
          item('Dépense annuelle', money(p.spend, p.currency)),
          item('Contrats', plural(p.contracts.length, 'contrat', 'contrats')),
          item('Société mère', p.parent || '—'),
        ),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Évaluation du risque'),
        a.length
          ? h(
              'dl',
              { class: 'dl' },
              item('Remplaçabilité', pick('b_07.01.0050', 'LIST0701050')),
              item('Pourquoi', pick('b_07.01.0060', 'LIST0701060')),
              item('Plan de sortie', pick('b_07.01.0080', 'LISTBINARY')),
              item('Reprise en interne', pick('b_07.01.0090', 'LIST0701090')),
              item('Impact d’un arrêt', pick('b_07.01.0100', 'LIST0601100')),
              item('Dernier audit', p.lastAudit ? frDate(p.lastAudit) : 'Aucun audit'),
              item('Alternatives identifiées', pick('b_07.01.0110', 'LIST0601050')),
            )
          : h('div', { class: 'empty' }, 'Pas encore d’évaluation pour ce prestataire.'),
      ),
    ),
    h('h2', { style: 'margin-top:8px' }, 'Contrats'),
    p.contracts.length ? p.contracts.map(contractCard) : h('div', { class: 'card empty' }, 'Aucun contrat.'),
    p.subcontractors.length
      ? h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Sous-traitants'),
          h('ul', { class: 'plain' }, p.subcontractors.map((s) => h('li', {}, h('b', {}, s.name), h('div', { class: 'muted small' }, `Rang ${s.rank} · ${L('LISTANNEXIII', s.service)}`)))),
        )
      : null,
  );
}

function contractCard(c) {
  const item = (label, value) => [h('dt', {}, label), h('dd', {}, value || '—')];
  const countries = (set) => [...set].map((v) => L('LISTCOUNTRY', v)).join(', ');
  return h(
    'div',
    { class: 'card' },
    h(
      'div',
      { class: 'page-head', style: 'margin-bottom:8px' },
      h('div', {}, h('h3', { style: 'margin:0' }, [...c.services].map((s) => L('LISTANNEXIII', s)).join(', ') || 'Service non précisé'), h('div', { class: 'muted small' }, `Contrat ${c.ref}`)),
      h('div', { class: 'toolbar' }, c.critical ? h('span', { class: 'badge erreur' }, 'Fonction critique') : null, h('span', { class: `badge ${c.status.cls}` }, c.status.label)),
    ),
    h(
      'dl',
      { class: 'dl' },
      item('Fonctions soutenues', [...c.functions.values()].map((f) => f.name + (f.critical ? ' (critique)' : '')).join(', ')),
      item('Utilisé par', [...c.entities].join(', ')),
      item('Période', `du ${frDate(c.start)} au ${frDate(c.end)}`),
      item('Préavis', c.noticeEntity || c.noticeProvider ? `${c.noticeEntity || '—'} j pour nous, ${c.noticeProvider || '—'} j pour le prestataire` : '—'),
      item('Montant annuel', money(c.amount, c.currency)),
      item('Données stockées', c.storage === YES ? `Oui${c.dataAtRest.size ? ` (${countries(c.dataAtRest)})` : ''}` : c.storage === NO ? 'Non' : '—'),
      item('Données traitées en', countries(c.dataProcessing)),
      item('Sensibilité des données', L('LIST0202170', c.sensitivity)),
      item('Niveau de dépendance', L('LIST0202180', c.reliance)),
    ),
  );
}

function readerContracts() {
  const contracts = contractModels();
  const providersById = new Map((state.tables['b_05.01'] || []).map((p) => [p.data['b_05.01.0010'], p.id]));
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Rechercher…' });
  const status = h('select', { style: 'max-width:200px' }, h('option', { value: '' }, 'Tous les statuts'), h('option', { value: 'actif' }, 'En cours'), h('option', { value: 'echeance' }, 'Échéance proche'), h('option', { value: 'termine' }, 'Terminés'));
  const tbody = h('tbody');
  const draw = () => {
    const q = search.value.toLowerCase();
    const list = contracts.filter((c) => (!status.value || c.status.key === status.value) && (!q || `${c.ref} ${c.providerName} ${[...c.services].map((s) => L('LISTANNEXIII', s)).join(' ')}`.toLowerCase().includes(q)));
    tbody.replaceChildren(
      ...list.map((c) => {
        const pid = providersById.get(c.providerCode);
        return h(
          'tr',
          { onclick: () => pid && (location.hash = `#/dora/prestataires/${pid}`) },
          h('td', {}, h('b', {}, c.providerName), h('div', { class: 'muted small' }, c.ref)),
          h('td', {}, [...c.services].map((s) => L('LISTANNEXIII', s)).join(', ')),
          h('td', {}, [...c.functions.values()].map((f) => f.name).join(', '), c.critical ? [' ', h('span', { class: 'badge erreur' }, 'critique')] : null),
          h('td', {}, frDate(c.end)),
          h('td', {}, h('span', { class: `badge ${c.status.cls}` }, c.status.label)),
        );
      }),
    );
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: 5, class: 'empty' }, 'Aucun contrat.')));
  };
  search.addEventListener('input', draw);
  status.addEventListener('change', draw);
  draw();
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Contrats'), h('div', { class: 'toolbar' }, search, status)),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Prestataire', 'Service', 'Fonction soutenue', 'Fin', 'Statut'].map((x) => h('th', {}, x)))), tbody)),
  );
}

function readerExport() {
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('h1', {}, 'Exporter')),
    h(
      'div',
      { class: 'card' },
      h('p', {}, 'Téléchargez les informations que vous consultez dans un fichier Excel au format officiel du registre d’information DORA.'),
      h('p', { class: 'muted small' }, state.me.permissions.global ? 'Le fichier contient l’ensemble du registre.' : 'Le fichier est limité à vos prestataires.'),
      h('div', { class: 'toolbar' }, h('a', { class: 'btn primary', href: '/api/export.xlsx' }, 'Télécharger le registre DORA'), h('a', { class: 'btn', href: '/api/tiers/export.xlsx' }, 'Télécharger les tiers et prestations')),
    ),
  );
}

// ---------------------------------------------------------------------------------------
// Tiers et prestations (tous les tiers, DORA ou non)
// ---------------------------------------------------------------------------------------
const AVATAR_COLORS = ['blue', 'green', 'purple', 'orange', 'teal', 'red'];

function initials(name) {
  const words = String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '?') + (words[1]?.[0] || '')).toUpperCase();
}
function avatar(name, big) {
  let hsh = 0;
  for (const ch of String(name)) hsh = (hsh * 31 + ch.codePointAt(0)) >>> 0;
  return h('span', { class: `avatar a-${AVATAR_COLORS[hsh % AVATAR_COLORS.length]}${big ? ' big' : ''}`, 'aria-hidden': 'true' }, initials(name));
}
function countryName(cc) {
  if (!cc) return '';
  try {
    return regionNames?.of(cc) || cc;
  } catch {
    return cc;
  }
}

/** Pastille d'une qualification ; ★ quand la prestation est marquée critique pour cette qualification. */
function qChip(code, critical, opts = {}) {
  const q = regBy(code);
  if (!q) return null;
  return h('span', { class: `qchip q-${q.color}${opts.small ? ' small' : ''}`, title: critical && q.criticalLabel ? `${q.name} – ${q.criticalLabel}` : q.name }, critical ? '★ ' : '', q.label);
}
/** Régulations actives, dans l'ordre choisi par l'administrateur. */
const regs = () => state.regulations.filter((r) => r.active);
const regBy = (code) => state.regulations.find((r) => r.code === code);
const qualifCodes = (p) => regs().map((q) => q.code).filter((c) => p.data.qualifications?.[c]);
const isCritical = (p) => !!p.data.qualifications?.PECI || Object.values(p.data.qualifications || {}).some((v) => v.critical);
function prestaChips(p, small) {
  const codes = qualifCodes(p);
  return codes.length ? codes.map((c) => qChip(c, p.data.qualifications[c].critical, { small })) : h('span', { class: 'qchip q-none' + (small ? ' small' : '') }, 'Non qualifiée');
}

/** Tiers enrichis de leurs prestations et qualifications cumulées. */
function tiersModels() {
  const byTiers = new Map();
  for (const p of state.prestations) (byTiers.get(p.tiers_id) || byTiers.set(p.tiers_id, []).get(p.tiers_id)).push(p);
  return state.tiers
    .map((t) => {
      const prestations = byTiers.get(t.id) || [];
      const quals = new Map();
      for (const p of prestations) for (const c of qualifCodes(p)) quals.set(c, quals.get(c) || !!p.data.qualifications[c].critical);
      const active = prestations.filter((p) => p.data.status !== 'terminee');
      const cost = active.reduce((a, p) => a + (Number(p.data.annualCost) || 0), 0);
      return { ...t, prestations, quals, cost, critical: prestations.some(isCritical) };
    })
    .sort((a, b) => a.data.name.localeCompare(b.data.name, 'fr'));
}
function tiersChips(t, small) {
  return t.quals.size
    ? regs().filter((q) => t.quals.has(q.code)).map((q) => qChip(q.code, t.quals.get(q.code), { small }))
    : h('span', { class: 'qchip q-none' + (small ? ' small' : '') }, t.prestations.length ? 'Non qualifié' : 'Aucune prestation');
}

const tiersById = (id) => state.tiers.find((t) => t.id === id);
const directionBy = (id) => state.org.directions.find((d) => d.id === id);
const managerBy = (id) => state.org.managers.find((m) => m.id === id);
/** Organisation interne d'une prestation : direction COMEX, responsable COMEX, responsable du tiers. */
function orgOf(p) {
  const dir = directionBy(p.data.directionId);
  return { direction: dir?.title || '', head: dir?.head || '', manager: personName(managerBy(p.data.managerId)) || p.data.owner || '' };
}
const euros = (v) => (isEmpty(v) || !Number(v) ? '—' : Number(v).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }));
const reviewDue = (p) => p.data.status !== 'terminee' && p.data.nextReview && p.data.nextReview <= inDays(30);
const endingSoon = (p) => p.data.status !== 'terminee' && p.data.end && p.data.end >= today() && p.data.end <= inDays(180);

function homeView() {
  const tiers = tiersModels();
  const prestations = state.prestations;
  const live = prestations.filter((p) => p.data.status !== 'terminee');
  const unqualified = live.filter((p) => !qualifCodes(p).length);
  const due = live.filter(reviewDue).sort((a, b) => a.data.nextReview.localeCompare(b.data.nextReview));
  const ending = live.filter(endingSoon).sort((a, b) => a.data.end.localeCompare(b.data.end));
  const combos = new Map();
  for (const p of live) {
    const codes = qualifCodes(p);
    if (codes.length > 1) {
      const key = codes.map((c) => regBy(c).label).join(' + ');
      combos.set(key, (combos.get(key) || 0) + 1);
    }
  }
  const search = h('input', {
    class: 'search hero-search',
    type: 'search',
    placeholder: 'Rechercher un tiers ou une prestation…',
    onkeydown: (e) => {
      if (e.key === 'Enter') {
        tiersFilter.q = search.value;
        location.hash = '#/tiers';
      }
    },
  });
  const qTile = (q) => {
    const ps = live.filter((p) => p.data.qualifications?.[q.code]);
    const nTiers = new Set(ps.map((p) => p.tiers_id)).size;
    const crit = ps.filter((p) => p.data.qualifications[q.code].critical).length;
    return h(
      'a',
      { class: `qtile q-${q.color}`, href: `#/prestations/${q.code}` },
      h('div', { class: 'qtile-head' }, h('span', { class: 'qtile-label' }, q.label), h('span', { class: 'qtile-n' }, ps.length)),
      h('div', { class: 'qtile-name' }, q.name),
      h('div', { class: 'muted small' }, plural(nTiers, 'tiers', 'tiers'), q.criticalLabel && crit ? ` · ${crit} critique${crit > 1 ? 's' : ''}` : ''),
    );
  };
  const todo = (title, list, render, empty) =>
    h('div', { class: 'card' }, h('h2', {}, title, ' ', h('span', { class: `badge ${list.length ? 'incomplet' : 'ok'}` }, list.length)), list.length ? h('ul', { class: 'plain' }, list.slice(0, 6).map(render)) : h('div', { class: 'empty small' }, empty));
  const prestaLine = (p, extra) =>
    h('li', {}, h('a', { href: `#/tiers/${p.tiers_id}` }, p.data.title), h('div', { class: 'muted small' }, tiersById(p.tiers_id)?.data.name, extra ? ` · ${extra}` : ''));
  const recent = [...tiers].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')).slice(0, 5);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'hero' },
      h('div', {}, h('h1', {}, `Bonjour ${state.me.displayName}`), h('p', {}, `${plural(tiers.length, 'tiers', 'tiers')} et ${plural(live.length, 'prestation en cours', 'prestations en cours')} dans votre périmètre.`)),
      h('div', { class: 'hero-actions' }, search, state.me.permissions.createTiers ? h('button', { class: 'btn primary', onclick: () => tiersModal(null) }, '+ Nouveau tiers') : null),
    ),
    h('h2', { class: 'section-title' }, 'Prestations par qualification'),
    h('div', { class: 'qtiles' }, regs().map(qTile), h('a', { class: 'qtile q-none', href: '#/prestations/aucune' }, h('div', { class: 'qtile-head' }, h('span', { class: 'qtile-label' }, 'À qualifier'), h('span', { class: 'qtile-n' }, unqualified.length)), h('div', { class: 'qtile-name' }, 'Prestations sans qualification'), h('div', { class: 'muted small' }, 'à examiner'))),
    h(
      'div',
      { class: 'grid three', style: 'margin-top:16px' },
      todo('Revues à mener', due, (p) => prestaLine(p, `revue ${frDate(p.data.nextReview)}`), 'Aucune revue prévue dans les 30 jours.'),
      todo('Échéances dans les 6 mois', ending, (p) => prestaLine(p, `fin ${frDate(p.data.end)}`), 'Aucune prestation n’arrive à échéance.'),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Cumuls de qualifications'),
        combos.size
          ? h('ul', { class: 'plain' }, [...combos].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => h('li', { class: 'row' }, h('span', {}, k), h('b', {}, n))))
          : h('div', { class: 'empty small' }, 'Aucune prestation ne cumule plusieurs qualifications.'),
        h('p', { class: 'muted small' }, 'Une même prestation peut relever de plusieurs réglementations.'),
      ),
    ),
    h(
      'div',
      { class: 'page-head', style: 'margin-top:8px' },
      h('h2', { class: 'section-title' }, 'Tiers récemment mis à jour'),
      h('a', { href: '#/tiers' }, 'Voir tous les tiers →'),
    ),
    recent.length ? h('div', { class: 'tcards' }, recent.map(tiersCard)) : h('div', { class: 'card empty' }, 'Aucun tiers pour le moment.'),
  );
}

function tiersCard(t) {
  const d = t.data;
  return h(
    'a',
    { class: 'tcard', href: `#/tiers/${t.id}` },
    h('div', { class: 'tcard-head' }, avatar(d.name), h('div', { class: 'tcard-title' }, h('b', {}, d.name), h('div', { class: 'muted small' }, [d.category, countryName(d.country)].filter(Boolean).join(' · ') || '—'))),
    h('div', { class: 'chips' }, tiersChips(t, true)),
    h('div', { class: 'tcard-foot muted small' }, h('span', {}, plural(t.prestations.length, 'prestation', 'prestations')), h('span', {}, t.cost ? `${euros(t.cost)} / an` : '')),
  );
}

const tiersFilter = { q: '', qual: '', category: '' };

function filterChips(current, onPick, withNone) {
  const chip = (code, label, color) =>
    h('button', { class: `fchip${color ? ` q-${color}` : ''}${current() === code ? ' on' : ''}`, onclick: () => onPick(code) }, label);
  return h('div', { class: 'fchips' }, chip('', 'Toutes'), regs().map((q) => chip(q.code, q.label, q.color)), withNone ? chip('aucune', 'Sans qualification', 'none') : null);
}

function tiersList() {
  const all = tiersModels();
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Rechercher un tiers…', value: tiersFilter.q });
  const category = h('select', {}, h('option', { value: '' }, 'Toutes les catégories'), TIERS_CATEGORIES.map((c) => h('option', { value: c }, c)));
  category.value = tiersFilter.category;
  const grid = h('div', { class: 'tcards' });
  const chipsBox = h('div');
  const info = h('div', { class: 'muted small' });
  const draw = () => {
    const q = tiersFilter.q.toLowerCase();
    const list = all.filter(
      (t) =>
        (!q || `${t.data.name} ${t.data.identifier} ${t.prestations.map((p) => p.data.title).join(' ')}`.toLowerCase().includes(q)) &&
        (!tiersFilter.category || t.data.category === tiersFilter.category) &&
        (!tiersFilter.qual || (tiersFilter.qual === 'aucune' ? !t.quals.size : t.quals.has(tiersFilter.qual))),
    );
    chipsBox.replaceChildren(filterChips(() => tiersFilter.qual, (c) => ((tiersFilter.qual = c), draw()), true));
    info.textContent = `${plural(list.length, 'tiers affiché', 'tiers affichés')} sur ${all.length}`;
    grid.replaceChildren(...(list.length ? list.map(tiersCard) : [h('div', { class: 'card empty' }, 'Aucun tiers ne correspond à ces critères.')]));
  };
  search.addEventListener('input', () => ((tiersFilter.q = search.value), draw()));
  category.addEventListener('change', () => ((tiersFilter.category = category.value), draw()));
  draw();
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Tiers'), h('div', { class: 'muted' }, 'Toutes les entreprises qui fournissent une prestation, qu’elle relève de DORA ou non.')),
      h(
        'div',
        { class: 'toolbar' },
        h('a', { class: 'btn', href: '/api/tiers/export.xlsx' }, 'Exporter (.xlsx)'),
        state.me.permissions.createTiers ? h('button', { class: 'btn primary', onclick: () => tiersModal(null) }, '+ Nouveau tiers') : null,
      ),
    ),
    h('div', { class: 'filters' }, h('div', { class: 'toolbar' }, search, category, info), chipsBox),
    grid,
  );
}

function tiersPage(id) {
  const t = tiersModels().find((x) => x.id === id);
  if (!t) return h('div', { class: 'empty' }, 'Tiers introuvable ou hors de votre périmètre.');
  const d = t.data;
  const doraProvider = d.doraCode ? (state.tables['b_05.01'] || []).find((r) => r.data['b_05.01.0010'] === d.doraCode) : null;
  const item = (label, value) => [h('dt', {}, label), h('dd', {}, value || '—')];
  const sorted = [...t.prestations].sort((a, b) => (a.data.status === 'terminee') - (b.data.status === 'terminee') || a.data.title.localeCompare(b.data.title, 'fr'));
  return h(
    'div',
    {},
    h('a', { href: '#/tiers', class: 'small' }, '← Tous les tiers'),
    h(
      'div',
      { class: 'tiers-hero' },
      avatar(d.name, true),
      h(
        'div',
        { class: 'tiers-hero-body' },
        h('h1', {}, d.name),
        h('div', { class: 'muted' }, [d.category, countryName(d.country), d.identifier ? `${d.idType || 'Identifiant'} ${d.identifier}` : null].filter(Boolean).join(' · ')),
        h('div', { class: 'chips', style: 'margin-top:8px' }, tiersChips(t)),
      ),
      h(
        'div',
        { class: 'toolbar' },
        doraProvider ? h('a', { class: 'btn', href: `#/dora/prestataires/${doraProvider.id}` }, 'Fiche registre DORA') : null,
        t.editable ? h('button', { class: 'btn', onclick: () => tiersModal(t) }, 'Modifier') : null,
        state.me.role === 'global_admin'
          ? h(
              'button',
              {
                class: 'btn danger',
                onclick: async () => {
                  if (!confirm(`Supprimer le tiers « ${d.name} » et ses ${t.prestations.length} prestation(s) ?`)) return;
                  try {
                    await api(`/api/tiers/${t.id}`, { method: 'DELETE' });
                    toast('Tiers supprimé');
                    location.hash = '#/tiers';
                    await reloadAndRender();
                  } catch (e) {
                    if (!e.handled) toast(e.message);
                  }
                },
              },
              'Supprimer',
            )
          : null,
      ),
    ),
    h(
      'div',
      { class: 'tiers-layout' },
      h(
        'div',
        {},
        contactsCard(t),
        h(
          'div',
          { class: 'page-head' },
          h('h2', { class: 'section-title' }, `Prestations (${t.prestations.length})`),
          t.editable ? h('button', { class: 'btn primary', onclick: () => prestationModal(t.id, null) }, '+ Ajouter une prestation') : null,
        ),
        sorted.length ? sorted.map((p) => prestationCard(p, t.editable)) : h('div', { class: 'card empty' }, 'Aucune prestation pour ce tiers.'),
      ),
      h(
        'div',
        {},
        h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Informations'),
          h(
            'dl',
            { class: 'dl' },
            item('Catégorie', d.category),
            item('Identifiant', d.identifier ? `${d.identifier}${d.idType ? ` (${d.idType})` : ''}` : ''),
            item('Pays', countryName(d.country)),
            item('Groupe', d.group),
            item('Coût annuel', t.cost ? euros(t.cost) : ''),
            item('Registre DORA', doraProvider ? 'Prestataire TIC déclaré' : d.doraCode ? `Code ${d.doraCode}` : 'Non déclaré'),
          ),
          d.notes ? h('p', { class: 'notes' }, d.notes) : null,
        ),
      ),
    ),
  );
}

function contactsCard(t) {
  const list = t.data.contacts || [];
  const link = (v, scheme) => (v ? h('a', { href: `${scheme}:${scheme === 'tel' ? v.replace(/[^0-9+]/g, '') : v}` }, v) : '—');
  return h(
    'div',
    { class: 'card contacts-card' },
    h(
      'div',
      { class: 'page-head' },
      h('h2', {}, `Contacts chez le tiers (${list.length})`),
      t.editable ? h('button', { class: 'btn small-btn', onclick: () => tiersModal(t, true) }, list.length ? 'Modifier les contacts' : '+ Ajouter des contacts') : null,
    ),
    list.length
      ? h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data contacts' },
            h('thead', {}, h('tr', {}, ['Fonction', 'Prénom', 'Nom', 'E-mail', 'Téléphone'].map((x) => h('th', {}, x)))),
            h('tbody', {}, list.map((c) => h('tr', {}, h('td', {}, h('b', {}, c.role)), h('td', {}, c.firstName || '—'), h('td', {}, c.lastName || '—'), h('td', {}, link(c.email, 'mailto')), h('td', { class: 'nowrap' }, link(c.phone, 'tel'))))),
          ),
        )
      : h('p', { class: 'muted small' }, 'Aucun contact renseigné (DG, DPO, RSSI, interlocuteur opérationnel…).'),
  );
}

function prestationCard(p, editable) {
  const d = p.data;
  const st = STATUS_BY_CODE[d.status] || STATUS_BY_CODE.active;
  const notes = qualifCodes(p).filter((c) => d.qualifications[c].note).map((c) => h('div', { class: 'small' }, h('b', {}, `${regBy(c).label} : `), d.qualifications[c].note));
  const fact = (label, value) => (value ? h('div', { class: 'fact' }, h('span', { class: 'muted small' }, label), h('span', {}, value)) : null);
  return h(
    'div',
    { class: `card presta${d.status === 'terminee' ? ' ended' : ''}` },
    h(
      'div',
      { class: 'presta-head' },
      h('div', {}, h('h3', {}, d.title), h('div', { class: 'muted small' }, [d.domain, d.entity].filter(Boolean).join(' · '))),
      h('span', { class: `badge ${st.cls}` }, st.label),
    ),
    h('div', { class: 'chips' }, prestaChips(p)),
    d.description ? h('p', { class: 'small' }, d.description) : null,
    h(
      'div',
      { class: 'facts' },
      fact('Période', d.start || d.end ? `${d.start ? frDate(d.start) : '…'} → ${d.end ? frDate(d.end) : 'sans échéance'}` : ''),
      fact('Direction COMEX', orgOf(p).direction),
      fact('Responsable COMEX', orgOf(p).head),
      fact('Responsable du tiers', orgOf(p).manager),
      fact('Coût annuel', d.annualCost ? euros(d.annualCost) : ''),
      fact('Prochaine revue', d.nextReview ? h('span', { class: reviewDue(p) ? 'due' : '' }, frDate(d.nextReview)) : ''),
      fact('Contrat DORA', d.doraContract),
    ),
    notes.length ? h('div', { class: 'qnotes' }, notes) : null,
    editable
      ? h(
          'div',
          { class: 'presta-actions' },
          h('button', { class: 'btn small-btn', onclick: () => prestationModal(p.tiers_id, p) }, 'Modifier'),
          h(
            'button',
            {
              class: 'btn link small',
              onclick: async () => {
                if (!confirm(`Supprimer la prestation « ${d.title} » ?`)) return;
                try {
                  await api(`/api/prestations/${p.id}`, { method: 'DELETE' });
                  toast('Prestation supprimée');
                  await reloadAndRender();
                } catch (e) {
                  if (!e.handled) toast(e.message);
                }
              },
            },
            'Supprimer',
          ),
        )
      : null,
  );
}

const prestaFilter = { q: '', status: 'live' };

function prestationsList(qualArg) {
  const qual = { v: qualArg || '' };
  const names = new Map(state.tiers.map((t) => [t.id, t.data.name]));
  const search = h('input', { class: 'search', type: 'search', placeholder: 'Rechercher…', value: prestaFilter.q });
  const status = h('select', {}, h('option', { value: 'live' }, 'En cours et en projet'), h('option', { value: '' }, 'Tous les statuts'), STATUSES.map((s) => h('option', { value: s.code }, s.label)));
  status.value = prestaFilter.status;
  const chipsBox = h('div');
  const tbody = h('tbody');
  const info = h('div', { class: 'muted small' });
  const draw = () => {
    const q = prestaFilter.q.toLowerCase();
    const list = state.prestations
      .filter(
        (p) =>
          (!q || `${p.data.title} ${names.get(p.tiers_id)} ${p.data.domain} ${p.data.entity} ${Object.values(orgOf(p)).join(' ')}`.toLowerCase().includes(q)) &&
          (prestaFilter.status === 'live' ? p.data.status !== 'terminee' : !prestaFilter.status || p.data.status === prestaFilter.status) &&
          (!qual.v || (qual.v === 'aucune' ? !qualifCodes(p).length : p.data.qualifications?.[qual.v])),
      )
      .sort((a, b) => (names.get(a.tiers_id) || '').localeCompare(names.get(b.tiers_id) || '', 'fr') || a.data.title.localeCompare(b.data.title, 'fr'));
    chipsBox.replaceChildren(filterChips(() => qual.v, (c) => ((qual.v = c), history.replaceState(null, '', c ? `#/prestations/${c}` : '#/prestations'), draw()), true));
    info.textContent = plural(list.length, 'prestation', 'prestations');
    tbody.replaceChildren(
      ...list.map((p) => {
        const st = STATUS_BY_CODE[p.data.status] || STATUS_BY_CODE.active;
        return h(
          'tr',
          { onclick: () => (location.hash = `#/tiers/${p.tiers_id}`) },
          h('td', {}, h('b', {}, p.data.title), h('div', { class: 'muted small' }, [p.data.domain, p.data.entity].filter(Boolean).join(' · '))),
          h('td', {}, h('span', { class: 'tiers-cell' }, avatar(names.get(p.tiers_id) || '?'), names.get(p.tiers_id))),
          h('td', {}, h('div', { class: 'chips' }, prestaChips(p, true))),
          h('td', {}, orgOf(p).manager || '—', h('div', { class: 'muted small' }, orgOf(p).direction)),
          h('td', {}, p.data.end ? frDate(p.data.end) : '—'),
          h('td', {}, h('span', { class: `badge ${st.cls}` }, st.label)),
        );
      }),
    );
    if (!list.length) tbody.append(h('tr', {}, h('td', { colspan: 6, class: 'empty' }, 'Aucune prestation ne correspond à ces critères.')));
  };
  search.addEventListener('input', () => ((prestaFilter.q = search.value), draw()));
  status.addEventListener('change', () => ((prestaFilter.status = status.value), draw()));
  draw();
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Prestations'), h('div', { class: 'muted' }, `Chaque prestation porte ses qualifications : ${regs().map((r) => r.label).join(', ')}.`)),
      h('a', { class: 'btn', href: '/api/tiers/export.xlsx' }, 'Exporter (.xlsx)'),
    ),
    h('div', { class: 'filters' }, h('div', { class: 'toolbar' }, search, status, info), chipsBox),
    h('div', { class: 'table-wrap' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Prestation', 'Tiers', 'Qualifications', 'Responsable', 'Fin', 'Statut'].map((x) => h('th', {}, x)))), tbody)),
  );
}

/** Champ de formulaire simple avec message d'erreur. */
function formField(label, input, { required, hint, wide } = {}) {
  const err = h('div', { class: 'err', hidden: true });
  const el = h('div', { class: `field${wide ? ' wide' : ''}` }, h('label', {}, label, required ? h('span', { class: 'req' }, ' *') : null), hint ? h('div', { class: 'meta' }, hint) : null, input, err);
  el.setError = (msg) => {
    err.hidden = !msg;
    err.textContent = msg || '';
    el.classList.toggle('has-err', !!msg);
  };
  return el;
}
const selectOf = (options, value, empty = '—') => {
  const s = h('select', {}, h('option', { value: '' }, empty), options.map((o) => (Array.isArray(o) ? h('option', { value: o[0] }, o[1]) : h('option', { value: o }, o))));
  s.value = value || '';
  return s;
};

function saveHandler(alert, fields, run) {
  return async () => {
    alert.hidden = true;
    Object.values(fields).forEach((f) => f.setError(null));
    try {
      await run();
    } catch (e) {
      if (e.handled) return;
      alert.hidden = false;
      alert.textContent = e.message;
      for (const [k, msg] of Object.entries(e.data?.errors || {})) fields[k]?.setError(msg);
    }
  };
}

/** Tableau éditable des contacts d'un tiers (fonction, prénom, nom, e-mail, téléphone). */
function contactsEditor(initial) {
  const rolesList = h('datalist', { id: 'dl-contact-roles' }, CONTACT_ROLES.map((r) => h('option', { value: r })));
  const tbody = h('tbody');
  const rows = [];
  const addRow = (c = {}) => {
    const inputs = {
      role: h('input', { value: c.role || '', list: 'dl-contact-roles', placeholder: 'Ex. DG, DPO…', 'aria-label': 'Fonction' }),
      firstName: h('input', { value: c.firstName || '', 'aria-label': 'Prénom' }),
      lastName: h('input', { value: c.lastName || '', 'aria-label': 'Nom' }),
      email: h('input', { type: 'email', value: c.email || '', 'aria-label': 'E-mail' }),
      phone: h('input', { type: 'tel', value: c.phone || '', 'aria-label': 'Téléphone' }),
    };
    const row = { inputs };
    row.tr = h(
      'tr',
      {},
      Object.values(inputs).map((el) => h('td', {}, el)),
      h('td', {}, h('button', { class: 'btn link', title: 'Retirer ce contact', 'aria-label': 'Retirer ce contact', onclick: () => (row.tr.remove(), rows.splice(rows.indexOf(row), 1)) }, '✕')),
    );
    rows.push(row);
    tbody.append(row.tr);
    return inputs;
  };
  (initial || []).forEach(addRow);
  if (!rows.length) addRow();
  const el = h(
    'div',
    { class: 'contacts-editor' },
    rolesList,
    h('div', { class: 'table-wrap' }, h('table', { class: 'data edit' }, h('thead', {}, h('tr', {}, ['Fonction', 'Prénom', 'Nom', 'E-mail', 'Téléphone', ''].map((x) => h('th', {}, x)))), tbody)),
    h('button', { class: 'btn small-btn', onclick: () => addRow().role.focus() }, '+ Ajouter un contact'),
  );
  el.value = () => rows.map((r) => Object.fromEntries(Object.entries(r.inputs).map(([k, x]) => [k, x.value])));
  return el;
}

function tiersModal(t, focusContacts) {
  const d = t?.data || {};
  const countries = [...(state.lists.LISTCOUNTRY?.keys() || [])].map((c) => c.replace('eba_GA:', '')).filter((c) => /^[A-Z]{2}$/.test(c));
  const inputs = {
    name: h('input', { value: d.name || '' }),
    category: selectOf(TIERS_CATEGORIES, d.category),
    idType: selectOf(ID_TYPES, d.idType),
    identifier: h('input', { value: d.identifier || '', placeholder: 'SIREN, LEI, n° de TVA…' }),
    country: selectOf(countries.map((c) => [c, `${countryName(c)} (${c})`]).sort((a, b) => a[1].localeCompare(b[1], 'fr')), d.country || (t ? '' : 'FR')),
    group: h('input', { value: d.group || '', placeholder: 'Société mère ou groupe' }),
    notes: h('textarea', { rows: 3 }, d.notes || ''),
  };
  const contacts = contactsEditor(d.contacts);
  const fields = {
    name: formField('Nom du tiers', inputs.name, { required: true, wide: true }),
    category: formField('Catégorie', inputs.category),
    country: formField('Pays', inputs.country),
    idType: formField('Type d’identifiant', inputs.idType),
    identifier: formField('Identifiant', inputs.identifier),
    group: formField('Groupe', inputs.group),
    notes: formField('Notes', inputs.notes, { wide: true }),
    contacts: formField('Contacts chez le tiers', contacts, { wide: true, hint: 'Une ligne par fonction : DG, DPO, RSSI, interlocuteur opérationnel…' }),
  };
  const alert = h('div', { class: 'alert error', hidden: true });
  const close = openModal({
    title: t ? `Modifier ${d.name}` : 'Nouveau tiers',
    body: [alert, h('div', { class: 'form-grid' }, Object.values(fields))],
    footer: [
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: saveHandler(alert, fields, async () => {
            const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
            data.contacts = contacts.value();
            const saved = t ? await api(`/api/tiers/${t.id}`, { method: 'PUT', body: { data } }) : await api('/api/tiers', { method: 'POST', body: { data } });
            close();
            toast(t ? 'Tiers enregistré' : 'Tiers créé');
            location.hash = `#/tiers/${saved.id}`;
            await reloadAndRender();
          }),
        },
        t ? 'Enregistrer' : 'Créer le tiers',
      ),
    ],
  });
  if (focusContacts) fields.contacts.scrollIntoView({ block: 'start' });
}

const ORG_FIELDS = ['directionId', 'comexHead', 'managerId'];

function prestationModal(tiersId, p) {
  const d = p?.data || {};
  const entities = [...new Set([...(state.tables['b_01.02'] || []).map((r) => r.data['b_01.02.0020']), ...state.prestations.map((x) => x.data.entity)].filter(Boolean))].sort();
  const contracts = [...new Set((state.tables['b_02.01'] || []).map((r) => r.data['b_02.01.0010']).filter(Boolean))].sort();
  const entityList = h('datalist', { id: 'dl-entities' }, entities.map((e) => h('option', { value: e })));
  const contractList = h('datalist', { id: 'dl-contracts' }, contracts.map((c) => h('option', { value: c })));
  const inputs = {
    title: h('input', { value: d.title || '', placeholder: 'Ex. Hébergement du site bancaire' }),
    domain: selectOf(PRESTATION_DOMAINS, d.domain),
    entity: h('input', { value: d.entity || '', list: 'dl-entities', placeholder: 'Entité qui bénéficie de la prestation' }),
    directionId: selectOf(state.org.directions.map((x) => [String(x.id), x.title]), d.directionId ? String(d.directionId) : '', 'Choisir une direction…'),
    managerId: selectOf(
      state.org.managers.map((m) => [String(m.id), `${personName(m)}${directionBy(m.directionId) ? ` · ${directionBy(m.directionId).title}` : ''}`]),
      d.managerId ? String(d.managerId) : '',
      'Choisir un responsable…',
    ),
    status: selectOf(STATUSES.map((s) => [s.code, s.label]), d.status || 'active'),
    start: h('input', { type: 'date', value: d.start || '' }),
    end: h('input', { type: 'date', value: d.end || '' }),
    annualCost: h('input', { inputmode: 'decimal', value: d.annualCost || '', placeholder: 'en euros' }),
    nextReview: h('input', { type: 'date', value: d.nextReview || '' }),
    description: h('textarea', { rows: 2 }, d.description || ''),
  };
  inputs.status.querySelector('option[value=""]')?.remove();
  const fields = {
    title: formField('Intitulé', inputs.title, { required: true, wide: true }),
    domain: formField('Domaine', inputs.domain),
    entity: formField('Entité bénéficiaire', inputs.entity),
    directionId: formField('Direction COMEX', inputs.directionId),
    comexHead: formField('Responsable COMEX', h('div', { class: 'readonly-value' })),
    managerId: formField('Responsable du tiers', inputs.managerId, { hint: d.owner && !d.managerId ? `Saisie précédente : ${d.owner}` : null }),
    status: formField('Statut', inputs.status),
    start: formField('Début', inputs.start),
    end: formField('Fin', inputs.end, { hint: 'Laisser vide si sans échéance' }),
    annualCost: formField('Coût annuel', inputs.annualCost),
    nextReview: formField('Prochaine revue', inputs.nextReview),
    description: formField('Description', inputs.description, { wide: true }),
  };
  // Le responsable COMEX découle de la direction ; choisir un responsable de tiers propose sa direction.
  const headBox = fields.comexHead.querySelector('.readonly-value');
  const syncHead = () => (headBox.textContent = directionBy(Number(inputs.directionId.value))?.head || '—');
  inputs.directionId.addEventListener('change', syncHead);
  inputs.managerId.addEventListener('change', () => {
    const m = managerBy(Number(inputs.managerId.value));
    if (m?.directionId && !inputs.directionId.value) {
      inputs.directionId.value = String(m.directionId);
      syncHead();
    }
  });
  syncHead();
  if (!state.org.directions.length && !state.org.managers.length) {
    fields.directionId.querySelector('label').after(h('div', { class: 'meta' }, state.me.permissions.manageUsers ? h('a', { href: '#/organisation' }, 'Renseigner l’organisation de la structure') : 'Organisation de la structure non renseignée'));
  }
  const doraContract = h('input', { value: d.doraContract || '', list: 'dl-contracts', placeholder: 'Référence de l’accord (b_02.01)' });
  const quals = {};
  const qCards = regs().map((q) => {
    const cur = d.qualifications?.[q.code];
    const on = h('input', { type: 'checkbox', checked: !!cur });
    const critical = q.criticalLabel ? h('input', { type: 'checkbox', checked: !!cur?.critical }) : null;
    const note = h('textarea', { rows: 2, placeholder: 'Justification (facultatif)' }, cur?.note || '');
    const details = h(
      'div',
      { class: 'qcard-details' },
      critical ? h('label', { class: 'small' }, critical, ' ', q.criticalLabel) : null,
      q.code === state.doraCode ? h('div', { class: 'field' }, h('label', { class: 'small' }, 'Contrat du registre DORA'), doraContract) : null,
      note,
    );
    const card = h('div', { class: `qcard q-${q.color}` }, h('label', { class: 'qcard-head' }, on, h('div', {}, h('b', {}, q.name), h('div', { class: 'muted small' }, q.desc))), details);
    const sync = () => {
      card.classList.toggle('on', on.checked);
      details.hidden = !on.checked;
    };
    on.addEventListener('change', sync);
    sync();
    quals[q.code] = { on, critical, note };
    return card;
  });
  const alert = h('div', { class: 'alert error', hidden: true });
  const tiersName = tiersById(tiersId)?.data.name || '';
  const close = openModal({
    title: p ? `Modifier la prestation` : `Nouvelle prestation · ${tiersName}`,
    body: [
      alert,
      entityList,
      contractList,
      h('div', { class: 'form-grid' }, Object.entries(fields).filter(([k]) => !ORG_FIELDS.includes(k)).map(([, f]) => f)),
      h('h3', { class: 'form-title' }, 'Organisation interne'),
      h('div', { class: 'form-grid' }, ORG_FIELDS.map((k) => fields[k])),
      h('h3', { class: 'form-title' }, 'Qualifications réglementaires'),
      h('p', { class: 'muted small' }, 'Cochez toutes les qualifications qui s’appliquent : une même prestation peut en cumuler plusieurs.'),
      h('div', { class: 'qcards' }, qCards),
    ],
    footer: [
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: saveHandler(alert, fields, async () => {
            const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
            data.qualifications = {};
            for (const [code, q] of Object.entries(quals)) {
              if (q.on.checked) data.qualifications[code] = { critical: !!q.critical?.checked, note: q.note.value };
            }
            data.doraContract = quals[state.doraCode]?.on.checked ? doraContract.value : '';
            data.owner = d.owner || '';
            if (p) await api(`/api/prestations/${p.id}`, { method: 'PUT', body: { data } });
            else await api('/api/prestations', { method: 'POST', body: { tiersId, data } });
            close();
            toast('Prestation enregistrée');
            await reloadAndRender();
          }),
        },
        p ? 'Enregistrer' : 'Ajouter la prestation',
      ),
    ],
  });
}

// ---------------------------------------------------------------------------------------
// Administration : régulations et organisation
// ---------------------------------------------------------------------------------------
async function runAndReload(fn, okMsg) {
  try {
    await fn();
    if (okMsg) toast(okMsg);
    await reloadAndRender();
  } catch (e) {
    if (!e.handled) toast(e.message);
  }
}

function regulationsView() {
  const list = state.regulations;
  const run = runAndReload;
  const row = (r, i) =>
    h(
      'div',
      { class: `reg-row${r.active ? '' : ' off'}` },
      h('div', { class: 'reg-order' }, h('button', { class: 'btn link', title: 'Monter', disabled: i === 0, onclick: () => run(() => api(`/api/regulations/${r.code}/move`, { method: 'POST', body: { dir: -1 } })) }, '▲'), h('button', { class: 'btn link', title: 'Descendre', disabled: i === list.length - 1, onclick: () => run(() => api(`/api/regulations/${r.code}/move`, { method: 'POST', body: { dir: 1 } })) }, '▼')),
      h('span', { class: `qchip q-${r.color}` }, r.label),
      h(
        'div',
        { class: 'reg-body' },
        h('b', {}, r.name),
        h('div', { class: 'muted small' }, r.desc || '—'),
        h('div', { class: 'small' }, r.criticalLabel ? `★ Critique : ${r.criticalLabel}` : h('span', { class: 'muted' }, 'Pas de notion de criticité'), r.code === state.doraCode ? h('span', { class: 'muted' }, ' · reliée au registre d’information DORA') : null),
      ),
      h('div', { class: 'reg-usage muted small' }, plural(r.usage, 'prestation', 'prestations')),
      h(
        'div',
        { class: 'reg-actions' },
        h(
          'label',
          { class: 'switch small', title: r.code === state.doraCode ? 'La régulation DORA reste toujours active' : '' },
          h('input', {
            type: 'checkbox',
            checked: r.active,
            disabled: r.code === state.doraCode,
            onchange: (e) => run(() => api(`/api/regulations/${r.code}`, { method: 'PUT', body: { data: r, active: e.target.checked } }), e.target.checked ? 'Régulation activée' : 'Régulation désactivée'),
          }),
          ' Active',
        ),
        h('button', { class: 'btn small-btn', onclick: () => regulationModal(r) }, 'Modifier'),
        r.code !== state.doraCode
          ? h(
              'button',
              {
                class: 'btn link small',
                title: r.usage ? 'Utilisée par des prestations : désactivez-la plutôt' : '',
                disabled: r.usage > 0,
                onclick: () => confirm(`Supprimer la régulation « ${r.label} » ?`) && run(() => api(`/api/regulations/${r.code}`, { method: 'DELETE' }), 'Régulation supprimée'),
              },
              'Supprimer',
            )
          : null,
      ),
    );
  const missing = REGULATION_CATALOG.filter((c) => !list.some((r) => r.code === c.code));
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Régulations'), h('div', { class: 'muted' }, 'Adaptez le registre des tiers à votre entreprise : les régulations listées ici sont les qualifications proposées pour chaque prestation.')),
      h('button', { class: 'btn primary', onclick: () => regulationModal(null) }, '+ Nouvelle régulation'),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, `Régulations (${list.length})`),
      h('p', { class: 'muted small' }, 'L’ordre est celui des tuiles de l’accueil et des filtres. Une régulation désactivée disparaît des écrans et des formulaires ; les qualifications déjà saisies sont conservées.'),
      h('div', { class: 'reg-list' }, list.map(row)),
    ),
    missing.length
      ? h(
          'div',
          { class: 'card' },
          h('h2', {}, 'Régulations suggérées pour d’autres secteurs'),
          h(
            'div',
            { class: 'reg-list' },
            missing.map((c) =>
              h(
                'div',
                { class: 'reg-row' },
                h('span', { class: `qchip q-${c.color}` }, c.label),
                h('div', { class: 'reg-body' }, h('b', {}, c.name), h('div', { class: 'muted small' }, c.desc)),
                h('div', { class: 'reg-actions' }, h('button', { class: 'btn small-btn', onclick: () => regulationModal(null, c) }, 'Ajouter…')),
              ),
            ),
          ),
        )
      : null,
  );
}

function regulationModal(r, preset) {
  const d = r || preset || {};
  const inputs = {
    code: h('input', { value: d.code || '', disabled: !!r, placeholder: 'Ex. PECI' }),
    label: h('input', { value: d.label || '', placeholder: 'Affiché sur les pastilles' }),
    name: h('input', { value: d.name || '' }),
    desc: h('textarea', { rows: 3 }, d.desc || ''),
    criticalLabel: h('input', { value: d.criticalLabel || '', placeholder: 'Laisser vide si la régulation n’a pas de notion de criticité' }),
    color: selectOf(REGULATION_COLORS, d.color || 'blue', 'Couleur'),
  };
  inputs.color.querySelector('option[value=""]')?.remove();
  const preview = h('span', { class: 'qchip' });
  const syncPreview = () => {
    preview.className = `qchip q-${inputs.color.value}`;
    preview.textContent = inputs.label.value || 'Aperçu';
  };
  inputs.color.addEventListener('change', syncPreview);
  inputs.label.addEventListener('input', syncPreview);
  syncPreview();
  const fields = {
    code: formField('Code', inputs.code, { required: true, hint: 'Identifiant technique, non modifiable ensuite' }),
    label: formField('Libellé court', inputs.label, { required: true }),
    name: formField('Nom', inputs.name, { required: true, wide: true }),
    desc: formField('Description', inputs.desc, { wide: true, hint: 'Aide affichée lors de la qualification d’une prestation' }),
    criticalLabel: formField('Case « critique »', inputs.criticalLabel, { wide: true }),
    color: formField('Couleur', h('div', { class: 'toolbar' }, inputs.color, preview)),
  };
  const alert = h('div', { class: 'alert error', hidden: true });
  const close = openModal({
    title: r ? `Modifier ${r.label}` : 'Nouvelle régulation',
    body: [alert, h('div', { class: 'form-grid' }, Object.values(fields))],
    footer: [
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: saveHandler(alert, fields, async () => {
            const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
            if (r) await api(`/api/regulations/${r.code}`, { method: 'PUT', body: { data } });
            else await api('/api/regulations', { method: 'POST', body: { data } });
            close();
            toast('Régulation enregistrée');
            await reloadAndRender();
          }),
        },
        r ? 'Enregistrer' : 'Ajouter',
      ),
    ],
  });
}

// ---------------------------------------------------------------------------------------
// Administration : organisation de la structure
// ---------------------------------------------------------------------------------------
function organisationView() {
  const { directions, managers } = state.org;
  const s = state.settings;
  const orgName = h('input', { value: s.orgName || '', placeholder: 'Ex. Banque Exemple' });
  const orgSector = h('input', { value: s.orgSector || '', placeholder: 'Ex. Banque, assurance, société de gestion…' });
  const del = (label, path, usage) =>
    h(
      'button',
      {
        class: 'btn link small',
        disabled: usage > 0,
        title: usage ? 'Encore utilisé : modifiez d’abord les éléments rattachés' : '',
        onclick: () => confirm(`Supprimer « ${label} » ?`) && runAndReload(() => api(path, { method: 'DELETE' }), 'Supprimé'),
      },
      'Supprimer',
    );
  const move = (d, i, dir) =>
    h(
      'button',
      { class: 'btn link', title: dir < 0 ? 'Monter' : 'Descendre', disabled: dir < 0 ? i === 0 : i === directions.length - 1, onclick: () => runAndReload(() => api(`/api/organisation/directions/${d.id}/move`, { method: 'POST', body: { dir } })) },
      dir < 0 ? '▲' : '▼',
    );
  const table = (head, rows, empty) =>
    rows.length
      ? h('div', { class: 'table-wrap' }, h('table', { class: 'data org-table' }, h('thead', {}, h('tr', {}, head.map((x) => h('th', {}, x)))), h('tbody', {}, rows)))
      : h('p', { class: 'muted small' }, empty);
  return h(
    'div',
    {},
    h(
      'div',
      { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Organisation de la structure'), h('div', { class: 'muted' }, 'Directions représentées au COMEX et personnes responsables des tiers : elles sont proposées dans la description de chaque prestation.')),
    ),
    h(
      'div',
      { class: 'card' },
      h('h2', {}, 'Entreprise'),
      h('div', { class: 'form-grid' }, h('div', { class: 'field' }, h('label', {}, 'Nom de l’organisation'), orgName), h('div', { class: 'field' }, h('label', {}, 'Secteur'), orgSector)),
      h('p', { class: 'muted small' }, 'Le nom de l’organisation s’affiche sous le titre, dans le menu.'),
      h('button', { class: 'btn', onclick: () => runAndReload(() => api('/api/settings', { method: 'PUT', body: { data: { orgName: orgName.value, orgSector: orgSector.value } } }), 'Paramètres enregistrés') }, 'Enregistrer'),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'page-head' }, h('h2', {}, `Directions COMEX (${directions.length})`), h('button', { class: 'btn primary', onclick: () => directionModal(null) }, '+ Nouvelle direction')),
      table(
        ['', 'Direction', 'Responsable COMEX', 'Responsables de tiers', 'Prestations', ''],
        directions.map((d, i) =>
          h(
            'tr',
            {},
            h('td', { class: 'nowrap' }, move(d, i, -1), move(d, i, 1)),
            h('td', {}, h('b', {}, d.title)),
            h('td', {}, d.head),
            h('td', {}, d.managers || '—'),
            h('td', {}, d.usage ? h('a', { href: '#/prestations', onclick: () => (prestaFilter.q = d.title) }, d.usage) : '—'),
            h('td', { class: 'nowrap' }, h('button', { class: 'btn small-btn', onclick: () => directionModal(d) }, 'Modifier'), ' ', del(d.title, `/api/organisation/directions/${d.id}`, d.usage + d.managers)),
          ),
        ),
        'Aucune direction : ajoutez les directions représentées au COMEX (ex. Direction des Opérations, Sophie Bernard).',
      ),
    ),
    h(
      'div',
      { class: 'card' },
      h('div', { class: 'page-head' }, h('h2', {}, `Responsables de tiers (${managers.length})`), h('button', { class: 'btn primary', onclick: () => managerModal(null) }, '+ Nouveau responsable')),
      table(
        ['Nom', 'Direction', 'E-mail', 'Téléphone', 'Prestations', ''],
        managers.map((m) =>
          h(
            'tr',
            {},
            h('td', {}, h('b', {}, personName(m))),
            h('td', {}, directionBy(m.directionId)?.title || '—'),
            h('td', {}, m.email ? h('a', { href: `mailto:${m.email}` }, m.email) : '—'),
            h('td', { class: 'nowrap' }, m.phone || '—'),
            h('td', {}, m.usage || '—'),
            h('td', { class: 'nowrap' }, h('button', { class: 'btn small-btn', onclick: () => managerModal(m) }, 'Modifier'), ' ', del(personName(m), `/api/organisation/managers/${m.id}`, m.usage)),
          ),
        ),
        'Aucun responsable de tiers : ajoutez les personnes qui suivent les tiers au quotidien.',
      ),
    ),
  );
}

function orgModal({ title, inputs, fields, path, method, okMsg }) {
  const alert = h('div', { class: 'alert error', hidden: true });
  const close = openModal({
    title,
    narrow: true,
    body: [alert, h('div', { class: 'form-grid' }, Object.values(fields))],
    footer: [
      h('button', { class: 'btn', onclick: () => close() }, 'Annuler'),
      h(
        'button',
        {
          class: 'btn primary',
          onclick: saveHandler(alert, fields, async () => {
            const data = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
            await api(path, { method, body: { data } });
            close();
            toast(okMsg);
            await reloadAndRender();
          }),
        },
        'Enregistrer',
      ),
    ],
  });
}

function directionModal(d) {
  const inputs = {
    title: h('input', { value: d?.title || '', placeholder: 'Ex. Direction des Opérations' }),
    head: h('input', { value: d?.head || '', placeholder: 'Prénom et nom du membre du COMEX' }),
  };
  orgModal({
    title: d ? 'Modifier la direction' : 'Nouvelle direction COMEX',
    inputs,
    fields: { title: formField('Titre de la direction', inputs.title, { required: true, wide: true }), head: formField('Responsable COMEX', inputs.head, { required: true, wide: true }) },
    path: d ? `/api/organisation/directions/${d.id}` : '/api/organisation/directions',
    method: d ? 'PUT' : 'POST',
    okMsg: 'Direction enregistrée',
  });
}

function managerModal(m) {
  const inputs = {
    firstName: h('input', { value: m?.firstName || '' }),
    lastName: h('input', { value: m?.lastName || '' }),
    directionId: selectOf(state.org.directions.map((x) => [String(x.id), x.title]), m?.directionId ? String(m.directionId) : ''),
    email: h('input', { type: 'email', value: m?.email || '' }),
    phone: h('input', { type: 'tel', value: m?.phone || '' }),
  };
  orgModal({
    title: m ? 'Modifier le responsable' : 'Nouveau responsable de tiers',
    inputs,
    fields: {
      firstName: formField('Prénom', inputs.firstName),
      lastName: formField('Nom', inputs.lastName, { required: true }),
      directionId: formField('Direction', inputs.directionId, { wide: true }),
      email: formField('E-mail', inputs.email),
      phone: formField('Téléphone', inputs.phone),
    },
    path: m ? `/api/organisation/managers/${m.id}` : '/api/organisation/managers',
    method: m ? 'PUT' : 'POST',
    okMsg: 'Responsable enregistré',
  });
}

// ---------------------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------------------
(async () => {
  try {
    await loadAll();
    route();
  } catch (e) {
    if (!e.handled) renderLogin();
  }
})();
