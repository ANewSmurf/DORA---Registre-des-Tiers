// Export / import au format du template EBA (onglets b_xx.xx, codes colonnes en ligne 4,
// libellés en ligne 5, types en ligne 6, données à partir de la ligne 7, colonne A vide).
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

/** Lit un classeur au format du template ; renvoie { tables: { code: [data] }, warnings }. */
export async function importWorkbook(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const out = {};
  const warnings = [];
  for (const table of schema.tables) {
    const ws = wb.getWorksheet(table.code);
    if (!ws) continue;
    // Repère la ligne des codes colonnes (ligne 4 dans le template).
    let headerRow = null;
    const colIndex = {};
    for (let r = 1; r <= 10 && !headerRow; r++) {
      ws.getRow(r).eachCell((cell, c) => {
        const v = String(cell.value ?? '').trim();
        if (table.columns.some((col) => col.code === v)) {
          headerRow = r;
          colIndex[v] = c;
        }
      });
    }
    if (!headerRow) {
      warnings.push(`${table.code} : ligne des codes colonnes introuvable, onglet ignoré`);
      continue;
    }
    // Les lignes de données commencent après les lignes libellés et types.
    let start = headerRow + 1;
    while (start <= headerRow + 3) {
      const first = String(ws.getRow(start).getCell(colIndex[table.columns[0].code] || 2).value ?? '');
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
  return { tables: out, warnings };
}
