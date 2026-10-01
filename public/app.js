// Interface web du registre d'information DORA (application monopage, sans framework).
import { checkValue, isEmpty } from './shared/validate.js';

const state = { me: null, schema: null, tables: {}, issues: [], lists: {} };
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

function listLabel(listName, code) {
  return state.lists[listName]?.get(code) ?? code;
}

function fmt(col, v) {
  if (isEmpty(v)) return '';
  if (col.kind === 'list') {
    const label = listLabel(col.list, v);
    return col.list === 'LISTCOUNTRY' ? `${v.replace('eba_GA:', '')} – ${titleCase(label)}` : label;
  }
  if (col.kind === 'money') return Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  if (col.kind === 'date') return v === '9999-12-31' ? 'Sans date (9999-12-31)' : new Date(`${v}T00:00:00`).toLocaleDateString('fr-FR');
  return String(v);
}

const titleCase = (s) => String(s).toLowerCase().replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());

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
    state.lists = Object.fromEntries(Object.entries(schema.lists).map(([k, items]) => [k, new Map(items.map((i) => [i.code, i.label]))]));
  }
  await refresh();
}

async function refresh() {
  const [reg, checks, me] = await Promise.all([api('/api/register'), api('/api/checks'), api('/api/me')]);
  state.tables = reg.tables;
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
        h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), h('div', {}, "Registre d'information DORA", h('small', {}, 'Prestataires tiers de services TIC'))),
        form,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------------------
// Coque de l'application
// ---------------------------------------------------------------------------------------
function issuesFor(tbl) {
  return state.issues.filter((i) => i.table === tbl && i.level === 'erreur').length;
}

function shell(content) {
  const hash = location.hash || '#/';
  const link = (href, label, extra) =>
    h('a', { href, class: hash === href || (href !== '#/' && hash.startsWith(href + '/')) ? 'active' : '' }, h('span', {}, label), extra);
  const groups = {};
  for (const t of state.schema.tables) (groups[t.group] ||= []).push(t);
  const me = state.me;
  const sidebar = h(
    'nav',
    { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, h('img', { src: '/favicon.svg', alt: '' }), h('div', {}, 'Registre DORA', h('small', {}, 'Registre des tiers TIC'))),
    h(
      'div',
      { class: 'nav' },
      link('#/', 'Tableau de bord'),
      link('#/tiers', 'Prestataires TIC', h('span', { class: 'badge' }, (state.tables['b_05.01'] || []).length)),
      link('#/controles', 'Contrôles', h('span', { class: `badge ${state.issues.some((i) => i.level === 'erreur') ? 'erreur' : 'ok'}` }, state.issues.length)),
      link('#/echanges', 'Import / export'),
      me.permissions.manageUsers ? [h('div', { class: 'nav-section' }, 'Administration'), link('#/utilisateurs', 'Utilisateurs'), link('#/journal', "Journal d'audit")] : null,
      Object.entries(groups).map(([g, tables]) => [
        h('div', { class: 'nav-section' }, g),
        tables.map((t) => {
          const n = issuesFor(t.code);
          return link(`#/table/${t.code}`, t.title, h('span', { class: n ? 'badge erreur' : 'code' }, n ? `${n} ⚠` : t.code.replace('b_', '')));
        }),
      ]),
    ),
  );
  const topbar = h(
    'header',
    { class: 'topbar' },
    h('button', { class: 'btn menu-btn', onclick: () => sidebar.classList.toggle('open') }, '☰'),
    h('div', { class: 'muted small' }, me.permissions.global ? 'Périmètre : tout le registre' : `Périmètre : ${me.providers.length} prestataire(s) rattaché(s)`),
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
  $app.replaceChildren(h('div', { class: 'layout' }, sidebar, h('div', { class: 'main' }, topbar, h('main', { class: 'content' }, content))));
}

// ---------------------------------------------------------------------------------------
// Routage
// ---------------------------------------------------------------------------------------
function route() {
  if (!state.me) return renderLogin();
  $modal.replaceChildren();
  const parts = (location.hash || '#/').slice(2).split('/');
  const [page, arg] = parts;
  let view;
  if (!page) view = dashboard();
  else if (page === 'tiers' && arg) view = providerSheet(Number(arg));
  else if (page === 'tiers') view = providersList();
  else if (page === 'table' && T(arg)) view = tableView(arg);
  else if (page === 'controles') view = checksView();
  else if (page === 'echanges') view = exchangeView();
  else if (page === 'utilisateurs' && state.me.permissions.manageUsers) view = usersView();
  else if (page === 'journal' && state.me.permissions.manageUsers) view = auditView();
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
      kpi((t['b_05.01'] || []).length, 'Prestataires TIC', '#/tiers'),
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
            ? h('ul', {}, state.me.providers.map((p) => h('li', {}, h('a', { href: `#/tiers/${p.id}` }, p.name || p.code), ' ', h('span', { class: 'code muted' }, p.code))))
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
          { onclick: () => (location.hash = `#/tiers/${p.id}`) },
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
      h('div', {}, h('a', { href: '#/tiers', class: 'small' }, '← Prestataires TIC'), h('h1', {}, p.data['b_05.01.0030'] || '(sans nom)'), h('div', { class: 'code muted' }, `${type} · ${code}`)),
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
      input = h('select', { id, disabled }, h('option', { value: '' }, '— Non renseigné —'), state.schema.lists[col.list].map((it) => h('option', { value: it.code }, col.list === 'LISTCOUNTRY' ? `${it.code.replace('eba_GA:', '')} – ${titleCase(it.label)}` : it.label)));
      input.value = v;
    } else if (col.kind === 'date') {
      input = h('input', { id, type: 'date', value: v, disabled, min: '1900-01-01', max: '9999-12-31' });
    } else if (col.kind === 'money' || col.kind === 'int') {
      input = h('input', { id, type: 'number', step: col.kind === 'int' ? '1' : 'any', min: col.kind === 'int' ? '0' : null, value: v, disabled });
    } else {
      const listId = `${id}-dl`;
      let options = [];
      if (col.ref) options = refOptions(col);
      else if (col.kind === 'codeType') options = ['LEI', 'FR_CRN', 'FR_VAT', 'DE_VAT', 'LU_CRN', 'IE_CRN', 'US_CRN'].map((x) => [x, null]).concat(col.code === 'b_05.02.0070' ? [['Not applicable', 'rang 1']] : []);
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
      toast(`Import terminé : ${Object.values(r.summary).reduce((a, b) => a + b, 0)} ligne(s)`);
    } catch (e) {
      if (!e.handled) result.replaceChildren(h('div', { class: 'alert error' }, e.message));
    }
  };
  return h(
    'div',
    {},
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Import / export'), h('div', { class: 'muted' }, 'Échanges au format du template EBA du registre d’information.'))),
    h(
      'div',
      { class: 'grid two' },
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Exporter le registre'),
        h('p', {}, 'Génère un classeur Excel reprenant la structure du template : un onglet par tableau (b_01.01 à b_07.01), codes colonnes en ligne 4, libellés en ligne 5, types en ligne 6, données à partir de la ligne 7, listes de valeurs EBA dans l’onglet « Drop down ».'),
        h('p', { class: 'muted small' }, state.me.permissions.global ? 'L’export contient l’ensemble du registre.' : 'L’export est limité à vos prestataires rattachés et au référentiel.'),
        h('a', { class: 'btn primary', href: '/api/export.xlsx' }, 'Télécharger le registre (.xlsx)'),
      ),
      h(
        'div',
        { class: 'card' },
        h('h2', {}, 'Importer un registre'),
        canImp
          ? [
              h('p', {}, 'Importez un classeur .xlsx au format du template (par exemple le template EBA rempli puis enregistré au format .xlsx, ou un export de cette application). Les listes de valeurs acceptent le code EBA ou le libellé.'),
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
      out.replaceChildren(
        h(
          'div',
          { class: 'table-wrap' },
          h(
            'table',
            { class: 'data' },
            h('thead', {}, h('tr', {}, ['Identifiant', 'Nom', 'Profil', 'Prestataires rattachés', 'Statut'].map((x) => h('th', {}, x)))),
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
                  h('td', {}, u.role.startsWith('tiers') ? u.providerIds.map((id) => providers[id] || `#${id}`).join(', ') || h('span', { class: 'badge erreur' }, 'aucun') : h('span', { class: 'muted' }, 'tout le registre')),
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
    h('label', {}, 'Prestataires TIC rattachés'),
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
  const help = h('div', { class: 'alert info' });
  const syncRole = () => {
    provBox.hidden = !role.value.startsWith('tiers');
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
            const body = { displayName: displayName.value, role: role.value, active: active.checked, providerIds: [...selected] };
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
