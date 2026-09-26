"""Regenerate data/ncm-descricoes.json from the consulta-ncm TIPI dataset.

Source: https://silvioalbqrq.github.io/consulta-ncm/tipi-data.js
  (array TIPI_DATA with {ncm, digits, ex, desc, aliq, tipo})

Usage:
  1. Download tipi-data.js (save the file locally).
  2. Run:  python scripts/atualizar_descricoes.py tipi-data.js
  3. Commit the regenerated data/ncm-descricoes.json.

Output format (hierarchical to keep it small):
  {"g": {prefix: group description}, "i": {8-digit NCM: item fragment}}
The app rebuilds the full description (chapter -> position -> item)
at runtime with descNcm().
"""
import json
import os
import re
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DST = os.path.join(REPO, "data", "ncm-descricoes.json")


def clean(t):
    return re.sub(r"^[\-\u2013\u2014\.\s]+", "", str(t or "").strip()).strip()


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/atualizar_descricoes.py <tipi-data.js>")
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        src = fh.read()
    m = re.search(r"=\s*(\[.*\])\s*;?\s*$", src, re.DOTALL)
    if not m:
        raise SystemExit("TIPI_DATA array not found")
    data = json.loads(m.group(1))

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

    with open(DST, "w", encoding="utf-8") as fh:
        json.dump({"g": grupos, "i": itens}, fh, ensure_ascii=False,
                  separators=(",", ":"))
    print(f"NCMs: {len(itens)} | grupos: {len(grupos)}")
    print(f"wrote {DST} ({os.path.getsize(DST)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
