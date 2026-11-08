# -*- coding: utf-8 -*-
"""Gera data/anexo-viii.json a partir da planilha do Anexo VIII
(Correlação Item NBS / IndOp / cClassTrib — IBS/CBS).

Uso:
    python scripts/atualizar_anexo8.py "caminho/AnexoVIII....xlsx"

A planilha usa células mescladas verticalmente: cada NBS se estende
pelas linhas-variante de IndOp. Este script "desmescla" a grade e gera
um registro por linha, isto é, uma correlação NBS x IndOp x cClassTrib
por registro.

v1.02.00 (planilha oficial 26/10/2026):
- Aba de regra renomeada de "REGRA inc. X" para "REGRA OP NÃO ONE_EXT".
  PS Onerosa / Adq. Exterior não são mais colunas por linha na "tabela
  geral": agora vêm de uma matriz IndOp → (PS, Adq. Exterior).
- Novas colunas na "tabela geral": COD_ATIV_SN e DESCRIÇÃO ATIV_SN
  (Simples Nacional), deslocando INDOP para a coluna 7.

Normalizações:
- IndOp armazenado como número perde zeros à esquerda -> zfill(6)
- PS Onerosa / Adq. Exterior: "s"/"n" -> "S"/"N" (derivadas da matriz)
- Local de incidência: capitalização unificada
"""
import json, re, sys
import openpyxl

DEFAULT_XLSX = "AnexoVIII-CorrelacaoItemNBSIndOpCClassTrib_IBSCBS_V1.02.00.xlsx"
OUT = "data/anexo-viii.json"
VERSAO = "V1.02.00"

LOCAIS = {
    "local da entrega ou disponibilização": "Local da entrega ou da disponibilização",
    "local da entrega ou da disponibilização": "Local da entrega ou da disponibilização",
    "local da prestação": "Local da prestação",
    "local do evento": "Local do evento",
    "local evento": "Local do evento",
    "local do imóvel": "Local do imóvel",
    "via explorada": "Via explorada",
    "domicílio principal do adquirente": "Domicílio principal do adquirente",
    "domicílio principal do adquirente (estabelecimento matriz)": "Domicílio principal do adquirente (estabelecimento matriz)",
}


def clean(v):
    return "" if v is None else str(v).strip()


def norm_indop(v):
    if v is None:
        return ""
    if isinstance(v, (int, float)):
        return str(int(v)).zfill(6)
    return clean(v).zfill(6) if clean(v).isdigit() else clean(v)


def norm_local(v):
    key = clean(v).lower()
    return LOCAIS.get(key, clean(v))


def unmerge(ws):
    """Expande células mescladas: devolve {(linha, coluna): valor}."""
    grid = {}
    for row in ws.iter_rows():
        for cell in row:
            grid[(cell.row, cell.column)] = cell.value
    for m in ws.merged_cells.ranges:
        v = grid.get((m.min_row, m.min_col))
        for r in range(m.min_row, m.max_row + 1):
            for c in range(m.min_col, m.max_col + 1):
                grid[(r, c)] = v
    return grid


def build_regra_map(rg):
    """Constrói mapeamento indOp -> (psOnerosa, adqExterior) da aba de regra.

    Estrutura v1.02.00 (após unmerge):
      linhas 5-7, colunas A-C = bloco PS Onerosa=SIM:
        Col A='SIM' (rótulo), Col B=IndOp(ADQ=N), Col C=IndOp(ADQ=S)
      colunas D-F = bloco PS Onerosa=NÃO:
        Col D='NÃO' (rótulo), Col E=IndOp(ADQ=N), Col F=IndOp(ADQ=S)
    """
    grid = unmerge(rg)
    indop_to_psadq = {}  # indOp -> (psOnerosa, adqExterior)
    for r in range(5, rg.max_row + 1):
        ps_left = clean(grid.get((r, 1)))   # col A: SIM/NÃO
        ps_right = clean(grid.get((r, 4)))  # col D: SIM/NÃO
        # Bloco esquerdo (cols B, C)
        for col, adq in ((2, "N"), (3, "S")):
            v = grid.get((r, col))
            indop = norm_indop(v)
            if indop:
                indop_to_psadq.setdefault(indop, (ps_left, adq))
        # Bloco direito (cols E, F)
        for col, adq in ((5, "N"), (6, "S")):
            v = grid.get((r, col))
            indop = norm_indop(v)
            if indop:
                indop_to_psadq.setdefault(indop, (ps_right, adq))
    return indop_to_psadq


def main(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)

    # Aba de regra: v1.02.00 usa "REGRA OP NÃO ONE_EXT" (antes "REGRA inc. X")
    regra_name = None
    for sn in wb.sheetnames:
        if sn.upper().startswith("REGRA"):
            regra_name = sn
            break
    if not regra_name or "tabela geral" not in wb.sheetnames:
        raise SystemExit(
            f"abas esperadas não encontradas em {xlsx_path}: "
            f"{wb.sheetnames} (esperado aba 'REGRA*' e 'tabela geral')"
        )

    # ---------- matriz de regra (IndOp -> PS/ADQ) ----------
    rg = wb[regra_name]
    indop_to_psadq = build_regra_map(rg)

    # ---------- aba tabela geral ----------
    ws = wb["tabela geral"]
    cab = [clean(ws.cell(row=1, column=c).value).lower() for c in range(1, 12)]
    if not (cab[0].startswith("item") and "nbs" in cab[2] and "indop" in cab[6]):
        raise SystemExit(
            f"layout inesperado da aba 'tabela geral' em {xlsx_path}: {cab}. "
            "Confira se é a planilha oficial do Anexo VIII antes de regerar."
        )
    grid = unmerge(ws)

    itens = []
    for r in range(2, ws.max_row + 1):
        vals = [clean(grid.get((r, c))) for c in range(1, 11)]
        item, desc_item, nbs, desc_nbs, cod_ativ_sn, desc_ativ_sn, indop, local, cct, nome_cct = vals
        indop = norm_indop(indop)
        if not (indop or nbs or cct):
            continue  # linha espaçadora
        ps_onerosa, adq_exterior = indop_to_psadq.get(indop, ("", ""))
        nbs_digits = re.sub(r"\D", "", nbs)
        itens.append({
            "itemLc116": item,
            "descItem": desc_item,
            "nbs": nbs,
            "nbsDigits": nbs_digits,
            "descNbs": desc_nbs,
            "codAtivSn": cod_ativ_sn,
            "descAtivSn": desc_ativ_sn,
            "psOnerosa": ps_onerosa.upper(),
            "adqExterior": adq_exterior.upper(),
            "indop": indop,
            "localIncidencia": norm_local(local),
            "cClassTrib": cct,
            "nomeClassTrib": nome_cct,
        })

    # remove duplicatas exatas (células mescladas podem gerar repetições)
    vistas = set()
    unicos = []
    for it in itens:
        chave = json.dumps(it, ensure_ascii=False)
        if chave not in vistas:
            vistas.add(chave)
            unicos.append(it)
    itens = unicos

    # ---------- validação ----------
    problemas = []
    for i, it in enumerate(itens):
        if it["nbs"] and len(it["nbsDigits"]) != 9:
            problemas.append(f"registro {i}: NBS '{it['nbs']}' não tem 9 dígitos")
        if it["indop"] and len(it["indop"]) != 6:
            problemas.append(f"registro {i}: IndOp '{it['indop']}' não tem 6 dígitos")
    if problemas:
        print("PROBLEMAS:")
        for p in problemas[:20]:
            print("  " + p)
        raise SystemExit(1)

    nbs_unicos = sorted({it["nbsDigits"] for it in itens if it["nbsDigits"]})
    cct_unicos = sorted({it["cClassTrib"] for it in itens if it["cClassTrib"]})
    indops = sorted({it["indop"] for it in itens if it["indop"]})
    locais = sorted({it["localIncidencia"] for it in itens if it["localIncidencia"]})

    # Constrói regraIndOp a partir do mapeamento (agrupado por ps/adq)
    regra_agrupada = {}
    for indop, (ps, adq) in indop_to_psadq.items():
        regra_agrupada.setdefault((ps, adq), []).append(indop)
    regra = []
    for (ps, adq), indops_list in sorted(regra_agrupada.items()):
        regra.append({
            "psOnerosa": ps,
            "adqExterior": adq,
            "indop": sorted(indops_list),
        })

    data = {
        "meta": {
            "fonte": "Anexo VIII — Correlação Item NBS / IndOp / cClassTrib — IBS/CBS",
            "versao": VERSAO,
            "observacao": (
                "Extraído da planilha com desmesclagem de células: cada registro é uma "
                "correlação NBS x IndOp x cClassTrib. IndOp numérico foi normalizado "
                "com zeros à esquerda (6 dígitos). PS Onerosa/Adq. Exterior derivadas "
                "da matriz de regra da planilha v1.02.00. Inclui colunas Simples Nacional "
                "COD_ATIV_SN / DESCRIÇÃO ATIV_SN."
            ),
            "geradoEm": "2026-11-08",
            "correlacoes": len(itens),
            "nbsUnicos": len(nbs_unicos),
            "cClassTribUnicos": len(cct_unicos),
            "indops": indops,
            "locaisIncidencia": locais,
        },
        "regraIndOp": regra,
        "itens": itens,
    }

    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=1)

    print(f"OK -> {OUT}")
    print(f"  correlações: {len(itens)}")
    print(f"  NBS unicos: {len(nbs_unicos)} | cClassTrib unicos: {len(cct_unicos)} | IndOps: {len(indops)}")
    print(f"  matriz regra: {json.dumps(regra, ensure_ascii=False)}")
    print(f"  locais: {locais}")


if __name__ == "__main__":
    caminho = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_XLSX
    main(caminho)
