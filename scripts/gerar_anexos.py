# -*- coding: utf-8 -*-
"""Fatia os anexos (NCM/NBS) por cClassTrib para o Detalhe não baixar o snapshot completo.

Lê data/classificacao-tributaria.json e grava um fragmento por código em
data/anexos/<CodClassTrib>.json: {"cod": ..., "anexos": [...]}

O app (assets/app.js) tenta o fragmento primeiro e só usa o snapshot
completo como fallback. Rode após scripts/atualizar.py.

Uso: python scripts/gerar_anexos.py
"""
import json
import os

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FULL = os.path.join(REPO, "data", "classificacao-tributaria.json")
OUT_DIR = os.path.join(REPO, "data", "anexos")


def main():
    with open(FULL, encoding="utf-8") as f:
        data = json.load(f)
    os.makedirs(OUT_DIR, exist_ok=True)
    total_cods, total_anexos = 0, 0
    for pai in data:
        for filho in pai.get("ClassificacoesTributarias", []):
            cod = filho.get("CodClassTrib")
            if not cod:
                continue
            anexos = filho.get("Anexos") or []
            with open(os.path.join(OUT_DIR, f"{cod}.json"), "w", encoding="utf-8") as f:
                json.dump({"cod": cod, "anexos": anexos}, f, ensure_ascii=False, separators=(",", ":"))
            total_cods += 1
            total_anexos += len(anexos)
    print(f"OK -> {OUT_DIR}")
    print(f"  códigos: {total_cods} | itens de anexo: {total_anexos}")


if __name__ == "__main__":
    main()
