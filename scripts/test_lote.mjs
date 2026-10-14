/* Teste de regressão da importação de NCM em lote e da navegação da página.
 *
 * Roda as funções reais de assets/app.js num contexto vm com DOM mínimo,
 * sobre os datasets de data/, e confere leitura da entrada, resolução contra
 * o índice, filtro/ordenação/colunas/paginação da lista em lote, CSV, a
 * planilha .xlsx (ZIP/OOXML montada em JS) e os grupos recolhíveis das duas
 * janelas de resultado.
 *
 * Uso: node scripts/test_lote.mjs   (exit 1 se qualquer invariante quebrar)
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(REPO, "data");
const ler = (p) => JSON.parse(fs.readFileSync(path.join(DATA, p), "utf8"));

const falhas = [];
const ok = (nome, cond, extra = "") => {
  console.log(`${cond ? "OK  " : "FAIL"} ${nome}${extra ? "  " + extra : ""}`);
  if (!cond) falhas.push(nome);
};

/* ---------- contexto: app.js real, com DOM e download capturados ---------- */
const capturado = {};
const elFalso = () => ({
  value: "", innerHTML: "", textContent: "", disabled: false, hidden: false,
  style: {}, dataset: {}, open: true,
  appendChild() {}, addEventListener() {}, click() {}, remove() {}, focus() {},
  querySelectorAll: () => [], classList: { add() {}, remove() {} },
});
const doc = {
  addEventListener() {}, getElementById: (id) => (doc._els[id] ||= elFalso()),
  querySelector: () => elFalso(), querySelectorAll: () => [],
  createElement: () => elFalso(), body: { appendChild() {} },
  _els: {},
};

const ctx = {
  document: doc, console,
  URL: { createObjectURL: (b) => { capturado.blob = b; return "blob:teste"; }, revokeObjectURL() {} },
  setTimeout, clearTimeout, isFinite, TextEncoder, Blob, Response,
};
ctx.window = ctx;
if (typeof CompressionStream !== "undefined") ctx.CompressionStream = CompressionStream;

const ganchos = `
;globalThis.__api = {
  // núcleo
  extrairNcms, extrairNcmsCache, montarLote, dividirLinha, casarCodigo, detalheNcm,
  LOTE_COLS, LOTE_IDS, colsVisiveis, linhasLoteVisiveis, linhasLoteFiltradas,
  totalPaginas, paginaValida, barraPaginacao, temFiltro,
  // render + exportação
  renderLote, render, renderAnexo8, exportarLoteCSV, exportarLoteXLSX,
  applyFilters, montarAnexo8: (a) => { ANEXO8 = a; },
  getPagina8: () => pagina8, setPagina8: (v) => { pagina8 = v; },
  // estado (para dirigir os cenários)
  getLote: () => LOTE, getIdx: () => IDX, getDados: () => DATA,
  el: (id) => document.getElementById(id),
  setDados: (idx, data, desc) => {
    IDX = idx; DATA = data; NCM_DESC = desc; IDX_KEYS = null;
    MAP_CCT.clear();
    for (const p of DATA) for (const f of p.ClassificacoesTributarias) MAP_CCT.set(f.CodClassTrib, { pai: p, filho: f });
  },
  setEstadoLote: (o) => {
    if (o.tam !== undefined) loteTam = o.tam;
    if (o.filtro !== undefined) loteFiltro = o.filtro;
    if (o.ordem !== undefined) loteOrdem = o.ordem;
    if (o.ocultas !== undefined) loteOcultas = o.ocultas;
    if (o.colunas !== undefined) loteColunas = o.colunas;
    if (o.pagina !== undefined) lotePagina = o.pagina;
    if (o.paginaCst !== undefined) paginaCst = o.paginaCst;
  },
};`;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(REPO, "assets", "app.js"), "utf8") + ganchos, ctx);

const api = ctx.__api;
api.setDados(ler("ncm-nbs.json"), ler("resumo.json"), ler("ncm-descricoes.json"));
api.montarAnexo8(ler("anexo-viii.json"));
const rotulosPadrao = api.LOTE_COLS.map((c) => c.rotulo);

/* ---------- 1. leitura da entrada ---------- */
const entradas = [
  ["texto, uma por linha", "07082000\n10062010\n30049099", ["07082000", "10062010", "30049099"]],
  ["separado por vírgula/ponto e vírgula", "07082000, 10062010;30049099", ["07082000", "10062010", "30049099"]],
  ["NCM pontuado (0708.20.00)", "0708.20.00", ["07082000"]],
  ["repetidos contam uma vez", "07082000\n07082000", ["07082000"]],
  ["CSV com cabeçalho NCM (;)", "NCM;Descrição\n07082000;Café\n10062010;Arroz", ["07082000", "10062010"]],
  ["CSV com cabeçalho (,) ", "NCM,Produto\n07082000,Café", ["07082000"]],
  ["CSV com cabeçalho (TAB)", "NCM\tProduto\n07082000\tCafé", ["07082000"]],
  ["CSV com cabeçalho acentuado", "Código NCM;Descrição\n07082000;Café", ["07082000"]],
  ["CSV ignora outras colunas numéricas", "NCM;Qtd;Preço\n07082000;12;19.9\n10062010;3;7", ["07082000", "10062010"]],
  ["CSV sem cabeçalho", "07082000;2\n10062010;5", ["07082000", "10062010"]],
  ["CSV com aspas e ';' dentro do campo", 'NCM;"Descrição; longa"\n07082000;"Café; torrado"', ["07082000"]],
  ["CSV com coluna NCM fora da primeira posição", "Produto;NCM\nCafé;07082000", ["07082000"]],
  ["prefixos de 4 dígitos (sem código completo)", "0901\n0902", ["0901", "0902"]],
  ["havendo código completo, ignora número solto", "0901;quantidade 3\n07082000", ["07082000"]],
  ["texto corrido", "consultar NCM 07082000 e 10062010, volume 250", ["07082000", "10062010"]],
  ["vazio", "   \n\t ", []],
  ["sem dígito algum", "café, arroz e feijão", []],
];
for (const [nome, entrada, esperado] of entradas) {
  const obtido = api.extrairNcms(entrada);
  ok(`leitura: ${nome}`, JSON.stringify(obtido) === JSON.stringify(esperado), `→ ${JSON.stringify(obtido)}`);
}

/* ---------- 2. resolução contra o índice reverso ---------- */
api.montarLote(api.extrairNcms("07082000\n99999999"));
const L = api.getLote();
const doCafe = L.linhas.filter((l) => l.ncm === "07082000");
const esperadoCafe = api.getIdx().codes["07082000"].ref.map((r) => r[1]);
ok("resolução: uma linha por vínculo do índice",
  JSON.stringify(doCafe.map((l) => l.cod)) === JSON.stringify(esperadoCafe),
  `${doCafe.map((l) => l.cod).join(",")} x ${esperadoCafe.join(",")}`);
ok("resolução: linha traz CST, descrição, tipo, redução, TR/CP/EC e DF-e",
  doCafe.every((l) => l.cst && l.desc && l.tipo && l.red && l.tr && l.cp && l.ec && l.dfe),
  JSON.stringify(doCafe[0] || {}));
ok("resolução: anexos é a contagem qtdAnexos", doCafe.every((l) => Number.isInteger(l.anexos) && l.anexos >= 0));
ok("resolução: código desconhecido entra como uma linha só",
  L.linhas.filter((l) => l.ncm === "99999999").length === 1 && L.naoEncontrado === 1);

api.montarLote(api.extrairNcms("01012100"));
const semVinculo = api.getLote().linhas.find((l) => l.regra);
ok("resolução: NCM válido sem vínculo entra pela regra geral 000/000001",
  !!semVinculo && semVinculo.ncm === "01012100" && semVinculo.cst === "000" &&
  semVinculo.cod === "000001" && !!semVinculo.desc,
  semVinculo ? `${semVinculo.cst}/${semVinculo.cod} ${semVinculo.desc.slice(0, 40)}` : "nenhum");
ok("resolução: regra geral traz tipo/redução/TR/CP/EC e segue uma linha por NCM",
  !!semVinculo && !!semVinculo.tipo && !!semVinculo.red && !!semVinculo.tr &&
  semVinculo.ec && api.getLote().linhas.filter((l) => l.regra).length === 1);
ok("resolução: regra geral é o único CST 000 sem anexo aplicado por ausência de vínculo",
  api.getLote().semVinculo === 1 && api.getLote().naoEncontrado === 0,
  `${api.getLote().semVinculo} sem vínculo, ${api.getLote().naoEncontrado} desconhecido`);

api.montarLote(api.extrairNcms("0901"));
ok("resolução: prefixo expande para vários NCM", new Set(api.getLote().linhas.map((l) => l.ncm)).size > 1);

/* ---------- 2b. curadoria: vínculo que não está na lista oficial ---------- */
// 30049069 é medicamento: linka 200032 (curadoria do Anexo XIV revogado) e
// 200038 (oficial). Só o primeiro pode sair marcado.
api.montarLote(api.extrairNcms("30049069"));
const curadas = api.getLote().linhas.filter((l) => l.curadoria);
ok("curadoria: vínculo do patches.json sai marcado no lote",
  curadas.length > 0 && curadas.some((l) => l.cod === "200032" && /Anexo XIV revogado/.test(l.curadoria)),
  curadas.length ? `${curadas.length} linha(s) · ${curadas[0].curadoria}` : "nenhuma marca");
api.montarLote(api.extrairNcms("07082000"));
ok("curadoria: vínculo oficial não leva a marca",
  api.getLote().linhas.length > 0 && api.getLote().linhas.every((l) => !l.curadoria));

// A consulta por CÓDIGO na janela 1 tem caminho próprio (detalheNcm), separado
// do lote: a marca precisa sobreviver aos dois.
const mapaCod = api.detalheNcm("30049069");
ok("curadoria: consulta por código na janela 1 mantém a marca",
  !!mapaCod["200032"] && /Anexo XIV revogado/.test(mapaCod["200032"][0].curadoria),
  JSON.stringify(mapaCod["200032"] || null));
const mapaOficial = api.detalheNcm("07082000");
ok("curadoria: consulta por código de vínculo oficial não marca",
  Object.values(mapaOficial).length > 0 &&
  Object.values(mapaOficial).every((arr) => arr.every((x) => !x.curadoria)));

/* ---------- 3. filtro, ordenação, colunas e paginação da lista ---------- */
const reais = Object.keys(api.getIdx().codes).filter((c) => c.length === 8).slice(0, 900);
api.montarLote(api.extrairNcms(reais.join("\n")));
const total = api.getLote().linhas.length;
console.log(`     lista: ${reais.length} NCMs → ${total} linhas`);

api.setEstadoLote({ tam: 50, filtro: "", ordem: { col: "", dir: "asc" }, ocultas: [], colunas: api.LOTE_IDS.slice(), pagina: 0 });
ok("paginação: 50/20000 → 400 páginas", api.totalPaginas(20000, 50) === 400);
ok("paginação: página fora do intervalo é limitada", api.paginaValida(999, 120, 50) === 2);
ok("paginação: barra some quando cabe numa página", api.barraPaginacao("x", 20, 0, 50, "") === "");
ok("paginação: barra traz seletor de linhas", api.barraPaginacao("x", 120, 0, 50, "").includes("Linhas por página"));

const semOrdem = api.linhasLoteVisiveis();
ok("ordenação: sem coluna escolhida preserva a ordem de importação",
  semOrdem[0].ncm === api.getLote().linhas[0].ncm);

api.setEstadoLote({ ordem: { col: "anexos", dir: "asc" } });
const asc = api.linhasLoteVisiveis().map((l) => (l.anexos === "" ? -1 : l.anexos));
ok("ordenação: crescente por Anexos", asc.every((v, i) => i === 0 || asc[i - 1] <= v), `${asc[0]} … ${asc[asc.length - 1]}`);
api.setEstadoLote({ ordem: { col: "anexos", dir: "desc" } });
const desc = api.linhasLoteVisiveis().map((l) => (l.anexos === "" ? -1 : l.anexos));
ok("ordenação: decrescente por Anexos", desc.every((v, i) => i === 0 || desc[i - 1] >= v), `${desc[0]} … ${desc[desc.length - 1]}`);
api.setEstadoLote({ ordem: { col: "ncm", dir: "asc" } });
const porNcm = api.linhasLoteVisiveis().map((l) => l.ncm);
ok("ordenação: por NCM", porNcm.every((v, i) => i === 0 || porNcm[i - 1] <= v));

api.setEstadoLote({ ordem: { col: "", dir: "asc" }, filtro: "vedado" });
const vedados = api.linhasLoteFiltradas();
ok("filtro: \"vedado\" reduz a lista", vedados.length > 0 && vedados.length < total, `${vedados.length} de ${total}`);
ok("filtro: só linhas vedadas", vedados.every((l) => l.perm === "VEDADO"));
api.setEstadoLote({ filtro: "200003" });
const porCct = api.linhasLoteFiltradas();
ok("filtro: por cClassTrib", porCct.length > 0 && porCct.every((l) => l.cod === "200003"), `${porCct.length} linhas`);
api.setEstadoLote({ filtro: "zzzz" });
ok("filtro: sem correspondência devolve zero", api.linhasLoteFiltradas().length === 0);
api.setEstadoLote({ filtro: "" });

/* ---------- 4. CSV e planilha seguem as colunas visíveis ---------- */
api.montarLote(api.extrairNcms("07082000\n10062010\n30049099\n99999999"));
const linhasLote = api.getLote().linhas.length;
api.setEstadoLote({ tam: 50, ordem: { col: "", dir: "asc" }, ocultas: [], colunas: api.LOTE_IDS.slice(), pagina: 0 });
api.el("loteEscopo").value = "tudo";

api.exportarLoteCSV();
let csvBytes = Buffer.from(await capturado.blob.arrayBuffer());
let csv = csvBytes.toString("utf8");
let linhasCsv = csv.replace(/^\uFEFF/, "").split("\r\n");
ok("csv: BOM UTF-8", csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf);
ok("csv: cabeçalho das colunas pedidas", linhasCsv[0] === rotulosPadrao.join(";"), linhasCsv[0]);
ok("csv: cabeçalho na ordem pedida (Descrição NCM após o NCM)",
  linhasCsv[0].startsWith("NCM consultado;Descrição NCM;CST;cClassTrib;Descrição CClassTrib;"), linhasCsv[0]);
ok("csv: uma linha por vínculo", linhasCsv.length === linhasLote + 1, `${linhasCsv.length - 1} x ${linhasLote}`);
ok("csv: todas as linhas com todas as colunas",
  linhasCsv.every((l) => api.dividirLinha(l, ";").length === rotulosPadrao.length));
ok("csv: identificadores preservados como texto", linhasCsv.slice(1).every((l) => /^"?\d{8}"?;/.test(l)), linhasCsv[1]);
ok("csv: redução rotulada com CBS e IBS",
  linhasCsv.slice(1).every((l) => {
    const r = api.dividirLinha(l, ";")[rotulosPadrao.indexOf("Redução")];
    return r === "" || r === "—" || /^CBS .+ · IBS .+$/.test(r);
  }), api.dividirLinha(linhasCsv[1], ";")[rotulosPadrao.indexOf("Redução")]);
ok("csv: coluna Descrição NCM preenchida",
  linhasCsv.slice(1).some((l) => (api.dividirLinha(l, ";")[1] || "").length > 3));

// escondendo duas colunas e trocando a ordem
api.setEstadoLote({
  colunas: ["anexos", "ncm", "descNcm", "cst", "cod", "desc", "tipo", "red", "tr", "cp", "ec", "dfe"],
  ocultas: ["tr", "ec"],
});
const visiveis = api.colsVisiveis().map((c) => c.rotulo);
const nVisiveis = api.LOTE_IDS.length - 2;
ok(`colunas: ${nVisiveis} visíveis após ocultar TR e EC`, visiveis.length === nVisiveis && !visiveis.includes("TR"));
api.exportarLoteCSV();
csv = Buffer.from(await capturado.blob.arrayBuffer()).toString("utf8");
linhasCsv = csv.replace(/^\uFEFF/, "").split("\r\n");
const colsCsv = api.dividirLinha(linhasCsv[0], ";");
ok("csv: cabeçalho segue a ordem escolhida", colsCsv[0] === "Anexos" && colsCsv[1] === "NCM consultado", linhasCsv[0]);
ok("csv: colunas ocultas fora do arquivo", colsCsv.length === nVisiveis && !colsCsv.includes("TR") && !colsCsv.includes("EC"));
ok("csv: todas as linhas com as colunas visíveis",
  linhasCsv.every((l) => api.dividirLinha(l, ";").length === nVisiveis));

api.renderLote();
ok("tela: tabela mostra só as colunas visíveis",
  (api.el("loteResultados").innerHTML.match(/<th /g) || []).length === nVisiveis,
  `${(api.el("loteResultados").innerHTML.match(/<th /g) || []).length} th`);

// escopo "página atual"
api.setEstadoLote({ colunas: api.LOTE_IDS.slice(), ocultas: [], tam: 5, pagina: 1 });
api.el("loteEscopo").value = "pagina";
api.exportarLoteCSV();
linhasCsv = Buffer.from(await capturado.blob.arrayBuffer()).toString("utf8").replace(/^\uFEFF/, "").split("\r\n");
ok("csv: escopo \"página atual\" exporta só a página", linhasCsv.length === 6, `${linhasCsv.length - 1} linhas`);
api.el("loteEscopo").value = "tudo";
api.exportarLoteCSV();
linhasCsv = Buffer.from(await capturado.blob.arrayBuffer()).toString("utf8").replace(/^\uFEFF/, "").split("\r\n");
ok("csv: escopo \"tudo\" exporta a lista inteira", linhasCsv.length === linhasLote + 1, `${linhasCsv.length - 1} linhas`);

// páginas (com a lista grande de volta)
api.montarLote(api.extrairNcms(reais.join("\n")));
api.setEstadoLote({ tam: 50, pagina: 0, ocultas: [], colunas: api.LOTE_IDS.slice(), filtro: "", ordem: { col: "", dir: "asc" } });
api.renderLote();
const html1 = api.el("loteResultados").innerHTML;
api.setEstadoLote({ pagina: 1 });
api.renderLote();
const html2 = api.el("loteResultados").innerHTML;
ok("paginação: página 1 mostra 50 linhas", (html1.match(/<tr>/g) || []).length === 51,
  `${(html1.match(/<tr>/g) || []).length - 1} linhas`);
ok("paginação: páginas trazem linhas diferentes", html1 !== html2);
ok("paginação: controle presente", html1.includes("Linhas por página") && html1.includes("Anterior"));
api.setEstadoLote({ pagina: 0 });

/* ---------- 5. planilha .xlsx (OOXML montado em JS) ---------- */
api.setEstadoLote({ tam: 50, pagina: 0, ocultas: [], colunas: api.LOTE_IDS.slice() });
api.montarLote(api.extrairNcms("07082000\n10062010\n30049099\n99999999"));
const totalPlanilha = api.getLote().linhas.length;
await api.exportarLoteXLSX();
const xlsx = Buffer.from(await capturado.blob.arrayBuffer());
ok("xlsx: assinatura ZIP (PK)", xlsx.subarray(0, 2).toString("ascii") === "PK");
ok("xlsx: content-type de planilha", capturado.blob.type.includes("spreadsheetml.sheet"));

function lerZip(buf) {
  const arq = {};
  let p = 0;
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const metodo = buf.readUInt16LE(p + 8);
    const tamComprimido = buf.readUInt32LE(p + 18);
    const tamNome = buf.readUInt16LE(p + 26);
    const tamExtra = buf.readUInt16LE(p + 28);
    const nome = buf.subarray(p + 30, p + 30 + tamNome).toString("utf8");
    const ini = p + 30 + tamNome + tamExtra;
    const dados = buf.subarray(ini, ini + tamComprimido);
    arq[nome] = metodo === 8 ? zlib.inflateRawSync(dados) : Buffer.from(dados);
    p = ini + tamComprimido;
  }
  return arq;
}

const partes = lerZip(xlsx);
const obrigatorios = ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml",
  "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"];
ok("xlsx: pacote OOXML completo", obrigatorios.every((n) => partes[n] && partes[n].length),
  `${Object.keys(partes).length} partes`);

const aba = partes["xl/worksheets/sheet1.xml"].toString("utf8");
ok("xlsx: uma linha por resultado + cabeçalho",
  (aba.match(/<row /g) || []).length === totalPlanilha + 1);
ok("xlsx: cabeçalho na planilha", aba.includes("NCM consultado") && aba.includes("cClassTrib") && aba.includes("Anexos"));
ok("xlsx: cabeçalho congelado", aba.includes('state="frozen"'));
ok("xlsx: sem valor inválido (NaN/undefined)", !/NaN|undefined/.test(aba));
ok("xlsx: identificadores como texto (inlineStr)",
  aba.includes('<c r="B2" t="inlineStr"') && aba.includes('<c r="D2" t="inlineStr"'));
// Anexos é a última coluna (12ª = L) e sai como número; B/C/E são texto.
const colAnexos = "L";
ok("xlsx: Anexos como número", new RegExp(`<c r="${colAnexos}2"><v>\\d+</v></c>`).test(aba),
  (aba.match(new RegExp(`<c r="${colAnexos}2".*?</c>`)) || [""])[0]);
ok("xlsx: nome da aba", partes["xl/workbook.xml"].toString("utf8").includes('name="NCM x cClassTrib"'));

// a planilha também respeita colunas ocultas e ordem
const colsXlsx = ["ncm", "descNcm", "cod", "desc", "anexos", "cst", "tipo", "red", "dfe"];
api.setEstadoLote({ ocultas: ["tr", "cp", "ec"], colunas: colsXlsx });
await api.exportarLoteXLSX();
const abaLimpa = lerZip(Buffer.from(await capturado.blob.arrayBuffer()))["xl/worksheets/sheet1.xml"].toString("utf8");
ok("xlsx: colunas ocultas fora da planilha", !abaLimpa.includes(">TR<") && !abaLimpa.includes(">CP<") && !abaLimpa.includes(">EC<"));
ok("xlsx: larguras seguem as colunas visíveis",
  (abaLimpa.match(/<col /g) || []).length === colsXlsx.length,
  `${(abaLimpa.match(/<col /g) || []).length} colunas`);
ok("xlsx: Descrição NCM presente", abaLimpa.includes("Descrição NCM") && abaLimpa.includes("Descrição CClassTrib"));
api.setEstadoLote({ ocultas: [], colunas: api.LOTE_IDS.slice() });

/* ---------- 6. planilha grande (limites e tempo) ---------- */
api.montarLote(api.extrairNcms(reais.join("\n")));
const linhasGrande = api.getLote().linhas.length;
const t0 = Date.now();
await api.exportarLoteXLSX();
const grande = Buffer.from(await capturado.blob.arrayBuffer());
const ms = Date.now() - t0;
const abag = lerZip(grande)["xl/worksheets/sheet1.xml"].toString("utf8");
ok("xlsx grande: todas as linhas exportadas",
  (abag.match(/<row /g) || []).length === linhasGrande + 1, `${linhasGrande} linhas em ${ms} ms`);
ok("xlsx grande: geração abaixo de 5 s", ms < 5000, `${ms} ms, ${(grande.length / 1024).toFixed(0)} KB`);

/* ---------- 7. janela 1: grupos recolhidos sem filtro ---------- */
const filtro = (o = {}) => ({
  q: "", view: "grupo", cst: "", nomeCst: "", paiInd: [], cod: "", nomeRed: "",
  tipoAliq: "", filhoFlags: [], dfes: [], op: "E", ...o,
});
const ehFiltro = (F) => api.temFiltro(F);
ok("filtro ativo: nada preenchido → false", ehFiltro(filtro()) === false);
ok("filtro ativo: busca preenchida → true", ehFiltro(filtro({ q: "medicamento" })) === true);
ok("filtro ativo: CST escolhido → true", ehFiltro(filtro({ cst: "200" })) === true);

api.render(api.applyFilters(api.getDados(), filtro()), filtro());
let html = api.el("resultados").innerHTML;
const grupos = (html.match(/<details class="grupo"/g) || []).length;
ok("janela 1 sem filtro: um grupo por CST (18)", grupos === 18, `${grupos} grupos`);
ok("janela 1 sem filtro: nenhum grupo aberto", !html.includes('<details class="grupo" open>'));
ok("janela 1 sem filtro: sem barra de expandir/recolher", !html.includes("Expandir todos"));
ok("janela 1: sem legenda acima da tabela (visual original)", !html.includes("TR = tributação regular"));
ok("janela 1: cabeçalho do grupo no formato original",
  html.includes('<h2><code>000</code> — Tributação integral</h2>') && html.includes("Vigência:"));

let tudo = api.applyFilters(api.getDados(), filtro({ q: "200003" }));
api.render(tudo, filtro({ q: "200003" }));
html = api.el("resultados").innerHTML;
ok("janela 1 com filtro: grupo já vem aberto", html.includes('<details class="grupo" open>'), "");
ok("janela 1 com filtro: só o cClassTrib casado", (html.match(/data-detalhe="(\d+)"/g) || []).every((m) => m.includes("200003")));

/* curadoria: vínculo que veio de scripts/patches.json avisa na própria badge
   da tela principal (não só no Detalhe > Anexo) */
const fCura = filtro({ q: "30049069" });
api.render(api.applyFilters(api.getDados(), fCura), fCura);
html = api.el("resultados").innerHTML;
ok("tela: badge da janela 1 traz o aviso de curadoria",
  html.includes("via-ncm cura") && html.includes("Anexo XIV revogado"),
  (html.match(/class="via-ncm[^"]*"[^>]*>[^<]*/g) || []).slice(0, 4).join(" | "));

/* ressalva do art. 146: só para NCM de medicamento (capítulo 30), e sem
   sugerir cClassTrib — a lista do § 3º ainda não foi publicada */
ok("tela: NCM de medicamento traz a ressalva do art. 146",
  html.includes("aviso-art146") && html.includes("art. 146, § 3º"));
const bloco146 = (html.match(/<p class="aviso-art146">[\s\S]*?<\/p>/) || [""])[0];
ok("tela: ressalva do art. 146 não sugere cClassTrib",
  bloco146.length > 0 && !/\b\d{6}\b/.test(bloco146),
  bloco146 ? bloco146.slice(0, 70) : "bloco não encontrado");
const fHort = filtro({ q: "07082000" });
api.render(api.applyFilters(api.getDados(), fHort), fHort);
ok("tela: NCM fora do capítulo 30 não traz a ressalva do art. 146",
  !api.el("resultados").innerHTML.includes("aviso-art146"));

/* regra geral: NCM localizado sem vínculo em anexo vira CST 000 / 000001 */
const semVinculoF = filtro({ q: "01012100" });
const rSemVinculo = api.applyFilters(api.getDados(), semVinculoF);
const filhosSem = rSemVinculo.flatMap((g) => g.filhos);
ok("janela 1 regra geral: NCM sem vínculo devolve resultado em vez de lista vazia",
  rSemVinculo.regraGeral === true && filhosSem.length === 1 &&
  filhosSem[0].Cst === "000" && filhosSem[0].CodClassTrib === "000001",
  filhosSem.map((f) => `${f.Cst}/${f.CodClassTrib}`).join(",") || "nenhum");
api.render(rSemVinculo, semVinculoF);
html = api.el("resultados").innerHTML;
ok("janela 1 regra geral: aviso da regra geral e linha do 000001 na tela",
  html.includes("regra geral") && html.includes('data-detalhe="000001"') &&
  html.includes("LC 214/2025, art. 4º"));
ok("janela 1 regra geral: badge marca o NCM de origem",
  html.includes("01012100 · regra geral"));

const comVinculoF = filtro({ q: "07082000" });
const rComVinculo = api.applyFilters(api.getDados(), comVinculoF);
ok("janela 1: NCM com vínculo não aciona a regra geral",
  rComVinculo.regraGeral === false &&
  !rComVinculo.flatMap((g) => g.filhos).some((f) => f.CodClassTrib === "000001"),
  `${rComVinculo.flatMap((g) => g.filhos).length} classificações`);

const desconhecidoF = filtro({ q: "99999999" });
ok("janela 1: código desconhecido não recebe regra geral",
  api.applyFilters(api.getDados(), desconhecidoF).regraGeral === false);

const filtradoF = filtro({ q: "01012100", cst: "200" });
const rFiltrado = api.applyFilters(api.getDados(), filtradoF);
api.render(rFiltrado, filtradoF);
html = api.el("resultados").innerHTML;
ok("janela 1 regra geral: filtro de CST contrário esconde a linha e explica o motivo",
  rFiltrado.regraGeral === true && rFiltrado.length === 0 &&
  html.includes("regra geral") && !html.includes('data-detalhe="000001"'));

ctx.__api.setEstadoLote({ paginaCst: 0 });
api.render(api.applyFilters(api.getDados(), filtro({ view: "lista" })), filtro({ view: "lista" }));
html = api.el("resultados").innerHTML;
ok("janela 1 visão lista: pagina em 100 linhas", (html.match(/<tr>/g) || []).length === 101,
  `${(html.match(/<tr>/g) || []).length - 1} linhas`);
ok("janela 1 visão lista: paginação simples (Anterior/Próxima)",
  html.includes("← Anterior") && html.includes("Página 1 de") && html.includes("Próxima →"));
ok("janela 1 visão lista: sem seletor de linhas por página", !html.includes("Linhas por página"));

/* ---------- 8. janela 2 (Anexo VIII): tabela paginada, como no original ---------- */
api.el("q8").value = "";
api.renderAnexo8();
html = api.el("resultados8").innerHTML;
ok("NBS sem busca: nada renderizado até filtrar", html.includes("Nada é renderizado até filtrar"));
ok("NBS sem busca: sem tabela", !html.includes("Nome cClassTrib"));

api.el("q8").value = "desinfecção";
api.renderAnexo8();
html = api.el("resultados8").innerHTML;
ok("NBS com busca: tabela única (sem agrupamento)", html.includes("Nome cClassTrib") && !html.includes("<details"));
ok("NBS com busca: colunas do Anexo VIII", html.includes("Item LC 116") && html.includes("Local de incidência IBS"));

api.el("q8").value = "serviço";
api.renderAnexo8();
html = api.el("resultados8").innerHTML;
const pag8 = ctx.__api.getPagina8();
ok("NBS: paginação simples de 100 em 100",
  (html.match(/<tr>/g) || []).length === 101 && html.includes("Página 1 de"),
  `${(html.match(/<tr>/g) || []).length - 1} linhas, pagina=${pag8}`);
ctx.__api.setPagina8(1);
api.renderAnexo8();
ok("NBS: segunda página traz outras linhas",
  (api.el("resultados8").innerHTML.match(/<tr>/g) || []).length === 101 &&
  api.el("resultados8").innerHTML.includes("Página 2 de"));
ctx.__api.setPagina8(0);
api.el("q8").value = "";

/* ---------- 9. layout: o painel não pode impor largura ao card ----------
 * Sem navegador aqui, a proteção é contratual: um item de grid/flex cujo
 * min-content é maior que o card empurra o body (foi o que aconteceu com
 * #loteTexto, #loteResultados e os botões de exportar). Estas regras são as
 * que impedem isso, e o teste falha se alguém removê-las. */
const css = fs.readFileSync(path.join(REPO, "assets", "styles.css"), "utf8");
const regra = (sel) => {
  const i = css.indexOf(sel);
  if (i < 0) return "";
  const abre = css.indexOf("{", i);
  const fecha = css.indexOf("}", abre);
  return css.slice(abre + 1, fecha).replace(/\s+/g, " ");
};
ok("css: coluna do painel do lote em minmax(0, 1fr)",
  /grid-template-columns:\s*minmax\(0,\s*1fr\)/.test(regra(".lote {")));
ok("css: itens do painel com min-width: 0", /min-width:\s*0/.test(regra(".lote > *")));
ok("css: textarea não passa do card",
  /max-width:\s*100%/.test(regra("#loteTexto {")) && /min-width:\s*0/.test(regra("#loteTexto {")));
ok("css: campos da barra encolhem (min-width: 0)", /min-width:\s*0/.test(regra(".lote-barra .campo {")));
ok("css: sem piso fixo de 230px no campo de busca", !/min-width:\s*230px/.test(css));
ok("css: botões de exportar podem quebrar linha", /flex-wrap:\s*wrap/.test(regra(".lote-barra .dir {")));
ok("css: painel de colunas abre para a esquerda (não empurra a página)",
  /right:\s*0/.test(regra(".lote-colunas-caixa {")));
ok("css: painel de colunas limitado pela viewport", /max-width:\s*min\(310px/.test(css));
ok("css: barra de paginação quebra linha", /flex-wrap:\s*wrap/.test(regra(".paginacao {")));
ok("css: duas janelas de busca sem piso de min-content",
  /minmax\(0,\s*1fr\)\s+minmax\(0,\s*1fr\)/.test(regra(".buscas-lado {")));

// classes das células da lista em lote (num = nowrap, como na tabela principal)
api.montarLote(api.extrairNcms("07082000"));
api.setEstadoLote({ pagina: 0, filtro: "", ocultas: [], colunas: api.LOTE_IDS.slice() });
api.renderLote();
const tabelaFinal = api.el("loteResultados").innerHTML;
ok("tela: Tipo alíq. e Redução sem quebra de linha", (tabelaFinal.match(/class="num"/g) || []).length >= 2);
ok("tela: DF-e com classe dfes", tabelaFinal.includes('class="dfes"'));
ok("tela: NCM/CST/cClassTrib com classe cod", (tabelaFinal.match(/class="cod"/g) || []).length >= 3);

console.log(falhas.length ? `\n${falhas.length} falha(s): ${falhas.join(", ")}` : "\nTudo certo.");
process.exit(falhas.length ? 1 : 0);
