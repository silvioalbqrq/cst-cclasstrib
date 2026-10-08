# -*- coding: utf-8 -*-
"""Teste de regressão dos datasets do site.

Valida contagens esperadas e consistência entre:
- data/resumo.json (IT 2025.002 v1.70)
- data/classificacao-tributaria.json (snapshot completo)
- data/ncm-nbs.json (índice reverso)
- data/anexo-viii.json (Anexo VIII V1.01.00)
- data/anexos/*.json (fragmentos por cClassTrib, gerados por scripts/gerar_anexos.py)

Uso: python scripts/test_dados.py
Falha (exit 1) se qualquer invariante quebrar.

Ao atualizar para um IT/planilha novo: confira o diff com a fonte oficial,
atualize ESPERADO e, se surgirem novas divergências de nome, mova-as para
DIVERGENCIAS_CONHECIDAS com justificativa no README.
"""
import glob
import json
import os
import re
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
    "anexo_nbs_vazios": 15,
}

# Nomes que divergem entre Portal (IT 1.70) e planilha do Anexo VIII (v1.01.00).
# Hierarquia: prevalece o Portal; a UI avisa no detalhe. Aqui o teste só
# acusa divergências NOVAS (fora desta lista).
DIVERGENCIAS_CONHECIDAS = {"200039", "200042", "200044", "820001", "820002"}

falhas = []


def check(nome, obtido, esperado):
    ok = obtido == esperado
    print(f"{'OK  ' if ok else 'FAIL'} {nome}: {obtido} (esperado {esperado})")
    if not ok:
        falhas.append(nome)


def main():
    with open(os.path.join(DATA, "resumo.json"), encoding="utf-8") as f:
        resumo = json.load(f)
    with open(os.path.join(DATA, "classificacao-tributaria.json"), encoding="utf-8") as f:
        full = json.load(f)
    with open(os.path.join(DATA, "ncm-nbs.json"), encoding="utf-8") as f:
        idx = json.load(f)
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
    print(f"{'OK  ' if ok else 'FAIL'} anexo cCT contidos no resumo: {len(faltando)} faltando")
    if not ok:
        print("  faltando:", faltando)
        falhas.append("anexo-cct-contidos-resumo")

    # Nomes: só admite as divergências conhecidas (Portal prevalece na UI)
    nomes_r = {}
    for p in resumo:
        for f in p.get("ClassificacoesTributarias", []):
            nomes_r[f["CodClassTrib"]] = (f.get("NomeReduzido") or "").strip()
    nomes_a = {}
    for x in anexo.get("itens", []):
        if x.get("cClassTrib"):
            nomes_a.setdefault(x["cClassTrib"], (x.get("nomeClassTrib") or "").strip())
    diver = sorted(c for c in set(nomes_r) & set(nomes_a) if nomes_r[c] != nomes_a[c])
    novas = sorted(set(diver) - DIVERGENCIAS_CONHECIDAS)
    sumidas = sorted(DIVERGENCIAS_CONHECIDAS - set(diver))
    ok = not novas and not sumidas
    print(f"{'OK  ' if ok else 'FAIL'} divergencias de nome: {len(diver)} (conhecidas {sorted(DIVERGENCIAS_CONHECIDAS)})")
    if novas:
        print("  novas (atualize DIVERGENCIAS_CONHECIDAS + README):", novas)
    if sumidas:
        print("  resolvidas na fonte (remova da lista):", sumidas)
    if not ok:
        falhas.append("anexo-nomes-divergentes")

    # NBS com 9 dígitos (quando preenchido) + contagem de NBS vazios
    nbs_invalidos = [x for x in anexo.get("itens", []) if x.get("nbsDigits") and len(x["nbsDigits"]) != 9]
    ok = not nbs_invalidos
    print(f"{'OK  ' if ok else 'FAIL'} NBS 9 dígitos: {len(nbs_invalidos)} inválidos")
    if not ok:
        falhas.append("anexo-nbs-9digitos")
    vazios = [x for x in anexo.get("itens", []) if not x.get("nbsDigits")]
    check("anexo NBS vazios (doc no README)", len(vazios), ESPERADO["anexo_nbs_vazios"])

    # Locais sem variantes duplicadas (normalização em atualizar_anexo8.py)
    locais = [str(x.get("localIncidencia") or "") for x in anexo.get("itens", [])]
    baixos = {}
    for loc in set(locais):
        baixos.setdefault(loc.lower(), set()).add(loc)
    dups = {k: v for k, v in baixos.items() if len(v) > 1}
    ok = not dups
    print(f"{'OK  ' if ok else 'FAIL'} locais sem variantes: {len(dups)} duplicados")
    if not ok:
        print("  duplicados:", dups)
        falhas.append("anexo-locais-duplicados")

    # Cruzamento resumo x full x índice
    s_full = {f["CodClassTrib"] for p in full for f in p.get("ClassificacoesTributarias", [])}
    ok = s_full == s_resumo
    print(f"{'OK  ' if ok else 'FAIL'} resumo x full: {len(s_full ^ s_resumo)} divergentes")
    if not ok:
        falhas.append("resumo-x-full")
    qtd = {f["CodClassTrib"]: f.get("qtdAnexos", 0) for p in resumo for f in p.get("ClassificacoesTributarias", [])}
    reais = {}
    for p in full:
        for f in p.get("ClassificacoesTributarias", []):
            reais[f["CodClassTrib"]] = len(f.get("Anexos") or [])
    diverg = sorted(c for c in qtd if qtd[c] != reais.get(c))
    ok = not diverg
    print(f"{'OK  ' if ok else 'FAIL'} qtdAnexos x full: {len(diverg)} divergentes")
    if not ok:
        falhas.append("qtdanexos-x-full")

    # Fragmentos data/anexos/*.json (Detalhe baixa o fragmento, não o full)
    frags = glob.glob(os.path.join(DATA, "anexos", "*.json"))
    ok = len(frags) == len(s_resumo)
    print(f"{'OK  ' if ok else 'FAIL'} fragmentos anexos: {len(frags)} arquivos (esperado {len(s_resumo)})")
    if not ok:
        falhas.append("anexos-fragmentos-quantidade")
    soma_frag, ruins = 0, []
    for fp in frags:
        with open(fp, encoding="utf-8") as fh:
            d = json.load(fh)
        base = os.path.splitext(os.path.basename(fp))[0]
        if d.get("cod") != base or not isinstance(d.get("anexos"), list):
            ruins.append(base)
        soma_frag += len(d.get("anexos", []))
    ok = not ruins
    print(f"{'OK  ' if ok else 'FAIL'} fragmentos íntegros: {len(ruins)} ruins")
    if ruins:
        falhas.append("anexos-fragmentos-integros")
    soma_full = sum(reais.values())
    ok = soma_frag == soma_full
    print(f"{'OK  ' if ok else 'FAIL'} fragmentos x full: {soma_frag} itens (esperado {soma_full})")
    if not ok:
        falhas.append("anexos-fragmentos-x-full")

    # ASSET_V consistente entre index.html e assets/app.js
    html = open(os.path.join(REPO, "index.html"), encoding="utf-8").read()
    js = open(os.path.join(REPO, "assets", "app.js"), encoding="utf-8").read()
    m_html = re.search(r"assets/app\.js\?v=([\w.-]+)", html)
    m_js = re.search(r'ASSET_V\s*=\s*"([\w.-]+)"', js)
    vh = m_html.group(1) if m_html else None
    vj = m_js.group(1) if m_js else None
    ok = bool(vh and vj and vh == vj)
    print(f"{'OK  ' if ok else 'FAIL'} ASSET_V: html={vh} js={vj}")
    if not ok:
        falhas.append("asset-v-divergente")

    if falhas:
        print(f"\n{len(falhas)} falha(s): {falhas}")
        sys.exit(1)
    print("\nTudo certo.")


if __name__ == "__main__":
    main()
