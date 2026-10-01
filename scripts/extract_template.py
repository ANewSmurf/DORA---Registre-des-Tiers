#!/usr/bin/env python3
"""Extrait la structure du template EBA « Register of Information » (DORA).

Usage : python3 scripts/extract_template.py template/dora-roi-template.xlsb > server/schema.json
Dépendance : pip install pyxlsb
"""
import json
import re
import sys

from pyxlsb import open_workbook


def clean(v):
    if v is None:
        return None
    if isinstance(v, str):
        v = re.sub(r"\s+", " ", v).strip()
        return v or None
    return v


def main(path):
    with open_workbook(path) as wb:
        sheets = {}
        for name in wb.sheets:
            with wb.get_sheet(name) as sh:
                sheets[name] = [[c.v for c in r] for r in sh.rows()]

    # Listes de valeurs (onglet « Drop down ») : colonnes LISTxxx / DESCxxx côte à côte.
    dd = sheets["Drop down"]
    header = dd[0]
    lists = {}
    for i, h in enumerate(header):
        if isinstance(h, str) and h.startswith("LIST"):
            items = []
            for row in dd[1:]:
                code = clean(row[i]) if i < len(row) else None
                label = clean(row[i + 1]) if i + 1 < len(row) else None
                if code:
                    items.append({"code": code, "label": label or code})
            lists[h] = items

    # Consignes de remplissage (onglet « Instructions »).
    instr = {}
    for row in sheets["Instructions"]:
        row = (row + [None] * 7)[:7]
        code = clean(row[1])
        if isinstance(code, str) and re.match(r"^b_\d\d\.\d\d\.\d{4}$", code):
            instr[code] = {
                "instruction": clean(row[4]),
                "option": clean(row[5]),
                "list": clean(row[6]),
            }

    tables = []
    for name, rows in sheets.items():
        if not re.match(r"^b_\d\d\.\d\d$", name) or name == "b_99.01":
            continue
        title = clean(rows[1][1])
        codes, labels, types = rows[3], rows[4], rows[5]
        cols = []
        for j in range(1, len(codes)):
            code = clean(codes[j])
            if not code:
                continue
            info = instr.get(code, {})
            cols.append({
                "code": code,
                "name": clean(labels[j]),
                "type": clean(types[j]),
                "instruction": info.get("instruction"),
                "option": info.get("option"),
                "list": info.get("list"),
            })
        tables.append({"code": name, "title": title, "columns": cols})

    json.dump({"source": "EBA DORA Register of Information template (EBAv1)",
               "tables": tables, "lists": lists}, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "template/dora-roi-template.xlsb")
