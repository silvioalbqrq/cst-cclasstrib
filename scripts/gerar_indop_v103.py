# -*- coding: utf-8 -*-
"""Gera data/indop-v103.json a partir da planilha do Anexo VII - IndOp IBSCBS v1.03.00.

Uso:
    python scripts/gerar_indop_v103.py "caminho/AnexoVII-IndOp_IBSCBS_v1-03-00-nt009.xlsx"
"""
import json, re, sys
import openpyxl

OUT = "data/indop-v103.json"


def clean(v):
    return "" if v is None else str(v).strip()


def norm_indop(v):
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(int(v)).zfill(6)
    return clean(v).zfill(6) if clean(v).isdigit() else clean(v)


def main(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    if "cIndOp Public" not in wb.sheetnames:
        raise SystemExit("aba 'cIndOp Public' não encontrada em %s: %s" % (xlsx_path, wb.sheetnames))
    ws = wb["cIndOp Public"]

    indops = {}
    for r in range(2, ws.max_row + 1):
        cod = clean(ws.cell(row=r, column=1).value)
        if not cod:
            continue
        cod = norm_indop(cod)
        indops[cod] = {
            "tipoOperacao": clean(ws.cell(row=r, column=2).value),
            "caracteristica": clean(ws.cell(row=r, column=3).value),
            "localFornecimento": clean(ws.cell(row=r, column=4).value),
            "dispositivoLegal": clean(ws.cell(row=r, column=5).value),
            "observacao": clean(ws.cell(row=r, column=6).value),
            "indNFe": clean(ws.cell(row=r, column=7).value),
            "indNFSe": clean(ws.cell(row=r, column=8).value),
            "indNFSeVia": clean(ws.cell(row=r, column=9).value),
            "nfseLocIncidIBS": clean(ws.cell(row=r, column=10).value),
        }

    data = {
        "fonte": "Anexo VII — IndOp_IBSCBS v1.03.00 (NT009 v1.01)",
        "versao": "V1.03.00",
        "geradoEm": "2026-11-08",
        "total": len(indops),
        "indops": indops,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    print("OK -> %s" % OUT)
    print("  total IndOps: %d" % len(indops))


if __name__ == "__main__":
    caminho = sys.argv[1] if len(sys.argv) > 1 else "AnexoVII-IndOp_IBSCBS_v1-03-00.xlsx"
    main(caminho)
