# -*- coding: utf-8 -*-
"""Utilidades comuns dos scripts de atualização (entrada e saída).

Entrada: aceitar tanto o arquivo já salvo no disco quanto a URL oficial,
decodificar o que o navegador salvou (UTF-8 com ou sem BOM, ou Latin-1) e
falhar com uma mensagem útil em vez de um traceback.

Saída: gravar de forma atômica (nada de arquivo pela metade) e comparar o que
seria gravado com o que já está em disco, para o modo --check.

Uso:
    from _comum import ErroFonte, fim_de_uso, gravar, ler_fonte, mesmo_conteudo

    fim_de_uso()
    try:
        texto = ler_fonte(origem, "a página do portal")
    except ErroFonte as e:
        print(e, file=sys.stderr)
        return 1
"""
import os
import sys
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (compatible; cst-cclasstrib/atualizar)"
TIMEOUT = 60


class ErroFonte(Exception):
    """Falha esperada ao obter ou gravar os dados: vira mensagem para o usuário."""


def fim_de_uso():
    """Troca acentos por '?' em console legado, sem quebrar a execução."""
    for fluxo in (sys.stdout, sys.stderr):
        try:
            fluxo.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass


def e_url(texto):
    return str(texto).lower().startswith(("http://", "https://"))


def ler_fonte(origem, rotulo="a fonte"):
    """Devolve o texto de `origem`, que pode ser URL ou caminho de arquivo."""
    bruto = _baixar(origem, rotulo) if e_url(origem) else _ler_arquivo(origem, rotulo)
    return _decodificar(bruto, origem, rotulo)


def _baixar(url, rotulo):
    pedido = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(pedido, timeout=TIMEOUT) as resposta:
            return resposta.read()
    except urllib.error.HTTPError as e:
        raise ErroFonte(
            f"não consegui baixar {rotulo} ({url}): HTTP {e.code} {e.reason}.\n"
            "  Se o endereço mudou, salve a página no navegador e passe o arquivo."
        )
    except urllib.error.URLError as e:
        raise ErroFonte(
            f"não consegui baixar {rotulo} ({url}): {e.reason}.\n"
            "  Sem rede? Salve a fonte no navegador e passe o arquivo baixado."
        )
    except (TimeoutError, OSError) as e:
        raise ErroFonte(
            f"não consegui baixar {rotulo} ({url}): {e}.\n"
            "  Sem rede? Salve a fonte no navegador e passe o arquivo baixado."
        )


def _ler_arquivo(caminho, rotulo):
    if os.path.isdir(caminho):
        raise ErroFonte(f"'{caminho}' é uma pasta, não o arquivo de {rotulo}.")
    if not os.path.isfile(caminho):
        raise ErroFonte(
            f"não encontrei o arquivo '{caminho}' (procurando em {os.getcwd()}).\n"
            f"  Salve {rotulo} no navegador (Ctrl+S) e passe o caminho, ou passe a URL direto."
        )
    with open(caminho, "rb") as fh:
        return fh.read()


def _decodificar(bruto, origem, rotulo):
    for codificacao in ("utf-8-sig", "cp1252"):
        try:
            return bruto.decode(codificacao)
        except UnicodeDecodeError:
            continue
    raise ErroFonte(
        f"não consegui ler {rotulo} ({origem}): o arquivo não está em UTF-8 nem em Latin-1.\n"
        "  Salve de novo pelo navegador escolhendo codificação UTF-8."
    )


def gravar(caminho, texto):
    """Grava de forma atômica: nada de arquivo pela metade se algo falhar.

    Usa o fim de linha da plataforma, como os scripts originais: com
    core.autocrlf=true (padrão do Git no Windows), gravar em LF deixaria o
    arquivo igual no índice, mas marcado como modificado no working tree.
    """
    pasta = os.path.dirname(caminho)
    if pasta:
        os.makedirs(pasta, exist_ok=True)
    tmp = caminho + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        fh.write(texto)
    os.replace(tmp, caminho)


def mesmo_conteudo(caminho, texto):
    """True se `caminho` já tem exatamente esse texto (ignorando fim de linha)."""
    if not os.path.isfile(caminho):
        return False
    with open(caminho, encoding="utf-8") as fh:
        atual = fh.read()
    return atual.replace("\r\n", "\n") == texto.replace("\r\n", "\n")


def rel(caminho):
    return os.path.relpath(caminho, os.getcwd())
