# -*- coding: utf-8 -*-
"""Gera data/anexo-viii.json a partir da planilha do Anexo VIII
(Correlação Item NBS / IndOp / cClassTrib — IBS/CBS).

Uso:
    python scripts/atualizar_anexo8.py "caminho/AnexoVIII-...V1.01.00.xlsx"
    python scripts/atualizar_anexo8.py --check          # não grava, só compara
    python scripts/atualizar_anexo8.py --versao V1.02.00 planilha.xlsx

A versão é lida do nome do arquivo (`V1.01.00`) quando não vier em --versao.
A data exibida no site (meta.geradoEm) é preservada do arquivo atual, salvo se
--gerado-em for informado.

A planilha usa células mescladas verticalmente: cada NBS se estende
pelas linhas-variante de IndOp (030101-030104 = local da prestação;
100301 = Domicílio principal do adquirente, com PS Onerosa / Adq.
Exterior). Este script "desmescla" a grade e gera um registro por
linha, isto é, uma correlação NBS x IndOp x cClassTrib por registro.

Normalizações:
- IndOp armazenado como número perde zeros à esquerda -> zfill(6)
- PS Onerosa / Adq. Exterior: "s"/"n" -> "S"/"N"
- Local de incidência: capitalização unificada
"""
import argparse
import datetime
import json
import os
import re
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _comum import ErroFonte, fim_de_uso, gravar, mesmo_conteudo, rel  # noqa: E402

try:
    import openpyxl  # noqa: E402
except ImportError:
    fim_de_uso()
    print(
        "erro: falta a biblioteca openpyxl, necessária para ler a planilha.\n"
        "  Instale com:  python -m pip install openpyxl",
        file=sys.stderr,
    )
    raise SystemExit(1)

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_XLSX = "AnexoVIII-CorrelacaoItemNBSIndOpCClassTrib_IBSCBS_V1.01.00.xlsx"
OUT = os.path.join(REPO, "data", "anexo-viii.json")

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
# A planilha traz "Local da entrega ou disponibilização" (1 ocorrência) e
# "Local da entrega ou da disponibilização" (60); ambas são unificadas acima.


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


def versao_do_nome(caminho):
    m = re.search(r"[Vv](\d+\.\d+\.\d+)", os.path.basename(caminho))
    return f"V{m.group(1)}" if m else None


def gerado_em_do_arquivo(caminho):
    """Preserva a data já publicada, para regerar sem mexer no rodapé do site."""
    if not os.path.isfile(caminho):
        return None
    try:
        with open(caminho, encoding="utf-8") as fh:
            return (json.load(fh).get("meta") or {}).get("geradoEm")
    except (OSError, json.JSONDecodeError):
        return None


def gerar(xlsx_path, versao, gerado_em):
    """Lê a planilha e devolve o dict do data/anexo-viii.json."""
    try:
        wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    except zipfile.BadZipFile:
        raise ErroFonte(
            f"'{xlsx_path}' não é uma planilha .xlsx válida.\n"
            "  Baixe de novo a planilha oficial do Anexo VIII e passe o caminho."
        )

    if "REGRA inc. X" not in wb.sheetnames or "tabela geral" not in wb.sheetnames:
        raise ErroFonte(
            f"abas esperadas não encontradas em {xlsx_path}: "
            f"{wb.sheetnames} (esperado 'REGRA inc. X' e 'tabela geral').\n"
            "  Confira se é a planilha oficial do Anexo VIII."
        )

    # ---------- matriz REGRA inc. X ----------
    # leitura direta (sem desmesclar): E:F é merge horizontal visual,
    # o valor de N/S (coluna F) é vazio de propósito
    rg = wb["REGRA inc. X"]

    def g(r, c):
        return clean(rg.cell(row=r, column=c).value)

    # linhas 3-5 = dados; colunas B/C = PS onerosa SIM, E/F = PS onerosa NÃO
    regra = [
        {"psOnerosa": "S", "adqExterior": "N",
         "indop": [x for x in (g(3, 2), g(4, 2), g(5, 2)) if x]},
        {"psOnerosa": "S", "adqExterior": "S",
         "indop": [x for x in (g(3, 3), g(4, 3), g(5, 3)) if x]},
        {"psOnerosa": "N", "adqExterior": "N",
         "indop": [x for x in (g(3, 5), g(4, 5), g(5, 5)) if x]},
        {"psOnerosa": "N", "adqExterior": "S",
         "indop": [x for x in (g(3, 6), g(4, 6), g(5, 6)) if x]},
    ]

    # ---------- aba tabela geral ----------
    ws = wb["tabela geral"]
    cab = [clean(ws.cell(row=1, column=c).value).lower() for c in range(1, 11)]
    if not (cab[0].startswith("item") and "nbs" in cab[2] and "indop" in cab[6]):
        raise ErroFonte(
            f"layout inesperado da aba 'tabela geral' em {xlsx_path}: {cab}.\n"
            "  Confira se é a planilha oficial do Anexo VIII antes de regerar."
        )
    grid = unmerge(ws)

    itens = []
    for r in range(2, ws.max_row + 1):
        vals = [clean(grid.get((r, c))) for c in range(1, 11)]
        item, desc_item, nbs, desc_nbs, ps, adq, indop, local, cct, nome_cct = vals
        indop = norm_indop(indop)
        if not (indop or nbs or cct):
            continue  # linha espaçadora
        nbs_digits = re.sub(r"\D", "", nbs)
        itens.append({
            "itemLc116": item,
            "descItem": desc_item,
            "nbs": nbs,
            "nbsDigits": nbs_digits,
            "descNbs": desc_nbs,
            "psOnerosa": ps.upper(),
            "adqExterior": adq.upper(),
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
        raise ErroFonte(
            f"{len(problemas)} registro(s) fora do padrão; a planilha mudou de formato?"
        )

    nbs_unicos = sorted({it["nbsDigits"] for it in itens if it["nbsDigits"]})
    cct_unicos = sorted({it["cClassTrib"] for it in itens if it["cClassTrib"]})
    indops = sorted({it["indop"] for it in itens if it["indop"]})
    locais = sorted({it["localIncidencia"] for it in itens if it["localIncidencia"]})

    return {
        "meta": {
            "fonte": "Anexo VIII — Correlação Item NBS / IndOp / cClassTrib — IBS/CBS",
            "versao": versao,
            "observacao": (
                "Extraído da planilha com desmesclagem de células: cada registro é uma "
                "correlação NBS x IndOp x cClassTrib. IndOp numérico foi normalizado "
                "com zeros à esquerda (6 dígitos). PS Onerosa/Adq. Exterior vazios "
                "aplicam-se às regras de incidência por local de prestação (0301xx)."
            ),
            "geradoEm": gerado_em,
            "correlacoes": len(itens),
            "nbsUnicos": len(nbs_unicos),
            "cClassTribUnicos": len(cct_unicos),
            "indops": indops,
            "locaisIncidencia": locais,
        },
        "regraIndOp": regra,
        "itens": itens,
    }, {"nbs": nbs_unicos, "cct": cct_unicos, "indops": indops, "locais": locais, "regra": regra}


def main(argv=None):
    fim_de_uso()
    parser = argparse.ArgumentParser(
        description="Gera data/anexo-viii.json a partir da planilha do Anexo VIII.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "exemplos:\n"
            f'  python scripts/atualizar_anexo8.py "{DEFAULT_XLSX}"\n'
            "  python scripts/atualizar_anexo8.py --check planilha.xlsx\n"
        ),
    )
    parser.add_argument("planilha", nargs="?", default=DEFAULT_XLSX,
                        help=f"planilha .xlsx do Anexo VIII (padrão: {DEFAULT_XLSX})")
    parser.add_argument("--versao", help="versão a gravar em meta.versao (padrão: lida do nome do arquivo)")
    parser.add_argument("--gerado-em", help="data a gravar em meta.geradoEm (padrão: a do arquivo atual)")
    parser.add_argument("--saida", default=OUT, help=f"arquivo de saída (padrão: {os.path.relpath(OUT, REPO)})")
    parser.add_argument("--check", action="store_true", help="não grava nada; mostra o que mudaria")
    args = parser.parse_args(argv)

    if not os.path.isfile(args.planilha):
        print(
            f"erro: não encontrei a planilha '{args.planilha}' "
            f"(procurando em {os.getcwd()}).\n"
            "  Baixe a planilha do Anexo VIII e passe o caminho completo, por exemplo:\n"
            f'    python scripts/atualizar_anexo8.py "%USERPROFILE%\\Downloads\\{DEFAULT_XLSX}"',
            file=sys.stderr,
        )
        return 1
    if os.path.isdir(args.planilha):
        print(f"erro: '{args.planilha}' é uma pasta, não a planilha.", file=sys.stderr)
        return 1

    versao = args.versao or versao_do_nome(args.planilha)
    if not versao:
        print(
            f"erro: não consegui detectar a versão no nome de '{os.path.basename(args.planilha)}'.\n"
            "  Informe com --versao, por exemplo: --versao V1.02.00",
            file=sys.stderr,
        )
        return 1
    gerado_em = args.gerado_em or gerado_em_do_arquivo(args.saida) or datetime.date.today().isoformat()

    try:
        data, info = gerar(args.planilha, versao, gerado_em)
    except ErroFonte as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1

    texto = json.dumps(data, ensure_ascii=False, indent=1)

    if args.check:
        if mesmo_conteudo(args.saida, texto):
            print(f"sem mudanças: {rel(args.saida)}")
        else:
            print(f"MUDARIA: {rel(args.saida)}")
        print("--check: nada foi gravado.")
        return 0

    gravar(args.saida, texto)
    print(f"OK -> {rel(args.saida)}")
    print(f"  versão: {versao} | geradoEm: {gerado_em}")
    print(f"  correlações: {len(data['itens'])}")
    print(f"  NBS unicos: {len(info['nbs'])} | cClassTrib unicos: {len(info['cct'])} | "
          f"IndOps: {len(info['indops'])}")
    print(f"  matriz regra: {json.dumps(info['regra'], ensure_ascii=False)}")
    print(f"  locais: {info['locais']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
