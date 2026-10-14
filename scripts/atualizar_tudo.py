# -*- coding: utf-8 -*-
"""Fluxo completo de atualização dos dados do site, na ordem certa.

  1. scripts/atualizar.py             portal -> data/*.json (aplicando os patches)
  2. scripts/atualizar_anexo8.py      só com --anexo8 PLANILHA
  3. scripts/atualizar_descricoes.py  só com --descricoes
  4. scripts/gerar_anexos.py          fatia data/anexos/<cod>.json
  5. scripts/test_dados.py            confere contagens e cruzamentos

O passo 1 é o único obrigatório: os passos 2 e 3 vêm de fontes diferentes
(planilha do Anexo VIII e tipi-data.js do consulta-ncm) e mudam em ritmo
próprio, por isso ficam atrás de uma opção.

Uso:
  python scripts/atualizar_tudo.py
  python scripts/atualizar_tudo.py --check
  python scripts/atualizar_tudo.py --portal portal.html
  python scripts/atualizar_tudo.py --anexo8 planilha.xlsx --descricoes
"""
import argparse
import os
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _comum import fim_de_uso  # noqa: E402

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(REPO, "scripts")


def rodar(rotulo, comando):
    print(f"\n=== {rotulo} ===", flush=True)
    print("$ " + " ".join(comando), flush=True)
    codigo = subprocess.call(comando, cwd=REPO)
    if codigo != 0:
        print(f"FALHOU (exit {codigo}): {rotulo}", file=sys.stderr)
    return codigo


def main(argv=None):
    fim_de_uso()
    parser = argparse.ArgumentParser(
        description="Atualiza todos os dados do site e roda os testes.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "exemplos:\n"
            "  python scripts/atualizar_tudo.py\n"
            "  python scripts/atualizar_tudo.py --check\n"
            '  python scripts/atualizar_tudo.py --anexo8 "AnexoVIII-...V1.01.00.xlsx" --descricoes\n'
        ),
    )
    parser.add_argument("--portal", metavar="ORIGEM",
                        help="URL ou página salva do portal (padrão: a URL oficial)")
    parser.add_argument("--anexo8", metavar="PLANILHA",
                        help="também regerar data/anexo-viii.json a partir desta planilha")
    parser.add_argument("--descricoes", nargs="?", const="", metavar="ARQUIVO",
                        help="também regerar data/ncm-descricoes.json (padrão: baixar a URL)")
    parser.add_argument("--check", action="store_true", help="não grava nada; mostra o que mudaria")
    parser.add_argument("--force", action="store_true",
                        help="repassa --force ao atualizar.py (aceita descartar anexos curados)")
    parser.add_argument("--sem-patches", action="store_true",
                        help="repassa --sem-patches ao atualizar.py")
    parser.add_argument("--sem-teste", action="store_true",
                        help="não roda scripts/test_dados.py no fim")
    args = parser.parse_args(argv)

    py = sys.executable or "python"
    falhas = []

    cmd = [py, os.path.join(SCRIPTS, "atualizar.py")]
    if args.portal:
        cmd.append(args.portal)
    if args.check:
        cmd.append("--check")
    if args.force:
        cmd.append("--force")
    if args.sem_patches:
        cmd.append("--sem-patches")
    if rodar("portal -> data/", cmd):
        falhas.append("atualizar.py")

    if args.anexo8:
        cmd = [py, os.path.join(SCRIPTS, "atualizar_anexo8.py")]
        if args.check:
            cmd.append("--check")
        cmd.append(args.anexo8)
        if rodar("planilha -> data/anexo-viii.json", cmd):
            falhas.append("atualizar_anexo8.py")

    if args.descricoes is not None:
        cmd = [py, os.path.join(SCRIPTS, "atualizar_descricoes.py")]
        if args.check:
            cmd.append("--check")
        if args.descricoes:
            cmd.append(args.descricoes)
        if rodar("tipi-data.js -> data/ncm-descricoes.json", cmd):
            falhas.append("atualizar_descricoes.py")

    cmd = [py, os.path.join(SCRIPTS, "gerar_anexos.py")]
    if args.check:
        cmd.append("--check")
    if rodar("data/ -> data/anexos/", cmd):
        falhas.append("gerar_anexos.py")

    if not args.check and not args.sem_teste:
        if rodar("testes dos dados", [py, os.path.join(SCRIPTS, "test_dados.py")]):
            falhas.append("test_dados.py")

    print()
    if falhas:
        print(f"falhou: {', '.join(falhas)}", file=sys.stderr)
        return 1
    print("tudo certo" + (" (modo --check: nada foi gravado)" if args.check else "."))
    return 0


if __name__ == "__main__":
    sys.exit(main())
