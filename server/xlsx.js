// Export / import au format du template EBA (onglets b_xx.xx, codes colonnes en ligne 4,
// libellés en ligne 5, types en ligne 6, données à partir de la ligne 7, colonne A vide).
// L'import accepte aussi le format de remise EBA (onglets b_xx_xx, codes c0010 en ligne 1).
import ExcelJS from 'exceljs';
import { schema } from './schema.js';
import { isEmpty } from '../public/shared/validate.js';

const FIRST_DATA_ROW = 7;
const VALIDATION_ROWS = 1000;

function colLetter(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function toCell(col, v) {
  if (col.kind === 'link') return 'true';
  if (isEmpty(v)) return null;
  const s = String(v).trim();
  if (col.kind === 'date') {
    const d = new Date(`${s}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? s : d;
  }
  if (col.kind === 'money' || col.kind === 'int') {
    const n = Number(s);
    return Number.isFinite(n) ? n : s;
  }
  return s;
}

export async function exportWorkbook(recordsByTable) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Registre DORA';
  wb.created = new Date();

  // Onglet des listes de valeurs, comme dans le template, pour les listes déroulantes.
  const dd = wb.addWorksheet('Drop down');
  const listRanges = {};
  Object.entries(schema.lists).forEach(([name, items], i) => {
    const codeCol = i * 3 + 1;
    dd.getCell(1, codeCol).value = name;
    dd.getCell(1, codeCol + 1).value = name.replace('LIST', 'DESC');
    items.forEach((it, j) => {
      dd.getCell(j + 2, codeCol).value = it.code;
      dd.getCell(j + 2, codeCol + 1).value = it.label;
    });
    const L = colLetter(codeCol);
    listRanges[name] = `'Drop down'!$${L}$2:$${L}$${items.length + 1}`;
  });

  for (const table of schema.tables) {
    const ws = wb.addWorksheet(table.code);
    ws.getCell('B2').value = table.template;
    ws.getCell('B2').font = { bold: true };
    table.columns.forEach((col, j) => {
      const c = j + 2;
      ws.getCell(4, c).value = col.code;
      ws.getCell(5, c).value = col.name;
      ws.getCell(6, c).value = col.type;
      for (const r of [4, 5, 6]) {
        const cell = ws.getCell(r, c);
        cell.font = { bold: r !== 6, size: 9 };
        cell.alignment = { wrapText: true, vertical: 'top' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: r === 4 ? 'FFD9E1F2' : 'FFF2F2F2' } };
      }
      ws.getColumn(c).width = col.kind === 'list' ? 34 : 24;
      if (col.kind === 'date') ws.getColumn(c).numFmt = 'yyyy-mm-dd';
      if (col.list && listRanges[col.list]) {
        const L = colLetter(c);
        ws.dataValidations.add(`${L}${FIRST_DATA_ROW}:${L}${FIRST_DATA_ROW + VALIDATION_ROWS}`, {
          type: 'list',
          allowBlank: true,
          formulae: [listRanges[col.list]],
        });
      }
    });
    ws.getColumn(1).width = 3;
    ws.views = [{ state: 'frozen', ySplit: 6, xSplit: 1 }];
    (recordsByTable[table.code] || []).forEach((rec, i) => {
      table.columns.forEach((col, j) => {
        const v = toCell(col, rec.data[col.code]);
        if (v !== null) ws.getCell(FIRST_DATA_ROW + i, j + 2).value = v;
      });
    });
  }
  return wb.xlsx.writeBuffer();
}

function cellToString(col, v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null) {
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if ('result' in v) return cellToString(col, v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return String(v.text);
  }
  if (col.kind === 'date' && typeof v === 'number') {
    // Numéro de série Excel → date ISO.
    return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
  }
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  return String(v).trim();
}

// Format de remise EBA (DPM 4.0) : onglets « b_05_01 », codes colonnes courts « c0010 » en ligne 1,
// données dès la ligne 2. Le tableau b_05.01 y compte 12 colonnes au lieu de 9 dans le template.
const B0501_REPORTING = {
  c0010: 'b_05.01.0010', // code du prestataire
  c0020: 'b_05.01.0020', // type de code
  c0050: 'b_05.01.0030', // dénomination sociale
  c0070: 'b_05.01.0040', // type de personne
  c0080: 'b_05.01.0050', // pays du siège
  c0090: 'b_05.01.0060', // devise
  c0100: 'b_05.01.0070', // dépense annuelle
  c0110: 'b_05.01.0080', // code de la tête de groupe
  c0120: 'b_05.01.0090', // type de code de la tête de groupe
};
const B0501_DROPPED = {
  c0030: 'code d’identification complémentaire',
  c0040: 'type du code complémentaire',
  c0060: 'dénomination en alphabet latin',
};

// Types de code « eba_qCO » du format de remise → format du registre.
// qx2000 = LEI (règle EBA v8821) ; les autres correspondances sont déduites des valeurs observées.
const QCO_TYPES = { qx2000: 'LEI', qx2001: 'EUID', qx2002: 'EUID', qx2003: 'CRN', qx2004: 'VAT', qx2005: 'PNR', qx2006: 'NIN' };

function findSheet(wb, code) {
  const alt = code.replace('.', '_').toLowerCase();
  return wb.worksheets.find((ws) => {
    const n = ws.name.trim().toLowerCase();
    return n === code || n === alt;
  });
}

/** Repère la ligne des codes colonnes ; renvoie { headerRow, colIndex: { codeColonne: n° } }. */
function findHeader(ws, table, warnings) {
  for (let r = 1; r <= 10; r++) {
    const cells = [];
    ws.getRow(r).eachCell((cell, c) => cells.push([String(cell.value ?? '').trim(), c]));
    const colIndex = {};
    // Format du template : codes complets « b_05.01.0010 ».
    for (const [v, c] of cells) if (table.columns.some((col) => col.code === v)) colIndex[v] = c;
    if (Object.keys(colIndex).length) return { headerRow: r, colIndex };
    // Format de remise : codes courts « c0010 ».
    const short = Object.fromEntries(cells.filter(([v]) => /^c\d{4}$/i.test(v)).map(([v, c]) => [v.toLowerCase(), c]));
    if (!Object.keys(short).length) continue;
    const dpm4 = table.code === 'b_05.01' && ('c0110' in short || 'c0120' in short);
    for (const [v, c] of Object.entries(short)) {
      const code = dpm4 ? B0501_REPORTING[v] : `${table.code}.${v.slice(1)}`;
      if (code && table.columns.some((col) => col.code === code)) colIndex[code] = c;
      else if (dpm4 && B0501_DROPPED[v]) warnings.push(`${table.code} : colonne ${v} (${B0501_DROPPED[v]}) non reprise, absente du registre`);
      else warnings.push(`${table.code} : colonne ${v} inconnue, ignorée`);
    }
    if (Object.keys(colIndex).length) return { headerRow: r, colIndex };
  }
  return { headerRow: null, colIndex: {} };
}

/** Convertit les types de code eba_qCO:qxNNNN en LEI, EUID ou PAYS_TYPE (ex. FR_CRN). */
function convertCodeTypes(out, warnings) {
  const country = (v) => (/^eba_GA:([A-Z]{2})$/.exec(v || '') || [])[1];
  const providerCountry = {};
  for (const d of out['b_05.01'] || []) {
    const cc = country(d['b_05.01.0050']);
    if (cc && d['b_05.01.0010']) providerCountry[d['b_05.01.0010']] = cc;
  }
  const unknown = new Set();
  for (const table of schema.tables) {
    for (const d of out[table.code] || []) {
      for (const col of table.columns) {
        if (col.kind !== 'codeType') continue;
        const m = /^eba_qCO:(qx\d+)$/.exec(d[col.code] || '');
        if (!m) continue;
        const type = QCO_TYPES[m[1]];
        if (!type) {
          unknown.add(d[col.code]);
          continue;
        }
        if (type === 'LEI' || type === 'EUID') {
          d[col.code] = type;
          continue;
        }
        const code = String(d[col.codeTypeOf] || '');
        const cc = providerCountry[code] || (table.code === 'b_05.01' && country(d['b_05.01.0050'])) || (/^([A-Z]{2})/.exec(code) || [])[1];
        if (cc) d[col.code] = `${cc}_${type}`;
        else unknown.add(d[col.code]);
      }
    }
  }
  if (unknown.size) warnings.push(`Types de code non convertis (pays introuvable ou type inconnu) : ${[...unknown].join(', ')}`);
}

/**
 * Lit un classeur au format du template EBA ou au format de remise EBA (DPM 4.0) ;
 * renvoie { tables: { code: [data] }, warnings }.
 */
export async function importWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = {};
  const warnings = [];
  const used = new Set();
  for (const table of schema.tables) {
    const ws = findSheet(wb, table.code);
    if (!ws) continue;
    used.add(ws);
    const { headerRow, colIndex } = findHeader(ws, table, warnings);
    if (!headerRow) {
      warnings.push(`${table.code} : ligne des codes colonnes introuvable, onglet ignoré`);
      continue;
    }
    const firstCol = Object.values(colIndex).sort((a, b) => a - b)[0];
    // Les lignes de données commencent après les lignes libellés et types.
    let start = headerRow + 1;
    while (start <= headerRow + 3) {
      const first = String(ws.getRow(start).getCell(firstCol).value ?? '');
      const isHeader = table.columns.some((c) => c.name === first.trim() || c.type === first.trim());
      if (!isHeader) break;
      start++;
    }
    const rows = [];
    for (let r = start; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const data = {};
      let any = false;
      for (const col of table.columns) {
        const c = colIndex[col.code];
        if (!c) continue;
        let v = cellToString(col, row.getCell(c).value);
        if (col.list && v) {
          // Accepte le libellé à la place du code de la liste.
          const items = schema.lists[col.list] || [];
          if (!items.some((it) => it.code === v)) {
            const hit = items.find((it) => it.label.toLowerCase() === v.toLowerCase());
            if (hit) v = hit.code;
          }
        }
        if (col.kind === 'link') v = v ? 'true' : '';
        if (v && col.kind !== 'link') any = true;
        data[col.code] = v;
      }
      if (any) {
        for (const col of table.columns) if (col.kind === 'link') data[col.code] = 'true';
        rows.push(data);
      }
    }
    out[table.code] = rows;
  }
  const ignored = wb.worksheets.filter((ws) => !used.has(ws) && ws.name !== 'Drop down' && ws.rowCount > 0);
  if (ignored.length) warnings.push(`Onglets non reconnus, ignorés : ${ignored.map((ws) => ws.name).join(', ')}`);
  if (!used.size) warnings.push('Aucun onglet du registre trouvé (noms attendus : b_01.01 ou b_01_01, etc.)');
  convertCodeTypes(out, warnings);
  return { tables: out, warnings };
}
