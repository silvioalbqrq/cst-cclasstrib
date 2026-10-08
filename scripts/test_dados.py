# -*- coding: utf-8 -*-
"""Teste de regressão dos datasets do site.

Valida contagens esperadas e consistência entre:
- data/resumo.json (IT 2025.002 v1.70)
- data/anexo-viii.json (Anexo VIII V1.01.00)

Uso: python scripts/test_dados.py
Falha (exit 1) se qualquer invariante quebrar.
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(REPO, "data")

ESPERADO = {
    "csts": 18,
    "cclasstrib_resumo": 173,
    "anexo_versao": "V1.01.00",
    "anexo_correlacoes": 1517,
    "anexo_nbs": 731,
    "anexo_cct": 28,
    "anexo_indops": 19,
}

falhas = []


def check(nome, obtido, esperado):
    ok = obtido == esperado
    print(f"{'OK  ' if ok else 'FAIL'} {nome}: {obtido} (esperado {esperado})")
    if not ok:
        falhas.append(nome)


def main():
    with open(os.path.join(DATA, "resumo.json"), encoding="utf-8") as f:
        resumo = json.load(f)
    with open(os.path.join(DATA, "anexo-viii.json"), encoding="utf-8") as f:
        anexo = json.load(f)

    csts = len(resumo)
    ccts = sum(len(p.get("ClassificacoesTributarias", [])) for p in resumo)
    check("CSTs (resumo)", csts, ESPERADO["csts"])
    check("cClassTrib (resumo)", ccts, ESPERADO["cclasstrib_resumo"])

    meta = anexo.get("meta", {})
    check("anexo versao", meta.get("versao"), ESPERADO["anexo_versao"])
    check("anexo correlacoes", meta.get("correlacoes"), ESPERADO["anexo_correlacoes"])
    check("anexo correlacoes (len itens)", len(anexo.get("itens", [])), ESPERADO["anexo_correlacoes"])
    check("anexo NBS unicos", meta.get("nbsUnicos"), ESPERADO["anexo_nbs"])
    check("anexo cClassTrib unicos", meta.get("cClassTribUnicos"), ESPERADO["anexo_cct"])
    check("anexo IndOps", len(meta.get("indops", [])), ESPERADO["anexo_indops"])

    # Consistência: todo cClassTrib do Anexo VIII existe no resumo (IT 1.70)
    s_resumo = {f["CodClassTrib"] for p in resumo for f in p.get("ClassificacoesTributarias", [])}
    s_anexo = {x["cClassTrib"] for x in anexo.get("itens", []) if x.get("cClassTrib")}
    faltando = sorted(s_anexo - s_resumo)
    ok = not faltando
    print(f"{'OK  ' if ok else 'FAIL'} anexo cCT contidos no resumo: {len(s_anexo - s_resumo)} faltando")
    if not ok:
        print("  faltando:", faltando)
        falhas.append("anexo-cct-contidos-resumo")

    # NBS com 9 dígitos (quando preenchido)
    nbs_invalidos = [x for x in anexo.get("itens", []) if x.get("nbsDigits") and len(x["nbsDigits"]) != 9]
    ok = not nbs_invalidos
    print(f"{'OK  ' if ok else 'FAIL'} NBS 9 dígitos: {len(nbs_invalidos)} inválidos")
    if not ok:
        falhas.append("anexo-nbs-9digitos")

    if falhas:
        print(f"\n{len(falhas)} falha(s): {falhas}")
        sys.exit(1)
    print("\nTudo certo.")


if __name__ == "__main__":
    main()
