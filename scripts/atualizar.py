"""Regenerate data files from a saved copy of the official portal page.

Official source:
  https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria

Usage:
  1. Open the URL above in a browser, save the complete page HTML
     (e.g. "portal.html", UTF-8).
  2. Run:  python scripts/atualizar.py portal.html
  3. Commit the regenerated files under data/.

What it does:
  - Extracts the embedded `var dadosOriginais = [...]` dataset.
  - Writes data/classificacao-tributaria.json (complete snapshot).
  - Writes data/resumo.json (slim + minified file loaded by the app;
    annex NCM/NBS lists stay only in the complete file and are
    fetched on demand by the detail view).
  - Writes data/ncm-nbs.json (reverse index NCM/NBS -> cClassTribs,
    loaded on demand by the NCM/NBS search tab).
"""
import json
import os
import sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "data")
FULL_PATH = os.path.join(DATA_DIR, "classificacao-tributaria.json")
SLIM_PATH = os.path.join(DATA_DIR, "resumo.json")
IDX_PATH = os.path.join(DATA_DIR, "ncm-nbs.json")

PAI_KEEP = [
    "Cst", "NomeCst",
    "IndExigeTrib", "IndReducaoBc", "IndReducaoAliq",
    "IndTransferenciaCred", "IndDiferimento", "IndMonofasica",
    "IndCredPresIbsZfm", "IndAjusteCompet",
    "DthPublicacao", "DthIniVig", "DthFimVig",
]

FILHO_KEEP = [
    "CodClassTrib", "Cst", "NomeClassTrib", "NomeReduzido",
    "TipoAliq", "TipoRbSn", "PercRedIbs", "PercRedCbs",
    "IndTribRegular", "IndPermiteCredPres", "IndEstornoCred",
    "IndMonoRetem", "IndMonoRet", "IndMonoDif", "IndMonoVal",
    "IndPbioDiferenca", "PossuiIndDfe",
    "IndBpe", "IndBpeta", "IndBpetm", "IndCte", "IndCteos",
    "IndNf3e", "IndNfabi", "IndNfag", "IndNfce", "IndNfcom",
    "IndNfe", "IndNfse", "IndNfsvia", "IndNfgas",
    "IndDere", "IndDir", "IndDuimp",
    "DthPublicacao", "DthIniVig", "DthFimVig",
    "TexRegIbs", "TexRegCbs", "TexUrlLegislacao", "NroAnexo",
]


def extract_dataset(html: str):
    marker = "var dadosOriginais = "
    idx = html.find(marker)
    if idx < 0:
        raise SystemExit("dataset 'var dadosOriginais' not found in HTML")
    start = idx + len(marker)
    if html[start] != "[":
        raise SystemExit("unexpected dataset start")
    depth, in_str, esc, end = 0, False, False, None
    for i in range(start, len(html)):
        ch = html[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
        elif ch == '"':
            in_str = True
        elif ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if not end:
        raise SystemExit("could not find end of dataset")
    return json.loads(html[start:end])


def slim(data):
    out = []
    for pai in data:
        filhos = []
        for f in pai.get("ClassificacoesTributarias", []):
            anexos = f.get("Anexos") or []
            g = {k: f.get(k) for k in FILHO_KEEP}
            g["qtdAnexos"] = len(anexos)
            filhos.append(g)
        g_pai = {k: pai.get(k) for k in PAI_KEEP}
        g_pai["ClassificacoesTributarias"] = filhos
        out.append(g_pai)
    return out


def build_index(data):
    """Reverse index: NCM/NBS code -> list of referencing cClassTribs.

    {"codes": {"10062010": {"t": "NCM", "ref": [[cst, cod, permissao, ini, fim], ...]}}}
    """
    codes = {}
    for pai in data:
        for f in pai.get("ClassificacoesTributarias", []):
            for a in f.get("Anexos") or []:
                cod = str(a.get("CodNcmNbs") or "").strip()
                if not cod:
                    continue
                entry = codes.setdefault(cod, {"t": a.get("TipoCodigo"), "ref": []})
                ref = [
                    f.get("Cst"), f.get("CodClassTrib"),
                    a.get("TipoPermissao"),
                    (a.get("DthIniVig") or "")[:10],
                    (a.get("DthFimVig") or "")[:10],
                ]
                if ref not in entry["ref"]:
                    entry["ref"].append(ref)
    for entry in codes.values():
        entry["ref"].sort()
    return {"codes": codes}


def main():
    if len(sys.argv) != 2:
        raise SystemExit("usage: python scripts/atualizar.py <portal.html>")
    with open(sys.argv[1], "r", encoding="utf-8") as fh:
        html = fh.read()
    data = extract_dataset(html)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(FULL_PATH, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=1)
    with open(SLIM_PATH, "w", encoding="utf-8") as fh:
        json.dump(slim(data), fh, ensure_ascii=False, separators=(",", ":"))
    with open(IDX_PATH, "w", encoding="utf-8") as fh:
        json.dump(build_index(data), fh, ensure_ascii=False, separators=(",", ":"))
    n_filho = sum(len(p.get("ClassificacoesTributarias", [])) for p in data)
    print(f"CST groups: {len(data)} | cClassTrib: {n_filho}")
    print(f"wrote {FULL_PATH} ({os.path.getsize(FULL_PATH)/1024:.0f} KB)")
    print(f"wrote {SLIM_PATH} ({os.path.getsize(SLIM_PATH)/1024:.0f} KB)")
    print(f"wrote {IDX_PATH} ({os.path.getsize(IDX_PATH)/1024:.0f} KB)")


if __name__ == "__main__":
    main()
