# -*- coding: utf-8 -*-
"""Regenera data/ncm-descricoes.json a partir do dataset TIPI do consulta-ncm.

Fonte: https://silvioalbqrq.github.io/consulta-ncm/tipi-data.js
  (array TIPI_DATA com {ncm, digits, ex, desc, aliq, tipo})

Uso:
  python scripts/atualizar_descricoes.py                      # baixa a URL da fonte
  python scripts/atualizar_descricoes.py tipi-data.js        # usa o arquivo salvo
  python scripts/atualizar_descricoes.py --check             # não grava: compara

Formato de saída (hierárquico, para ficar pequeno):
  {"g": {prefixo: descrição do grupo}, "i": {NCM de 8 dígitos: descrição do item}}
O app remonta a descrição completa (capítulo -> posição -> item) em tempo de
execução com descNcm().
"""
import argparse
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _comum import ErroFonte, fim_de_uso, gravar, ler_fonte, mesmo_conteudo, rel  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(REPO, "data", "ncm-descricoes.json")
TIPI_URL = "https://silvioalbqrq.github.io/consulta-ncm/tipi-data.js"


def clean(t):
    return re.sub(r"^[\-\u2013\u2014\.\s]+", "", str(t or "").strip()).strip()


def montar(src, origem):
    m = re.search(r"=\s*(\[.*\])\s*;?\s*$", src, re.DOTALL)
    if not m:
        raise ErroFonte(
            f"não achei o array TIPI_DATA em {origem}.\n"
            "  Confira se é o tipi-data.js do consulta-ncm (um arquivo .js com\n"
            "  'TIPI_DATA = [...]'); uma página de erro do site também cai aqui."
        )
    try:
        data = json.loads(m.group(1))
    except json.JSONDecodeError as e:
        raise ErroFonte(f"TIPI_DATA em {origem} não é JSON válido: {e}")

    grupos, itens = {}, {}
    for r in data:
        d = str(r.get("digits") or "")
        t = clean(r.get("desc", ""))
        if not d or not t:
            continue
        if len(d) == 8:
            itens.setdefault(d, t)
        else:
            grupos.setdefault(d, t)
    if not itens:
        raise ErroFonte(f"nenhum NCM de 8 dígitos encontrado em {origem}; fonte inesperada.")
    return {"g": grupos, "i": itens}


def main(argv=None):
    fim_de_uso()
    parser = argparse.ArgumentParser(
        description="Regenera data/ncm-descricoes.json a partir do TIPI do consulta-ncm.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "exemplos:\n"
            "  python scripts/atualizar_descricoes.py\n"
            "  python scripts/atualizar_descricoes.py tipi-data.js\n"
        ),
    )
    parser.add_argument("origem", nargs="?", default=TIPI_URL,
                        help=f"URL (padrão: {TIPI_URL}) ou arquivo tipi-data.js salvo")
    parser.add_argument("--check", action="store_true", help="não grava nada; mostra o que mudaria")
    args = parser.parse_args(argv)

    try:
        src = ler_fonte(args.origem, "o tipi-data.js do consulta-ncm")
        dados = montar(src, args.origem)
    except ErroFonte as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1

    texto = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))

    if args.check:
        if mesmo_conteudo(DST, texto):
            print(f"sem mudanças: {rel(DST)}")
        else:
            print(f"MUDARIA: {rel(DST)}")
        print("--check: nada foi gravado.")
        return 0

    gravar(DST, texto)
    print(f"NCMs: {len(dados['i'])} | grupos: {len(dados['g'])}")
    print(f"wrote {rel(DST)} ({len(texto.encode('utf-8')) / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
