# -*- coding: utf-8 -*-
"""Fatia os anexos (NCM/NBS) por cClassTrib para o Detalhe não baixar o snapshot completo.

Lê data/classificacao-tributaria.json e grava um fragmento por código em
data/anexos/<CodClassTrib>.json: {"cod": ..., "anexos": [...]}

O app (assets/app.js) tenta o fragmento primeiro e só usa o snapshot
completo como fallback. Rode após scripts/atualizar.py.

Uso:
  python scripts/gerar_anexos.py
  python scripts/gerar_anexos.py --check    # não grava: diz o que mudaria

Fragmentos de cClassTrib que não existem mais no snapshot são removidos, para
a pasta data/anexos/ continuar batendo com data/resumo.json.
"""
import argparse
import glob
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _comum import ErroFonte, fim_de_uso, gravar, mesmo_conteudo, rel  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL = os.path.join(REPO, "data", "classificacao-tributaria.json")
OUT_DIR = os.path.join(REPO, "data", "anexos")


def main(argv=None):
    fim_de_uso()
    parser = argparse.ArgumentParser(
        description="Fatia data/classificacao-tributaria.json em data/anexos/<cod>.json.",
    )
    parser.add_argument("--check", action="store_true", help="não grava nada; mostra o que mudaria")
    args = parser.parse_args(argv)

    if not os.path.isfile(FULL):
        print(f"erro: não encontrei {rel(FULL)}. Rode scripts/atualizar.py primeiro.",
              file=sys.stderr)
        return 1
    try:
        with open(FULL, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"erro: não consegui ler {rel(FULL)}: {e}", file=sys.stderr)
        return 1

    if not isinstance(data, list):
        raise ErroFonte(f"{rel(FULL)} não é a lista de CSTs esperada.")

    visto = set()
    total_cods = total_anexos = 0
    mudados = []
    for pai in data:
        for filho in pai.get("ClassificacoesTributarias", []):
            cod = filho.get("CodClassTrib")
            if not cod:
                continue
            cod = str(cod)
            visto.add(cod)
            anexos = filho.get("Anexos") or []
            texto = json.dumps({"cod": cod, "anexos": anexos},
                               ensure_ascii=False, separators=(",", ":"))
            destino = os.path.join(OUT_DIR, f"{cod}.json")
            if not args.check:
                gravar(destino, texto)
            elif not mesmo_conteudo(destino, texto):
                mudados.append(cod)
            total_cods += 1
            total_anexos += len(anexos)

    orfaos = sorted(
        os.path.splitext(os.path.basename(p))[0]
        for p in glob.glob(os.path.join(OUT_DIR, "*.json"))
        if os.path.splitext(os.path.basename(p))[0] not in visto
    )

    if args.check:
        print(f"códigos: {total_cods} | itens de anexo: {total_anexos}")
        print(f"fragmentos que mudariam: {len(mudados)}"
              + (f" ({', '.join(mudados[:10])}{'...' if len(mudados) > 10 else ''})" if mudados else ""))
        print(f"fragmentos órfãos (seriam removidos): {len(orfaos)}"
              + (f" ({', '.join(orfaos[:10])}{'...' if len(orfaos) > 10 else ''})" if orfaos else ""))
        print("--check: nada foi gravado.")
        return 0

    for cod in orfaos:
        os.remove(os.path.join(OUT_DIR, f"{cod}.json"))
    print(f"OK -> {rel(OUT_DIR)}")
    print(f"  códigos: {total_cods} | itens de anexo: {total_anexos}")
    if orfaos:
        print(f"  removidos (cClassTrib que não existe mais): {len(orfaos)}"
              + (f" ({', '.join(orfaos[:10])}{'...' if len(orfaos) > 10 else ''})" if orfaos else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
