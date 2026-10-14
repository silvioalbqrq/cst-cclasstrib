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

- **Busca NCM (janela 1)** por CST, cClassTrib, NCM (7+ dígitos) ou palavras da descrição do produto — ex. `200003`, `medicamento`, `07082000`, `feijão` (singular/plural).
- **Busca NBS e serviços (janela 2, lado a lado)** por NBS (9 dígitos), palavra do serviço, IndOp, cClassTrib ou item da LC 116 — ex. `1.1502.10.00`, `desinfecção`, `030101`, `200029`, `saúde` — com paginação e exportação CSV própria.
- NCM/NBS com 7+ dígitos lista os cClassTrib vinculados nos anexos, com badge de origem na linha (`07082000 · PERMITIDO`; VEDADO em destaque vermelho). NCM válido sem vínculo em nenhum anexo recebe a **regra geral** — CST `000` / cClassTrib `000001` ("Situações tributadas integralmente pelo IBS e CBS", LC 214/2025, art. 4º) — e a descrição do produto continua sendo exibida.
- Descrição do produto NCM exibida acima dos resultados e no badge (fonte: https://silvioalbqrq.github.io/consulta-ncm/, `data/ncm-descricoes.json`).
- **Duas visões**: agrupada por CST ou aberta por cClassTrib.
- **Filtros** por CST, descrição, indicadores do CST, cClassTrib, tipo de alíquota, tributação regular / crédito presumido / estorno e DF-e aplicáveis (operador E/OU).
- **Detalhe** por código: vigência, percentuais de redução, DF-e, regra IBS/CBS, link da legislação e itens de anexo (NCM/NBS, carregados sob demanda).
- **Anexo VIII** — correlação Item LC 116 → NBS → PS Onerosa / Adq. Exterior / IndOp / Local de incidência → cClassTrib: seção própria de consulta, matriz de regra de incidência → IndOp, caixa de correlações na busca de NBS (9 dígitos) e no detalhe do cClassTrib.
- **Navegação em listas longas** — sem nenhum critério ativo a página abriria os 18 CSTs de uma vez, então cada CST é um bloco que abre/fecha ao clique (recolhido só nesse estado inicial; com busca ou filtro, abre sozinho). Na visão aberta por cClassTrib e na janela NBS a lista é paginada de 100 em 100 com Anterior/Próxima.
- **Importação em lote de NCM** — cole uma lista de NCMs ou abra um arquivo CSV/TXT e receba a tabela cClassTrib de cada código: `NCM consultado · Descrição NCM · CST · cClassTrib · Descrição CClassTrib · Tipo alíq. · Redução · TR · CP · EC · DF-e · Anexos`. A tabela tem filtro próprio, ordenação por qualquer coluna, paginação, colunas que você escolhe/esconde/reordena e exportação em **CSV** ou **Excel (.xlsx)** — gerado no próprio navegador (OOXML/ZIP montado em JS, sem bibliotecas e sem enviar dado a servidor).
- **Preferências do lote no navegador** — ordem/visibilidade das colunas, linhas por página da lista em lote e escopo da exportação ficam no `localStorage`. Fora do lote, a URL guarda apenas a busca (`?q=`) e o cClassTrib aberto (`?cct=`).
- **Exportação** do resultado filtrado em CSV (abre no Excel) e JSON.

## Estrutura

```
cst-cclasstrib/
├── index.html                  # página única
├── assets/
│   ├── styles.css              # visual base (sem frameworks)
│   ├── corporativo.css         # tema institucional VMF (marinho + dourado)
│   └── app.js                  # filtros, visões, detalhe, exportação e NCM em lote (vanilla JS)
├── data/
│   ├── resumo.json             # dataset enxuto carregado pelo app (~300 KB)
│   ├── ncm-nbs.json            # índice reverso NCM/NBS → cClassTribs (carga sob demanda)
│   ├── ncm-descricoes.json     # descrições NCM hierárquicas (carga sob demanda)
│   ├── anexo-viii.json         # correlação NBS × IndOp × cClassTrib do Anexo VIII (carga sob demanda)
│   ├── anexos/                 # fragmentos por cClassTrib (Detalhe baixa só o fragmento, em KB)
│   └── classificacao-tributaria.json  # snapshot completo, inclui anexos NCM/NBS (fallback do Detalhe)
└── scripts/
    ├── atualizar.py            # regenera os JSONs do portal (URL ou página salva), com os patches
    ├── atualizar_anexo8.py     # regenera anexo-viii.json a partir da planilha do Anexo VIII
    ├── atualizar_descricoes.py # regenera ncm-descricoes.json a partir do tipi-data.js
    ├── atualizar_tudo.py       # encadeia a atualização inteira e roda os testes
    ├── gerar_anexos.py         # fatia os anexos por cClassTrib em data/anexos/
    ├── patches.json            # anexos curados à mão que a fonte oficial não traz
    ├── test_dados.py           # regressão: contagens, cruzamentos, fragmentos, patches, ASSET_V
    └── test_lote.mjs           # regressão: importação em lote de NCM → CSV/Excel
```

## Atualizar os dados

A página oficial embute o dataset completo em JavaScript (`var dadosOriginais`), então a atualização é determinística. Um comando faz o serviço:

```bash
python scripts/atualizar_tudo.py
```

O que ele encadeia:

1. `scripts/atualizar.py` — baixa a URL oficial (ou usa uma página salva) e grava `data/classificacao-tributaria.json`, `data/resumo.json` e `data/ncm-nbs.json`;
2. `scripts/gerar_anexos.py` — fatia os anexos em `data/anexos/<cClassTrib>.json`;
3. `scripts/test_dados.py` — confere contagens e cruzamentos.

Antes de commitar, `--check` mostra o que mudaria **sem gravar nada**:

```bash
python scripts/atualizar_tudo.py --check
```

O `atualizar.py` aceita a URL oficial ou um arquivo salvo no navegador (salve como "página completa", não "somente HTML"):

```bash
python scripts/atualizar.py              # baixa a URL oficial
python scripts/atualizar.py portal.html  # usa a página salva (portal.html é ignorado pelo Git)
python scripts/atualizar.py --check      # não grava: mostra o que mudaria
```

As outras duas fontes mudam em ritmo próprio, por isso ficam atrás de uma opção:

```bash
# Anexo VIII — planilha .xlsx (a versão sai do nome do arquivo, ex. V1.01.00)
python scripts/atualizar_tudo.py --anexo8 "AnexoVIII-CorrelacaoItemNBSIndOpCClassTrib_IBSCBS_V1.01.00.xlsx"

# Descrições NCM — tipi-data.js (baixa https://silvioalbqrq.github.io/consulta-ncm/tipi-data.js)
python scripts/atualizar_tudo.py --descricoes
```

Cada script pode ser rodado sozinho (todos aceitam `--check`, e os de fonte aceitam URL ou arquivo local).

### Curadoria: `scripts/patches.json`

`data/classificacao-tributaria.json` **não é cópia fiel do portal**: ele traz anexos curados à mão que a fonte oficial não tem — hoje 384, em três cClassTrib (medicamentos do Anexo XIV revogado em `200032` e a Frutose `1702.50.00` em `200011`/`200033`). Esses anexos vivem em `scripts/patches.json` e o `atualizar.py` os reaplica a cada regeração.

- Se a fonte (portal + patches) ficar **mais pobre** que o arquivo atual, o script **não grava nada** e lista o que seria perdido, cClassTrib por cClassTrib. Use `--force` só quando a perda for intencional.
- Se `--sem-patches` for usado, a curadoria não é aplicada (e o `test_dados.py` acusa).
- Entradas que a fonte já traga são ignoradas, e o script avisa quando um patch virou obsoleto.
- O `rotulo` de cada patch vira o campo `Curadoria` dos anexos gerados: a tela mostra esse rótulo como selo (busca por NCM, detalhe do cClassTrib e lista em lote), com a explicação no tooltip, para o vínculo não passar por dado oficial. Como a marca nasce do patch, ela **desaparece sozinha** quando a fonte passar a trazer o item. Hoje: `Anexo XIV revogado` no `200032` (o cClassTrib segue valendo pelo art. 133, agora por descrição) e `ausente no IT v1.70` no `200011`/`200033`.
- **Mexeu no snapshot à mão? Registre o anexo em `scripts/patches.json`** (com `motivo` e `referencia`), senão a próxima atualização descarta a mudança. O `test_dados.py` falha se algum anexo curado sumir do snapshot.
- **Medicamentos (NCM do capítulo 30)** saem com uma **ressalva do art. 146**: a alíquota pode ser reduzida a zero conforme a *destinação* (doenças raras, negligenciadas, oncologia, diabetes, HIV/aids e outras IST, cardiovasculares, Farmácia Popular), o *adquirente* (órgão público ou entidade imune com Cebas) ou a *natureza* (soros e vacinas). O site **não sugere cClassTrib** nesse caso — o critério é a lista do art. 146, § 3º, não o NCM. Essa lista é divulgada a cada 120 dias pelo Ministério da Fazenda e pelo CGIBS e ainda não foi publicada: quando sair, trazê-la para a base e o enquadramento em alíquota zero passa a ser verificável por produto.

Anexo VIII — correlação NBS × IndOp × cClassTrib (planilha do Anexo VIII, V1.01.00):

```bash
python scripts/atualizar_anexo8.py "AnexoVIII-CorrelacaoItemNBSIndOpCClassTrib_IBSCBS_V1.01.00.xlsx"
# A versão sai do nome do arquivo; --versao V1.02.00 força outra.
# --gerado-em preserva a data já publicada (a do rodapé do site) quando não informado.
```

Notas do Anexo VIII:
- `99.01.01` (“Outros serviços sem incidência de ISSQN/ICMS”) vem na planilha sem NBS/IndOp/cClassTrib e é descartado pelo script — por isso 207 itens com correlação em 208 grupos da aba.
- 15 correlações têm NBS vazio na própria planilha (ex. `07.13` pulverização → `200038`, `99.03.0x` imóveis → `200027`): alcançáveis só por descrição/IndOp, nunca por dígito NBS.
- `regraIndOp` (aba `REGRA inc. X`) é a matriz PS Onerosa × Adq. Exterior → IndOp exibida em “Regra de incidência → IndOp”; linhas sem IndOp (ex. N/S) são mantidas como lista vazia.
- Hierarquia de nomes: em divergência entre Portal (IT 1.70) e planilha (v1.01.00), prevalece o Portal — a UI avisa no detalhe. Divergências conhecidas: `200039`, `200042`, `200044`, `820001`, `820002` (ver `DIVERGENCIAS_CONHECIDAS` em `scripts/test_dados.py`).
- Detalhe baixa `data/anexos/<cod>.json` (KB, gerado por `scripts/gerar_anexos.py`); o snapshot completo só é usado como fallback.

Testes:

```bash
python scripts/test_dados.py     # datasets: contagens, cruzamentos, fragmentos, patches, ASSET_V
node scripts/test_lote.mjs       # importação em lote: leitura, resolução, CSV e .xlsx
# CI (.github/workflows/ci.yml): node --check assets/app.js + os dois testes acima
```

Snapshot atual: **07/10/2026 (IT 2025.002 v1.70)** — 18 CSTs, 173 cClassTrib. Anexo VIII **V1.01.00 (08/10/2026)** — 1517 correlações, 731 NBS, 28 cClassTrib.

## Importação em lote de NCM

Painel no fim da página (aberto por padrão). Aceita lista colada ou arquivo `.csv`/`.txt`/`.tsv`.

Regras de leitura (tudo no navegador, nada é enviado a servidor):

- **Coluna explícita**: se a primeira linha tiver um cabeçalho `NCM` (ou `NCM consultado`, `Código NCM`, `Cod NCM`), o delimitador (`;`, TAB, `,` ou `|`) é detectado e só aquela coluna é lida — as demais colunas numéricas do arquivo são ignoradas.
- **Sem cabeçalho**: os códigos são extraídos do próprio texto. Se existir algum código de 7+ dígitos, só os de 7+ dígitos entram (evita capturar quantidade, valor, data); se não houver nenhum, prefixos de 4–8 dígitos valem (ex.: `0901` → todos os NCM do capítulo).
- Códigos repetidos contam uma vez; a ordem da lista é preservada. Tetos: 5.000 NCMs por importação e 20.000 linhas na saída.
- NCM com vínculo nos anexos rende **uma linha por cClassTrib**; NCM válido sem vínculo rende **uma linha da regra geral** (CST `000` · cClassTrib `000001`, selo "regra geral" ao lado do NCM e nota na **Descrição NCM**); código desconhecido entra só com o código.
- A coluna **Descrição NCM** traz a descrição do produto do próprio NCM (hierárquica, de `data/ncm-descricoes.json`) e é independente da **Descrição CClassTrib**. A coluna **Anexos** é a mesma contagem `qtdAnexos` da tabela principal. A permissão do vínculo (`PERMITIDO`/`VEDADO`) aparece como selo ao lado do NCM na tela, mas não faz parte das colunas exportadas.
- A coluna **Redução** sai com o imposto explícito — `CBS 60% · IBS 60%` — e `—` quando não há redução. Na tabela da janela 1 a leitura é a inversa (`IBS … · CBS …`), como sempre foi.

Exportação: **CSV** (`;` + BOM UTF-8, abre no Excel) e **Excel .xlsx** — planilha OOXML montada em JS (header congelado e em negrito, `CST`/`cClassTrib` como texto para preservar zeros à esquerda, `Anexos` numérico). Sem bibliotecas externas; usa `CompressionStream` quando o navegador tem, senão ZIP sem compressão.

Colunas da lista, na ordem padrão: `NCM consultado · Descrição NCM · CST · cClassTrib · Descrição CClassTrib · Tipo alíq. · Redução · TR · CP · EC · DF-e · Anexos`.

Depois de importar, a lista tem:

- **Filtro dentro do resultado** — busca textual sobre o que já foi resolvido (ex.: `vedado`, `200003`, `medicamento`), sem reimportar nada.
- **Ordenação** — clique no cabeçalho para ordenar por qualquer coluna (crescente/decrescente); `Anexos` ordena como número, o resto como texto em pt-BR.
- **Colunas** (`Colunas (N/12)`) — desmarque para esconder, arraste pelo ⠿ ou use ▲▼ para reordenar. A escolha vale para a tela **e** para os arquivos exportados, e fica guardada no navegador (coluna nova de uma versão futura entra na posição padrão dela, não no fim).
- **Paginação** — 25/50/100/200 linhas por página, com "mostrando X–Y de N" e página atual.
- **Escopo da exportação** — `tudo (com o filtro aplicado)` ou `só a página atual`; o arquivo sai com as colunas visíveis, na ordem escolhida.

## Navegação

A consulta individual mantém o visual original; o que entrou foi só o essencial para listas longas.

- **Blocos por CST**: na visão agrupada, cada CST é um bloco que abre/fecha no clique. Ficam recolhidos apenas quando não há nenhum critério ativo (o estado inicial, que antes despejava os 18 CSTs na tela); com busca, CST escolhido ou filtro marcado, já vêm abertos. Não há barra de "expandir/recolher todos".
- **Paginação simples**: na visão aberta por cClassTrib e na janela NBS a lista sai de 100 em 100, com `← Anterior · Página X de Y · mostrando A–B de N · Próxima →`. O Anexo VIII continua renderizando apenas a página visível e, sem filtro, não renderiza nada.
- Fora do lote, a URL guarda só `?q=` (busca) e `?cct=` (cClassTrib aberto no detalhe).
- `TR`, `CP`, `EC`, `DF-e` e `Anexos` seguem abreviados com `title` (tooltip) nas tabelas — a legenda por extenso existe apenas no painel do lote.

## Aviso

Consulta **não oficial**, sem vínculo com SEFAZ/Receita Federal. Para fins fiscais, confirme sempre no portal oficial.
