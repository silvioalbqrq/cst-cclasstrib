# Consulta CST × cClassTrib (IBS/CBS)

Site estático de consulta aos **Códigos de Situação Tributária (CST)** e **Códigos de Classificação Tributária (cClassTrib)** do IBS/CBS, espelhando a página oficial do Portal da Conformidade Fácil (SEFAZ-RS).

Fonte oficial: <https://dfe-portal.svrs.rs.gov.br/CFF/ClassificacaoTributaria>

## Uso online (GitHub Pages)

1. Suba este repositório para o GitHub como `cst-cclasstrib`.
2. Em **Settings → Pages**, selecione **Deploy from a branch**, branch `main`, pasta `/ (root)`.
3. Acesse `https://<seu-usuario>.github.io/cst-cclasstrib/`.

## Uso local

Arquivos estáticos não funcionam bem via `file://` (o `fetch` do JSON é bloqueado). Sirva por HTTP:

```bash
cd cst-cclasstrib
python -m http.server 8000
# abrir http://localhost:8000
```

## Funcionalidades

- **Busca rápida** por código ou palavra (com tolerância a acentos): ex. `200003`, `medicamento`, `ZFM`.
- **Busca reversa por NCM/NBS** (aba "Por NCM / NBS"): digite o NCM (8 dígitos) ou NBS (9 dígitos) e veja **todos os cClassTrib + CST** que o referenciam nos anexos, com permissão (PERMITIDO/VEDADO) e vigência. Código completo = exato; prefixo = lista.
- **Duas visões**: agrupada por CST ou aberta por cClassTrib.
- **Filtros** por CST, descrição, indicadores do CST, cClassTrib, tipo de alíquota, tributação regular / crédito presumido / estorno e DF-e aplicáveis (operador E/OU).
- **Detalhe** por código: vigência, percentuais de redução, DF-e, regra IBS/CBS, link da legislação e itens de anexo (NCM/NBS, carregados sob demanda).
- **Exportação** do resultado filtrado em CSV (abre no Excel) e JSON.

## Estrutura

```
cst-cclasstrib/
├── index.html                  # página única
├── assets/
│   ├── styles.css              # visual (sem frameworks)
│   └── app.js                  # filtros, visões, detalhe, exportação (vanilla JS)
├── data/
│   ├── resumo.json             # dataset enxuto carregado pelo app (~300 KB)
│   ├── ncm-nbs.json            # índice reverso NCM/NBS → cClassTribs (carga sob demanda)
│   └── classificacao-tributaria.json  # snapshot completo, inclui anexos NCM/NBS
└── scripts/
    └── atualizar.py            # regenera os JSONs a partir da página oficial salva
```

## Atualizar os dados

A página oficial embute o dataset completo em JavaScript (`var dadosOriginais`), então a atualização é determinística:

```bash
# 1. Abra a URL oficial no navegador e salve a página completa como portal.html
# 2. Rode:
python scripts/atualizar.py portal.html
# 3. Confira e commite data/resumo.json + data/classificacao-tributaria.json
```

Snapshot atual: **26/09/2026** — 18 CSTs, 164 cClassTrib.

## Aviso

Consulta **não oficial**, sem vínculo com SEFAZ/Receita Federal. Para fins fiscais, confirme sempre no portal oficial.
