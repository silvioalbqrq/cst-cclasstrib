# -*- coding: utf-8 -*-
"""Regenera os dados do site a partir do dataset do portal oficial.

Fonte oficial:
  https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria

Uso:
  python scripts/atualizar.py                     # baixa a URL oficial
  python scripts/atualizar.py portal.html         # usa a página já salva
  python scripts/atualizar.py --check             # não grava: mostra o que mudaria
  python scripts/atualizar.py --force             # aceita descartar anexos curados
  python scripts/atualizar.py http://outro.endereco/pagina.html

Aceita URL ou arquivo local (salvo no navegador como "página completa"). Depois
de extrair, aplica scripts/patches.json — os anexos curados à mão que a fonte
oficial não traz. Se a fonte (com os patches) for mais pobre que o arquivo
atual, o script NÃO grava nada e lista o que seria perdido; use --force só
quando a perda for intencional.

Gera:
  - data/classificacao-tributaria.json (retrato completo)
  - data/resumo.json (enxuto + minificado, carregado pelo app; as listas de
    anexo NCM/NBS ficam só no arquivo completo e são buscadas sob demanda)
  - data/ncm-nbs.json (índice reverso NCM/NBS -> cClassTrib, carga sob demanda)

Depois rode scripts/gerar_anexos.py, ou use scripts/atualizar_tudo.py, que
encadeia tudo.
"""
import argparse
import collections
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _comum import ErroFonte, fim_de_uso, gravar, ler_fonte, mesmo_conteudo, rel  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(REPO, "data")
FULL_PATH = os.path.join(DATA_DIR, "classificacao-tributaria.json")
SLIM_PATH = os.path.join(DATA_DIR, "resumo.json")
IDX_PATH = os.path.join(DATA_DIR, "ncm-nbs.json")
PATCHES_PATH = os.path.join(REPO, "scripts", "patches.json")

PORTAL_URL = "https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria"

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


def extract_dataset(html: str, origem: str = "a fonte"):
    marker = "var dadosOriginais = "
    idx = html.find(marker)
    if idx < 0:
        raise ErroFonte(
            f"não achei o dataset 'var dadosOriginais' em {origem}.\n"
            "  Confirme que é a página do portal e que ela foi salva como\n"
            "  'página completa' (não 'somente HTML')."
        )
    start = idx + len(marker)
    if html[start] != "[":
        raise ErroFonte("o dataset encontrado não começa com '['; página inesperada.")
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
        raise ErroFonte("achei o início do dataset mas não o fim; página truncada?")
    try:
        data = json.loads(html[start:end])
    except json.JSONDecodeError as e:
        raise ErroFonte(f"o dataset encontrado não é JSON válido: {e}")
    if not isinstance(data, list) or not data:
        raise ErroFonte("o dataset veio vazio; página inesperada.")
    if not any(isinstance(p, dict) and p.get("ClassificacoesTributarias") for p in data):
        raise ErroFonte(
            "o dataset não traz 'ClassificacoesTributarias'; a página pode ter mudado de formato."
        )
    return data


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

    Anotação curada entra como 6º elemento do ref (o rótulo do patch), e só
    existe nos vínculos que vieram de scripts/patches.json.
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
                if a.get("Curadoria"):
                    ref.append(a["Curadoria"])
                if ref not in entry["ref"]:
                    entry["ref"].append(ref)
    for entry in codes.values():
        entry["ref"].sort()
    return {"codes": codes}


# --------------------------------------------------------------- patches ---

def _chave(anexo):
    return json.dumps(anexo, ensure_ascii=False, sort_keys=True)


def _chave_conteudo(anexo):
    """Chave do anexo sem os campos de apresentação (a marca de curadoria).

    A guarda de perda compara conteúdo: marcar um vínculo como curadoria não é
    perder dado, então "Curadoria" fica fora da comparação.
    """
    return _chave({k: v for k, v in anexo.items() if k != "Curadoria"})


def _por_codigo(data):
    out = {}
    for pai in data:
        for f in pai.get("ClassificacoesTributarias", []):
            cod = str(f.get("CodClassTrib") or "")
            if cod:
                out[cod] = f
    return out


def carregar_patches(caminho):
    if not os.path.isfile(caminho):
        raise ErroFonte(
            f"não encontrei o arquivo de patches '{caminho}'.\n"
            "  Use --sem-patches para atualizar sem aplicar curadoria."
        )
    with open(caminho, encoding="utf-8") as fh:
        doc = json.load(fh)
    patches = doc.get("patches") if isinstance(doc, dict) else None
    if not isinstance(patches, list):
        raise ErroFonte(f"'{caminho}' não tem a lista 'patches'.")
    return patches


def _entradas_do_patch(patch):
    """Expande um patch: cada item é o anexo inteiro ou só o que varia do modelo.

    A entrada gerada leva "Curadoria": <rotulo do patch>, para a tela avisar que
    aquele vínculo não está na lista oficial. Como a marca nasce do patch, ela
    desaparece sozinha quando a fonte passar a trazer o item: o patch fica
    obsoleto e a entrada oficial (sem marca) é a que permanece.
    """
    modelo = patch.get("modelo") or {}
    rotulo = patch.get("rotulo") or ""
    for variacao in patch.get("itens") or []:
        entrada = dict(modelo)
        entrada.update(variacao)
        if rotulo:
            entrada["Curadoria"] = rotulo
        yield entrada


def aplicar_patches(data, patches):
    """Acrescenta ao fim de cada cClassTrib os anexos curados do patches.json.

    Devolve um relatório por patch. Entradas que a fonte já traga são puladas,
    para o patch poder ser removido depois sem duplicar dado.
    """
    por_cod = _por_codigo(data)
    relatorio = []
    for p in patches:
        cod = str(p.get("cClassTrib") or "")
        item = {"cod": cod, "aplicados": 0, "presentes": 0, "erro": None}
        alvo = por_cod.get(cod)
        if alvo is None:
            item["erro"] = "cClassTrib não encontrado na fonte"
            relatorio.append(item)
            continue
        anexos = alvo.setdefault("Anexos", [])
        existentes = collections.Counter(_chave(a) for a in anexos)
        usados = collections.Counter()
        for entrada in _entradas_do_patch(p):
            k = _chave(entrada)
            usados[k] += 1
            if usados[k] <= existentes[k]:
                item["presentes"] += 1
            else:
                anexos.append(entrada)
                item["aplicados"] += 1
        relatorio.append(item)
    return relatorio


def conferir_patches(data, patches):
    """Anexos curados que faltam no dataset. Usado por scripts/test_dados.py."""
    por_cod = _por_codigo(data)
    faltando = []
    for p in patches:
        cod = str(p.get("cClassTrib") or "")
        alvo = por_cod.get(cod)
        if alvo is None:
            faltando.append((cod, "cClassTrib não está no dataset"))
            continue
        existentes = collections.Counter(_chave(a) for a in (alvo.get("Anexos") or []))
        usados = collections.Counter()
        ausentes = 0
        for entrada in _entradas_do_patch(p):
            k = _chave(entrada)
            usados[k] += 1
            if usados[k] > existentes[k]:
                ausentes += 1
        if ausentes:
            faltando.append((cod, f"{ausentes} anexo(s) curado(s) ausente(s)"))
    return faltando


# ---------------------------------------------------------- guarda e I/O ---

def _contar_anexos(data):
    return sum(
        len(f.get("Anexos") or [])
        for p in data
        for f in p.get("ClassificacoesTributarias", [])
    )


def conferir_perda(antigo, novo):
    """Anexos que existem no arquivo atual e não no dataset novo (com repetição)."""
    if antigo is None:
        return {}
    atual = {c: collections.Counter(_chave_conteudo(a) for a in (f.get("Anexos") or []))
             for c, f in _por_codigo(antigo).items()}
    futuro = {c: collections.Counter(_chave_conteudo(a) for a in (f.get("Anexos") or []))
              for c, f in _por_codigo(novo).items()}
    faltando = {}
    for cod, cont in atual.items():
        delta = cont - futuro.get(cod, collections.Counter())
        if sum(delta.values()):
            faltando[cod] = sum(delta.values())
    return dict(sorted(faltando.items()))


def _mensagem_perda(faltando):
    linhas = [
        "ATENÇÃO: a fonte (portal + patches) não traz anexos que existem hoje em "
        "data/classificacao-tributaria.json.",
        "Gravar assim apagaria curadoria:",
    ]
    for cod, n in faltando.items():
        linhas.append(f"  {cod}: {n} anexo(s)")
    linhas += [
        "Se a perda é intencional, rode com --force.",
        "Se não é, registre o anexo em scripts/patches.json (motivo + referência) antes de atualizar.",
    ]
    return "\n".join(linhas)


def _ler_json(caminho):
    if not os.path.isfile(caminho):
        return None
    try:
        with open(caminho, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError) as e:
        print(f"aviso: não consegui ler {caminho} para comparar ({e}).", file=sys.stderr)
        return None


# ------------------------------------------------------------------ main ---

def _relatorio_patches(relatorio):
    if not relatorio:
        return
    aplicados = sum(r["aplicados"] for r in relatorio)
    presentes = sum(r["presentes"] for r in relatorio)
    print(f"patches: {len(relatorio)} | {aplicados} anexo(s) curado(s) aplicado(s)"
          + (f" | {presentes} já vinham da fonte" if presentes else ""))
    for r in relatorio:
        if r["erro"]:
            print(f"  aviso: patch {r['cod']}: {r['erro']} — confira scripts/patches.json",
                  file=sys.stderr)
        elif r["aplicados"] == 0 and r["presentes"]:
            print(f"  aviso: patch {r['cod']} está obsoleto (a fonte já traz as "
                  f"{r['presentes']} entrada(s)); pode remover de scripts/patches.json",
                  file=sys.stderr)


def _relatorio_diff(data, atual):
    if atual is None:
        print("comparação: data/classificacao-tributaria.json ainda não existe.")
        return
    antes, agora = _por_codigo(atual), _por_codigo(data)
    novos = sorted(set(agora) - set(antes))
    sumidos = sorted(set(antes) - set(agora))
    print(f"cClassTrib: {len(antes)} -> {len(agora)}"
          + (f" (novos: {', '.join(novos[:12])}{'...' if len(novos) > 12 else ''})" if novos else "")
          + (f" (sumiram: {', '.join(sumidos[:12])}{'...' if len(sumidos) > 12 else ''})" if sumidos else ""))
    antes_n, agora_n = _contar_anexos(atual), _contar_anexos(data)
    print(f"anexos: {antes_n} -> {agora_n} ({agora_n - antes_n:+d})")


def _executar(args):
    html = ler_fonte(args.origem, "a página do portal")
    data = extract_dataset(html, args.origem)

    patches = [] if args.sem_patches else carregar_patches(args.patches)
    relatorio = aplicar_patches(data, patches) if patches else []

    atual = _ler_json(FULL_PATH)
    faltando = conferir_perda(atual, data)
    if faltando and not args.force:
        print(_mensagem_perda(faltando), file=sys.stderr)
        return 1
    if faltando:
        print(f"aviso: --force descartou {sum(faltando.values())} anexo(s) curado(s) "
              f"em {len(faltando)} cClassTrib.", file=sys.stderr)

    texto_full = json.dumps(data, ensure_ascii=False, indent=1)
    texto_slim = json.dumps(slim(data), ensure_ascii=False, separators=(",", ":"))
    texto_idx = json.dumps(build_index(data), ensure_ascii=False, separators=(",", ":"))

    csts = len(data)
    ccts = sum(len(p.get("ClassificacoesTributarias", [])) for p in data)
    print(f"fonte: {csts} CSTs | {ccts} cClassTrib | {_contar_anexos(data)} anexos")
    _relatorio_patches(relatorio)
    _relatorio_diff(data, atual)

    arquivos = ((FULL_PATH, texto_full), (SLIM_PATH, texto_slim), (IDX_PATH, texto_idx))
    if args.check:
        print()
        for caminho, texto in arquivos:
            estado = "sem mudanças" if mesmo_conteudo(caminho, texto) else "MUDARIA"
            print(f"  {estado}: {rel(caminho)}")
        print("--check: nada foi gravado.")
        return 0

    for caminho, texto in arquivos:
        gravar(caminho, texto)
        print(f"wrote {rel(caminho)} ({len(texto.encode('utf-8')) / 1024:.0f} KB)")
    return 0


def main(argv=None):
    fim_de_uso()
    parser = argparse.ArgumentParser(
        description="Regenera os JSONs de dados a partir do portal oficial (URL ou arquivo salvo).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "exemplos:\n"
            "  python scripts/atualizar.py\n"
            "  python scripts/atualizar.py portal.html\n"
            "  python scripts/atualizar.py --check\n"
        ),
    )
    parser.add_argument("origem", nargs="?", default=PORTAL_URL,
                        help=f"URL (padrão: {PORTAL_URL}) ou arquivo HTML salvo")
    parser.add_argument("--check", action="store_true",
                        help="não grava nada; mostra o que mudaria")
    parser.add_argument("--force", action="store_true",
                        help="grava mesmo descartando anexos curados ausentes na fonte")
    parser.add_argument("--sem-patches", action="store_true",
                        help="não aplica scripts/patches.json")
    parser.add_argument("--patches", default=PATCHES_PATH,
                        help="arquivo de patches (padrão: scripts/patches.json)")
    args = parser.parse_args(argv)

    try:
        return _executar(args)
    except ErroFonte as e:
        print(f"erro: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
