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

- **Busca única** por tudo: CST, cClassTrib, palavra (com tolerância a acentos), NCM (8 dígitos)/NBS (9 dígitos) **ou palavras da descrição do produto** — ex. `200003`, `medicamento`, `07082000`, `feijão` (singular/plural).
- NCM/NBS com 7+ dígitos lista os cClassTrib vinculados nos anexos, com badge de origem na linha (`07082000 · PERMITIDO`; VEDADO em destaque vermelho). NCM válido sem vínculo exibe a descrição do produto mesmo assim.
- Descrição do produto NCM exibida acima dos resultados e no badge (fonte: https://silvioalbqrq.github.io/consulta-ncm/, `data/ncm-descricoes.json`).
- **Duas visões**: agrupada por CST ou aberta por cClassTrib.
- **Filtros** por CST, descrição, indicadores do CST, cClassTrib, tipo de alíquota, tributação regular / crédito presumido / estorno e DF-e aplicáveis (operador E/OU).
- **Detalhe** por código: vigência, percentuais de redução, DF-e, regra IBS/CBS, link da legislação e itens de anexo (NCM/NBS, carregados sob demanda).
- **Anexo VIII** — correlação Item LC 116 → NBS → PS Onerosa / Adq. Exterior / IndOp / Local de incidência → cClassTrib: seção própria de consulta, matriz de regra de incidência → IndOp, caixa de correlações na busca de NBS (9 dígitos) e no detalhe do cClassTrib.
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
│   ├── ncm-descricoes.json     # descrições NCM hierárquicas (carga sob demanda)
│   ├── anexo-viii.json         # correlação NBS × IndOp × cClassTrib do Anexo VIII (carga sob demanda)
│   └── classificacao-tributaria.json  # snapshot completo, inclui anexos NCM/NBS
└── scripts/
    ├── atualizar.py            # regenera os JSONs a partir da página oficial salva
    ├── atualizar_descricoes.py # regenera ncm-descricoes.json a partir do tipi-data.js
    └── atualizar_anexo8.py     # regenera anexo-viii.json a partir da planilha do Anexo VIII
```

## Atualizar os dados

A página oficial embute o dataset completo em JavaScript (`var dadosOriginais`), então a atualização é determinística:

```bash
# 1. Abra a URL oficial no navegador e salve a página completa como portal.html
# 2. Rode:
python scripts/atualizar.py portal.html
# 3. Confira e commite data/resumo.json + data/classificacao-tributaria.json
```

Descrições NCM (fonte: https://silvioalbqrq.github.io/consulta-ncm/tipi-data.js):

```bash
# 1. Baixe o tipi-data.js do site consulta-ncm
# 2. Rode:
python scripts/atualizar_descricoes.py tipi-data.js
# 3. Confira e commite data/ncm-descricoes.json
```

Anexo VIII — correlação NBS × IndOp × cClassTrib (planilha do Anexo VIII, V1.00.00):

```bash
# 1. Salve a planilha do Anexo VIII (.xlsx)
# 2. Rode:
python scripts/atualizar_anexo8.py "AnexoVIII-CorrelacaoItemNBSIndOpCClassTrib_IBSCBS_V1.00.00.xlsx"
# 3. Confira e commite data/anexo-viii.json
```

Snapshot atual: **07/10/2026 (IT 2025.002 v1.70)** — 18 CSTs, 173 cClassTrib.

## Aviso

Consulta **não oficial**, sem vínculo com SEFAZ/Receita Federal. Para fins fiscais, confirme sempre no portal oficial.
