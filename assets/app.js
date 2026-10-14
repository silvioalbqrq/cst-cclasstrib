/* Consulta CST x cClassTrib (IBS/CBS) — app 100% client-side. */
"use strict";

const DFES = [
  ["IndNfe", "NFe"], ["IndNfce", "NFCe"], ["IndCte", "CTe"],
  ["IndCteos", "CTe-OS"], ["IndBpe", "BPe"], ["IndBpeta", "BPe-TA"],
  ["IndBpetm", "BPe-TM"], ["IndNf3e", "NF3e"], ["IndNfcom", "NFCom"],
  ["IndNfse", "NFSe"], ["IndNfsvia", "NFSVia"], ["IndNfgas", "NFGAS"],
  ["IndNfabi", "NF-ABI"], ["IndNfag", "NFAg"], ["IndDere", "DERE"],
  ["IndDir", "DIR"], ["IndDuimp", "DUIMP"],
];

const TIPO_ALIQ = {
  1: "Fixa", 2: "Padrão", 3: "Sem alíquota",
  4: "Uniforme nacional", 5: "Uniforme setorial",
};

// Regra geral do IBS/CBS: bem sem vínculo em nenhum anexo de cClassTrib é
// tributado integralmente, ou seja CST 000 + cClassTrib 000001. O próprio
// registro 000001 ("Situações tributadas integralmente pelo IBS e CBS.")
// aponta essa base legal em TexUrlLegislacao -> LC 214/2025, art. 4º, e é o
// único cClassTrib residual do CST 000 (não tem anexo e não descreve regime
// específico). Por isso serve de classificação padrão quando a consulta por
// NCM não encontra vínculo.
const REGRA_GERAL_CST = "000";
const REGRA_GERAL_CCT = "000001";
const REGRA_GERAL_TXT = "regra geral";
const REGRA_GERAL_NOTA =
  `sem vínculo em anexo — ${REGRA_GERAL_TXT} ${REGRA_GERAL_CST}/${REGRA_GERAL_CCT} (LC 214/2025, art. 4º)`;

const PAI_CHECKS = [
  "IndExigeTrib", "IndReducaoBc", "IndReducaoAliq", "IndTransferenciaCred",
  "IndDiferimento", "IndMonofasica", "IndCredPresIbsZfm", "IndAjusteCompet",
];

const PAI_BADGES = {
  IndExigeTrib: "Exige tributação", IndReducaoBc: "Redução de BC",
  IndReducaoAliq: "Redução de alíquota", IndTransferenciaCred: "Transf. crédito",
  IndDiferimento: "Diferimento", IndMonofasica: "Monofásica",
  IndCredPresIbsZfm: "Cred.pres. IBS ZFM", IndAjusteCompet: "Ajuste competência",
};

const FILHO_FLAGS = ["IndTribRegular", "IndPermiteCredPres", "IndEstornoCred"];

// Versão dos assets para cache-busting (?v=). Bump a cada release de dados.
const ASSET_V = "20261013h";
const urlV = (p) => `${p}?v=${ASSET_V}`;

let DATA = [];
let MAP_CCT = new Map();
let fullCache = null; // full JSON (anexos), carregado sob demanda
let IDX = null;       // indice reverso NCM/NBS, carregado sob demanda
let IDX_KEYS = null;  // chaves de IDX.codes ordenadas (busca por prefixo em lote)
let NCM_DESC = null;  // descricoes NCM (g: grupos, i: itens), sob demanda
let NCM_NORM = null;  // cache codigo -> descricao normalizada (busca textual)
let ANEXO8 = null;    // dados do Anexo VIII (NBS x IndOp x cClassTrib), sob demanda

let tBusca = null;
let tBusca8 = null;
let tLote = null;
let tLoteFiltro = null;
let lastBtnDetalhe = null;

const $ = (id) => document.getElementById(id);

/* ---------- utils ---------- */
const norm = (s) =>
  (s ?? "").toString().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "");

const esc = (s) =>
  (s ?? "").toString().replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const fmtDate = (iso) => {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : esc(iso);
};

const fmtPerc = (v) => {
  if (v === null || v === undefined || Number(v) === 0) return "—";
  const n = Number(v);
  const s = Number.isInteger(n)
    ? String(n)
    : String(n).replace(/0+$/, "").replace(/\.$/, "").replace(".", ",");
  return `${s}%`;
};

// Redução sempre com o imposto explícito e na ordem CBS → IBS.
const fmtReducao = (f) => {
  if (!f) return "";
  const ibs = fmtPerc(f.PercRedIbs);
  const cbs = fmtPerc(f.PercRedCbs);
  return ibs === "—" && cbs === "—" ? "—" : `CBS ${cbs} · IBS ${ibs}`;
};

const celBool = (v) =>
  v ? '<span class="sim">✓</span>' : '<span class="nao">—</span>';

const dfesOf = (f) =>
  DFES.filter(([k]) => f[k]).map(([, label]) => label);

function showStatus(msg) {
  const el = $("status");
  el.hidden = !msg;
  el.textContent = msg || "";
}

/* ---------- filtros ---------- */
function collectFilters() {
  const selDfe = [...document.querySelectorAll('#dfes input[type="checkbox"]:checked')]
    .map((c) => c.value);
  return {
    q: norm($("q").value.trim()),
    view: document.querySelector('input[name="view"]:checked').value,
    cst: $("fCst").value,
    nomeCst: norm($("fNomeCst").value.trim()),
    paiInd: PAI_CHECKS.filter((k) => $("ind" + k.slice(3)) && $("ind" + k.slice(3)).checked),
    cod: $("fCod").value,
    nomeRed: norm($("fNomeRed").value.trim()),
    tipoAliq: $("fTipoAliq").value,
    filhoFlags: FILHO_FLAGS.filter((k) => $("ind" + k.slice(3)).checked),
    dfes: selDfe,
    op: document.querySelector('input[name="op"]:checked').value,
  };
}

const paiMatchesQ = (p, q) =>
  !q || norm(p.Cst).includes(q) || norm(p.NomeCst).includes(q);

const filhoMatchesQ = (f, q) =>
  !q || norm(f.CodClassTrib).includes(q) ||
  norm(f.NomeReduzido).includes(q) || norm(f.NomeClassTrib).includes(q);

function passaPai(p, F) {
  if (F.cst && p.Cst !== F.cst) return false;
  if (F.nomeCst && !norm(p.NomeCst).includes(F.nomeCst)) return false;
  for (const k of F.paiInd) if (!p[k]) return false;
  return true;
}

function passaFilhoBase(f, F) {
  if (F.cod && f.CodClassTrib !== F.cod) return false;
  if (F.nomeRed && !norm(f.NomeReduzido).includes(F.nomeRed)) return false;
  if (F.tipoAliq && String(f.TipoAliq) !== F.tipoAliq) return false;
  for (const k of F.filhoFlags) if (!f[k]) return false;
  if (F.dfes.length) {
    const vals = F.dfes.map((k) => !!f[k]);
    if (F.op === "E" ? vals.includes(false) : !vals.includes(true)) return false;
  }
  return true;
}

function detalheNcm(q) {
  const d = normCod(q);
  if (!IDX || !IDX.codes || d.length < 7) return null;
  const map = {};
  for (const g of buscarNcm(IDX, q, 1000)) {
    for (const it of g.itens) {
      (map[it.cod] = map[it.cod] || []).push({ codigo: g.codigo, perm: it.perm, curadoria: it.curadoria || "" });
    }
  }
  return map;
}

const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function variantesTermo(t) {
  const v = new Set([t, t + "s", t + "es"]);
  if (t.endsWith("s")) v.add(t.slice(0, -1));
  if (t.endsWith("es")) v.add(t.slice(0, -2));
  if (t.endsWith("ao")) v.add(t.slice(0, -2) + "oes");
  if (t.endsWith("oes")) v.add(t.slice(0, -3) + "ao");
  if (t.endsWith("m")) v.add(t + "ns");
  if (t.endsWith("ns")) v.add(t.slice(0, -2) + "m");
  return [...v].map((x) => new RegExp("\\b" + escRe(x)));
}

function descsParaTexto(q) {
  // Pesquisa textual nas descricoes NCM. So quando ha letras, para nao
  // colidir com CST (3 digitos), cClassTrib (6) nem NCM/NBS numericos.
  const t = norm(q).trim();
  if (!NCM_DESC || !IDX || !IDX.codes || !/[a-z]/.test(t)) return null;
  if (!NCM_NORM) {
    NCM_NORM = {};
    for (const c of Object.keys(NCM_DESC.i)) {
      const d = descNcm(c);
      if (d) NCM_NORM[c] = norm(d);
    }
  }
  const termos = t.split(/\s+/).filter((w) => w.length >= 2);
  if (!termos.length) return null;
  if (termos.length === 1 && termos[0].length < 3) return null; // "de","do","em"...
  const res = termos.map(variantesTermo);
  const achados = [];
  for (const c of Object.keys(NCM_NORM)) {
    const dn = NCM_NORM[c];
    if (res.every((rx) => rx.some((r) => r.test(dn)))) achados.push(c);
    if (achados.length >= 40) break;
  }
  achados.sort();
  const map = {}, avulsos = [];
  for (const c of achados) {
    const e = IDX.codes[c];
    if (e && e.ref && e.ref.length) {
      for (const r of e.ref) {
        const arr = (map[r[1]] = map[r[1]] || []);
        if (!arr.some((x) => x.codigo === c)) arr.push({ codigo: c, perm: r[2] || "—", curadoria: r[5] || "" });
      }
    } else {
      const d = descNcm(c);
      if (d) avulsos.push({ codigo: c, desc: d });
    }
  }
  return { map, avulsos, parcial: achados.length >= 40 };
}

function applyFilters(data, F) {
  // Janela 1 (NCM, mercadorias): filtra a grade por CST/cClassTrib,
  // NCM (7+ digitos, via IDX dos anexos do CST) e palavras da
  // descricao do produto. NBS/servicos ficam exclusivos na
  // janela 2 (Anexo VIII).
  let ncmMap = F.q ? detalheNcm(F.q) : null;
  const txt = F.q ? descsParaTexto(F.q) : null;
  let avulsos = [];
  let parcial = false;
  if (txt) {
    ncmMap = ncmMap || {};
    for (const [cod, arr] of Object.entries(txt.map)) {
      const base = (ncmMap[cod] = ncmMap[cod] || []);
      for (const x of arr) {
        if (!base.some((y) => y.codigo === x.codigo)) base.push(x);
      }
    }
    avulsos = txt.avulsos;
    parcial = txt.parcial;
  }
  // NCM valido (8 digitos) com descricao, mesmo sem vinculo nos anexos
  if (F.q && normCod(F.q).length === 8 &&
      (!ncmMap || !Object.keys(ncmMap).length)) {
    const qc = normCod(F.q);
    const d = descNcm(qc);
    if (d && !avulsos.some((a) => a.codigo === qc)) avulsos.push({ codigo: qc, desc: d });
  }
  // NCM localizado que nao aparece em nenhum anexo de cClassTrib nao fica sem
  // resposta: a classificacao e a regra geral (CST 000 / cClassTrib 000001).
  const regraGeral = avulsos.length > 0 && MAP_CCT.has(REGRA_GERAL_CCT);
  if (regraGeral) {
    ncmMap = ncmMap || {};
    const base = (ncmMap[REGRA_GERAL_CCT] = ncmMap[REGRA_GERAL_CCT] || []);
    for (const a of avulsos) {
      if (!base.some((y) => y.codigo === a.codigo)) {
        base.push({ codigo: a.codigo, perm: "", regra: true });
      }
    }
  }
  const ncmSet = ncmMap ? new Set(Object.keys(ncmMap)) : null;
  const out = [];
  let viaNcm = false;
  for (const p of data) {
    if (!passaPai(p, F)) continue;
    const pm = paiMatchesQ(p, F.q);
    let filhos = p.ClassificacoesTributarias.filter((f) => passaFilhoBase(f, F));
    if (F.q) {
      if (pm) {
        // pai casou textualmente: mostra todos os filhos (comportamento atual)
      } else {
        filhos = filhos.filter((f) =>
          filhoMatchesQ(f, F.q) || (ncmSet && ncmSet.has(f.CodClassTrib)));
        if (filhos.some((f) => !filhoMatchesQ(f, F.q))) viaNcm = true;
      }
      if (!pm && !filhos.length) continue;
    }
    if (!filhos.length) continue;
    out.push({ pai: p, filhos });
  }
  out.viaNcm = viaNcm;
  out.ncmInfo = ncmMap || {};
  out.ncmDesc = {};
  out.ncmParcial = parcial;
  if (NCM_DESC) {
    const vistos = new Set();
    for (const g of Object.values(out.ncmInfo)) {
      for (const e of g) {
        if (!vistos.has(e.codigo)) {
          vistos.add(e.codigo);
          const d = descNcm(e.codigo);
          if (d) out.ncmDesc[e.codigo] = d;
        }
      }
    }
    for (const a of avulsos) {
      if (!out.ncmDesc[a.codigo]) out.ncmDesc[a.codigo] = a.desc;
    }
  }
  out.ncmAvulso = avulsos.slice();
  out.regraGeral = regraGeral;
  return out;
}

/* ---------- busca reversa NCM/NBS ---------- */
const normCod = (s) => (s ?? "").toString().replace(/\D/g, "");

function grupoNcm(cod, e) {
  return {
    codigo: cod,
    tipo: e.t || "—",
    itens: (e.ref || []).map((r) => ({
      cst: r[0], cod: r[1], perm: r[2] || "—",
      ini: r[3] || "", fim: r[4] || "", curadoria: r[5] || "",
    })),
  };
}

function buscarNcm(idx, query, limite = 200) {
  const q = normCod(query);
  if (!q || !idx || !idx.codes) return [];
  const codes = idx.codes;
  if (codes[q]) return [grupoNcm(q, codes[q])];
  const out = [];
  for (const cod of Object.keys(codes)) {
    if (cod.startsWith(q)) {
      out.push(grupoNcm(cod, codes[cod]));
      if (out.length >= limite) break;
    }
  }
  out.sort((a, b) => (a.codigo < b.codigo ? -1 : 1));
  return out;
}

/* ---------- Anexo VIII (NBS x IndOp x cClassTrib) ---------- */

function infoVersao8() {
  if (!ANEXO8 || !ANEXO8.meta) return "";
  const m = ANEXO8.meta;
  const ver = m.versao ? ` ${m.versao}` : "";
  const gen = m.geradoEm ? ` (${fmtDate(m.geradoEm)})` : "";
  return `Anexo VIII${ver}${gen} · ${m.correlacoes} correlações · ${m.nbsUnicos} NBS · ${m.cClassTribUnicos} cClassTrib`;
}

function mostrarVersao8() {
  const txt = infoVersao8();
  if ($("versao8")) $("versao8").textContent = txt ? `— ${txt}` : "";
  if ($("rodape8") && ANEXO8 && ANEXO8.meta) {
    const m = ANEXO8.meta;
    $("rodape8").textContent = `Anexo VIII ${m.versao || ""} (${fmtDate(m.geradoEm) || ""})`.trim();
  }
}

async function garantirAnexo8(silencioso) {
  if (ANEXO8) return true;
  if (!silencioso) showStatus("Carregando Anexo VIII…");
  try {
    ANEXO8 = await carregarJson(urlV("data/anexo-viii.json"));
    mostrarVersao8();
  } catch (e) {
    showStatus("Não foi possível carregar data/anexo-viii.json (" + e.message + ").");
    return false;
  }
  if (!silencioso) showStatus("");
  return true;
}

function filtroAnexo8(q) {
  if (!ANEXO8) return [];
  const t = norm(q).trim();
  if (!t) return ANEXO8.itens;
  const termos = t.split(/\s+/).filter((w) => w.length >= 2);
  if (!termos.length) return [];
  return ANEXO8.itens.filter((it) => {
    const hay = norm(
      it.itemLc116 + " " + it.descItem + " " + it.nbs + " " + it.nbsDigits + " " +
      it.descNbs + " " + it.psOnerosa + " " + it.adqExterior + " " + it.indop + " " +
      it.localIncidencia + " " + it.cClassTrib + " " + it.nomeClassTrib
    );
    return termos.every((term) => hay.includes(term));
  });
}

// ---------- Anexo VIII: janela 2, exclusiva NBS/serviços ----------

function renderAnexo8() {
  const box = $("resultados8");
  if (!ANEXO8) {
    box.innerHTML = `<div class="vazio">Carregando Anexo VIII…</div>`;
    return;
  }
  const q = $("q8").value;
  const filtrando = q.trim().length > 0;
  const itens = filtrando ? filtroAnexo8(q) : [];
  const m = ANEXO8.meta || {};
  $("contador8").textContent = filtrando
    ? `${itens.length} correlação(ões) em ${m.correlacoes} totais`
    : `${m.correlacoes} correlações disponíveis — digite para filtrar`;
  if (!filtrando) {
    pagina8 = 0;
    box.innerHTML = `<div class="vazio">Digite NBS, IndOp, cClassTrib ou palavra para listar. ` +
      `Nada é renderizado até filtrar, para preservar performance.</div>`;
    return;
  }
  if (!itens.length) {
    const curto = q.trim().length > 0 && !q.trim().split(/\s+/).some((w) => w.length >= 2);
    box.innerHTML = curto
      ? `<div class="vazio">Termo muito curto — digite ao menos 2 letras ou um código (NBS, IndOp, cClassTrib).</div>`
      : `<div class="vazio">Nenhum resultado para "${esc(q)}" no Anexo VIII.</div>`;
    return;
  }
  const totalPag = Math.max(1, Math.ceil(itens.length / PAGE8));
  pagina8 = Math.min(Math.max(0, pagina8), totalPag - 1);
  const ini = pagina8 * PAGE8;
  const fatia = itens.slice(ini, ini + PAGE8);
  const linhas = fatia.map((it) => `<tr>
    <td class="cod">${esc(it.itemLc116)}</td>
    <td>${esc(it.descItem)}</td>
    <td class="cod">${esc(it.nbs || "—")}</td>
    <td>${esc(it.descNbs || "—")}</td>
    <td>${esc(it.psOnerosa || "—")}</td>
    <td>${esc(it.adqExterior || "—")}</td>
    <td class="cod">${esc(it.indop)}</td>
    <td>${esc(it.localIncidencia || "—")}</td>
    <td class="cod">${esc(it.cClassTrib || "—")}</td>
    <td>${esc(it.nomeClassTrib || "—")}</td>
  </tr>`).join("");
  box.innerHTML = `<div class="grupo"><div class="tab-wrap"><table>
    <thead><tr>
      <th>Item LC 116</th><th>Descrição do item (LC 116)</th><th>NBS</th><th>Descrição NBS</th>
      <th>PS Onerosa</th><th>Adq. Exterior</th><th>IndOp</th><th>Local de incidência IBS</th>
      <th>cClassTrib</th><th>Nome cClassTrib</th>
    </tr></thead>
    <tbody>${linhas}</tbody></table></div>
    ${barraPaginaSimples(itens.length, pagina8, PAGE8)}
  </div>`;
  ligarPaginaSimples(box, (delta) => {
    pagina8 += delta;
    renderAnexo8();
  });
}

function renderRegra8() {
  if (!ANEXO8 || !ANEXO8.regraIndOp || !$("regra8")) return;
  const linhas = ANEXO8.regraIndOp.map((r) => `<tr>
    <td>${r.psOnerosa === "S" ? "Sim" : "Não"}</td>
    <td>${r.adqExterior === "S" ? "Sim" : "Não"}</td>
    <td class="cod">${esc(r.indop.join(", ") || "—")}</td>
  </tr>`).join("");
  $("regra8").innerHTML = `<table>
    <thead><tr><th>PS Onerosa</th><th>Adq. Exterior</th><th>IndOp</th></tr></thead>
    <tbody>${linhas}</tbody></table>`;
}

function exportarCSVAnexo8() {
  if (!ANEXO8) return;
  const head = ["Item LC 116", "Descrição item", "NBS", "Descrição NBS",
    "PS Onerosa", "Adq. Exterior", "IndOp", "Local de incidência IBS",
    "cClassTrib", "Nome cClassTrib"];
  const linhas = [head.map(csvCell).join(";")];
  for (const it of filtroAnexo8($("q8").value)) {
    linhas.push([
      it.itemLc116, it.descItem, it.nbs, it.descNbs,
      it.psOnerosa, it.adqExterior, it.indop, it.localIncidencia,
      it.cClassTrib, it.nomeClassTrib,
    ].map(csvCell).join(";"));
  }
  baixar("anexo-viii-nbs-indop-cclasstrib.csv",
    "﻿" + linhas.join("\r\n"), "text/csv;charset=utf-8");
}

/* ---------- preferências do usuário (localStorage) ---------- */
const PREF_KEY = "cst-cclasstrib:prefs";

function lerPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch (e) { return {}; }
}

function gravarPrefs(patch) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...lerPrefs(), ...patch }));
  } catch (e) { /* modo privado / file:// — segue sem persistir */ }
}

/* ---------- componentes compartilhados ---------- */
// Paginação do lote (com escolha de linhas por página) e paginação simples das
// janelas de consulta individual, no mesmo formato que já existia no Anexo VIII.
const TAMS = [25, 50, 100, 200];
const PAGE8 = 100;   // janela NBS
const PAG = 100;     // janela 1 na visão aberta por cClassTrib
const totalPaginas = (total, tam) => Math.max(1, Math.ceil(total / Math.max(1, tam)));
const paginaValida = (pagina, total, tam) => Math.min(Math.max(0, pagina), totalPaginas(total, tam) - 1);

const LEGENDA = "TR = tributação regular · CP = permite crédito presumido · " +
  "EC = estorno de crédito · DF-e = documentos fiscais aplicáveis · " +
  "Anexos = itens de anexo (NCM/NBS) do cClassTrib";

// Estado das paginanções é guardado fora do DOM (sobrevive ao re-render).
let paginaCst = 0;
let pagina8 = 0;

function barraPaginacao(id, total, pagina, tam, rotulo) {
  if (total <= TAMS[0]) return "";
  const tp = totalPaginas(total, tam);
  const pg = paginaValida(pagina, total, tam);
  const ini = pg * tam;
  const fim = Math.min(ini + tam, total);
  return `<div class="paginacao">
    <button type="button" class="btn btn-mini" data-pg="${id}:ant"${pg === 0 ? " disabled" : ""}>← Anterior</button>
    <span class="contador">${rotulo ? esc(rotulo) + " · " : ""}mostrando ${ini + 1}–${fim} de ${total} · página ${pg + 1} de ${tp}</span>
    <button type="button" class="btn btn-mini" data-pg="${id}:prox"${pg >= tp - 1 ? " disabled" : ""}>Próxima →</button>
    <label class="tam-pagina">Linhas por página
      <select data-pg="${id}:tam" aria-label="Linhas por página">
        ${TAMS.map((n) => `<option value="${n}"${n === tam ? " selected" : ""}>${n}</option>`).join("")}
      </select>
    </label>
  </div>`;
}

function ligarPaginacao(escopo, id, aoMudar) {
  if (!escopo || !escopo.querySelectorAll) return;
  escopo.querySelectorAll(`[data-pg^="${id}:"]`).forEach((el) => {
    const acao = el.dataset.pg.slice(id.length + 1);
    if (el.tagName === "SELECT") el.onchange = () => aoMudar("tam", Number(el.value));
    else el.onclick = () => aoMudar(acao, null);
  });
}

// "← Anterior · Página X de Y · mostrando A–B de N · Próxima →", como na janela NBS.
function barraPaginaSimples(total, pagina, tam) {
  if (total <= tam) return "";
  const tp = totalPaginas(total, tam);
  const pg = paginaValida(pagina, total, tam);
  const ini = pg * tam;
  const fim = Math.min(ini + tam, total);
  return `<div class="paginacao" style="display:flex;gap:8px;align-items:center;padding:8px 16px">
    <button type="button" class="btn btn-mini" data-pagina="ant"${pg === 0 ? " disabled" : ""}>← Anterior</button>
    <span style="color:var(--muted)">Página ${pg + 1} de ${tp} · mostrando ${ini + 1}–${fim} de ${total}</span>
    <button type="button" class="btn btn-mini" data-pagina="prox"${pg >= tp - 1 ? " disabled" : ""}>Próxima →</button>
  </div>`;
}

function ligarPaginaSimples(escopo, aoMudar) {
  if (!escopo || !escopo.querySelectorAll) return;
  escopo.querySelectorAll("[data-pagina]").forEach((b) => {
    const delta = b.dataset.pagina === "ant" ? -1 : 1;
    b.onclick = () => aoMudar(delta);
  });
}

/* ---------- render ---------- */
function badgesPai(p) {
  return Object.entries(PAI_BADGES)
    .filter(([k]) => p[k])
    .map(([, label]) => `<span class="badge">${esc(label)}</span>`)
    .join("");
}

const BADGE_MAX = 12;
function badgeNcm(info, cod, descs) {
  const itens = info[cod] || [];
  const html = itens.slice(0, BADGE_MAX).map((e) => {
    const d = (descs || {})[e.codigo];
    const rot = e.regra ? REGRA_GERAL_TXT : e.perm;
    // Vínculo que veio de scripts/patches.json: não está na lista oficial, e a
    // tela diz isso (selo + motivo no title).
    const marca = e.curadoria ? ` · ${esc(e.curadoria)}` : "";
    const titulo = [d, e.curadoria ? `Curadoria: ${e.curadoria}` : ""].filter(Boolean).join(" — ");
    return `<span class="via-ncm${e.perm === "VEDADO" ? " ved" : ""}${e.curadoria ? " cura" : ""}"` +
      (titulo ? ` title="${esc(titulo)}"` : "") +
      `>${esc(e.codigo)} · ${esc(rot)}${marca}</span>`;
  }).join("");
  return html + (itens.length > BADGE_MAX
    ? `<span class="via-ncm">+${itens.length - BADGE_MAX}</span>` : "");
}

function descNcm(code) {
  if (!NCM_DESC || !code || code.length !== 8) return null;
  const frag = NCM_DESC.i[code];
  if (!frag) return null;
  const parts = [];
  for (let i = 1; i < code.length; i++) {
    const g = NCM_DESC.g[code.slice(0, i)];
    if (g) parts.push(g);
  }
  parts.push(frag);
  return parts.join(" — ");
}

function linhaFilho(f, comCst, ncmBadge) {
  const red = [fmtPerc(f.PercRedIbs), fmtPerc(f.PercRedCbs)];
  const redTxt = red[0] === "—" && red[1] === "—" ? "—" : `IBS ${red[0]} · CBS ${red[1]}`;
  const dfes = dfesOf(f);
  return `<tr>
    ${comCst ? `<td class="cod">${esc(f.Cst)}</td>` : ""}
    <td class="cod">${esc(f.CodClassTrib)}</td>
    <td>${esc(f.NomeReduzido || "")}${ncmBadge || ""}</td>
    <td class="num">${f.TipoAliq ? esc(`${f.TipoAliq} — ${TIPO_ALIQ[f.TipoAliq] || ""}`) : "—"}</td>
    <td class="num">${esc(redTxt)}</td>
    <td>${celBool(f.IndTribRegular)}</td>
    <td>${celBool(f.IndPermiteCredPres)}</td>
    <td>${celBool(f.IndEstornoCred)}</td>
    <td class="dfes" title="${esc(dfes.join(", "))}">${esc(dfes.join(", ") || "—")}</td>
    <td class="num">${f.qtdAnexos ? esc(String(f.qtdAnexos)) : "—"}</td>
    <td><button type="button" class="btn btn-mini" data-detalhe="${esc(f.CodClassTrib)}">Detalhe</button></td>
  </tr>`;
}

const headFilho = (comCst) => `<thead><tr>
  ${comCst ? "<th>CST</th>" : ""}
  <th>cClassTrib</th><th>Descrição</th><th>Tipo alíq.</th><th>Redução</th>
  <th title="Tributação regular">TR</th><th title="Permite crédito presumido">CP</th>
  <th title="Estorno de crédito">EC</th><th>DF-e</th>
  <th title="Itens de anexo (NCM/NBS)">Anexos</th><th></th>
</tr></thead>`;

function descBox(descs) {
  const linhas = Object.keys(descs).sort().map((cod) =>
    `<div><code>${esc(cod)}</code> — ${esc(descs[cod])}</div>`).join("");
  return `<div class="ncm-desc"><strong>NCM consultado:</strong>${linhas}</div>`;
}

// Aviso de que a linha CST 000 / cClassTrib 000001 veio da regra geral, e não
// de um vínculo do NCM consultado nos anexos.
const avisoRegraGeral = () =>
  `<p class="regra-geral">NCM sem vínculo em anexo de cClassTrib: aplica-se a
   <strong>regra geral</strong> — CST <code>${REGRA_GERAL_CST}</code> ·
   cClassTrib <code>${REGRA_GERAL_CCT}</code> (LC 214/2025, art. 4º).</p>`;

// Ressalva para NCM de medicamento (capítulo 30): o art. 146 reduz a zero as
// alíquotas conforme a DESTINAÇÃO do medicamento, e a lista é divulgada a cada
// 120 dias por ato do Ministério da Fazenda e do CGIBS (art. 146, § 3º), ainda
// não publicada. O critério é a lista, não o NCM — por isso aqui NÃO se sugere
// cClassTrib: é só a ressalva.
// FUTURO: quando a lista do art. 146, § 3º for publicada, trazê-la para a base
// e então o enquadramento em alíquota zero passa a ser verificável por produto.
const avisoArt146 = () =>
  `<p class="aviso-art146">Medicamentos: a alíquota poderá ser
   <strong>reduzida a zero</strong> pelo <strong>art. 146</strong> — conforme a
   <em>destinação</em> (doenças raras, negligenciadas, oncologia, diabetes, HIV/aids e
   outras IST, doenças cardiovasculares ou Programa Farmácia Popular), o
   <em>adquirente</em> (órgão público ou entidade imune com Cebas) ou a
   <em>natureza</em> (soros e vacinas). Essa lista será divulgada a cada 120 dias pelo
   Ministério da Fazenda e pelo CGIBS (art. 146, § 3º)</p>`;

const ehMedicamento = (q) => /^30/.test(normCod(q));

function temFiltro(F) {
  return !!(F.q || F.cst || F.nomeCst || F.paiInd.length || F.cod ||
    F.nomeRed || F.tipoAliq || F.filhoFlags.length || F.dfes.length);
}

function render(filtered, F) {
  const box = $("resultados");
  const total = filtered.reduce((a, g) => a + g.filhos.length, 0);
  $("contador").textContent =
    `${total} classificação(ões) em ${filtered.length} CST(s)` +
    (filtered.regraGeral
      ? ` · NCM sem vínculo: regra geral ${REGRA_GERAL_CST}/${REGRA_GERAL_CCT}`
      : filtered.viaNcm ? " · inclui vínculos NCM" : "") +
    (filtered.ncmParcial ? " · lista parcial, refine a busca" : "");

  if (!total) {
    const av = filtered.ncmAvulso || [];
    if (av.length) {
      $("contador").textContent = filtered.regraGeral
        ? "NCM localizado · regra geral ocultada pelos filtros"
        : "NCM localizado · sem vínculos com cClassTrib";
      const mostrar = av.slice(0, 20);
      box.innerHTML =
        `<div class="ncm-desc"><strong>NCM localizado${av.length > 1 ? "s" : ""}:</strong>` +
        mostrar.map((n) => `<div><code>${esc(n.codigo)}</code> — ${esc(n.desc)}</div>`).join("") +
        (av.length > mostrar.length ? `<div>…e mais ${av.length - mostrar.length}. Refine a busca.</div>` : "") +
        (filtered.regraGeral
          ? `<p style="margin:8px 0 0;color:var(--muted)">Sem vínculo nos anexos de cClassTrib: aplica-se a
             regra geral <code>${REGRA_GERAL_CST}</code>/<code>${REGRA_GERAL_CCT}</code>
             (LC 214/2025, art. 4º), ocultada pelos filtros ativos.</p>`
          : `<p style="margin:8px 0 0;color:var(--muted)">Sem vínculos nos anexos de cClassTrib.</p>`) +
        `</div>`;
      return;
    }
    box.innerHTML = `<div class="vazio">Nenhum resultado para os filtros atuais. Serviços (NBS) ficam na janela 2 (Anexo VIII).
      <br><button type="button" class="btn" id="vLimpar" style="margin-top:10px">Limpar filtros</button></div>`;
    const vl = $("vLimpar"); if (vl) vl.onclick = limpar;
    return;
  }

  const info = filtered.ncmInfo || {};
  const descs = filtered.ncmDesc || {};
  const descKeys = Object.keys(descs);
  const cabeca = (descKeys.length ? descBox(descs) : "") +
    (filtered.regraGeral ? avisoRegraGeral() : "") +
    (ehMedicamento(F.q) ? avisoArt146() : "");

  if (F.view === "lista") {
    // Visão aberta por cClassTrib: uma tabela só, paginada.
    const todas = [];
    for (const g of filtered)
      for (const f of g.filhos)
        todas.push({ f, badge: badgeNcm(info, f.CodClassTrib, descs) });
    paginaCst = paginaValida(paginaCst, todas.length, PAG);
    const ini = paginaCst * PAG;
    const fatia = todas.slice(ini, ini + PAG);
    box.innerHTML = cabeca +
      `<div class="grupo"><div class="tab-wrap">
      <table>${headFilho(true)}<tbody>${fatia.map((x) => linhaFilho(x.f, true, x.badge)).join("")}</tbody></table></div>
      ${barraPaginaSimples(todas.length, paginaCst, PAG)}</div>`;
    ligarPaginaSimples(box, (delta) => {
      paginaCst += delta;
      render(filtered, F);
    });
  } else {
    // Agrupada por CST: sem critério ativo a página cairia nos 18 CSTs / 173
    // cClassTrib de uma vez, então os blocos nascem recolhidos e abrem no clique
    // (filtrando, já vêm abertos).
    const aberto = temFiltro(F);
    box.innerHTML = cabeca + filtered.map((g) => `
      <details class="grupo"${aberto ? " open" : ""}>
        <summary class="grupo-head">
          <h2><code>${esc(g.pai.Cst)}</code> — ${esc(g.pai.NomeCst || "")}</h2>
          <p>Vigência: ${fmtDate(g.pai.DthIniVig)} a ${fmtDate(g.pai.DthFimVig)}
             · ${g.filhos.length} classificação(ões)</p>
        </summary>
        ${badgesPai(g.pai) ? `<div class="badges">${badgesPai(g.pai)}</div>` : ""}
        <div class="tab-wrap"><table>${headFilho(false)}
          <tbody>${g.filhos.map((f) => linhaFilho(f, false, badgeNcm(info, f.CodClassTrib, descs))).join("")}</tbody>
        </table></div>
      </details>`).join("");
  }

  box.querySelectorAll("[data-detalhe]").forEach((b) =>
    b.addEventListener("click", (e) => {
      lastBtnDetalhe = e.currentTarget;
      abrirDetalhe(b.dataset.detalhe, true);
    }));
}

/* ---------- indice NCM/NBS ---------- */
async function carregarJson(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

async function garantirIdx(silencioso) {
  if (IDX && NCM_DESC) return true;
  if (!silencioso) showStatus("Carregando índice NCM/NBS…");
  const erros = [];
  if (!IDX) {
    try {
      IDX = await carregarJson(urlV("data/ncm-nbs.json"));
    } catch (e) {
      erros.push("ncm-nbs.json (" + e.message + ")");
    }
  }
  if (!NCM_DESC) {
    try {
      NCM_DESC = await carregarJson(urlV("data/ncm-descricoes.json"));
    } catch (e) {
      erros.push("ncm-descricoes.json (" + e.message + ")");
    }
  }
  if (erros.length && !IDX) {
    showStatus("Não foi possível carregar: " + erros.join("; ") + ".");
    return false;
  }
  if (erros.length) {
    // Índice NCM carregado, só faltam as descrições: busca por código
    // funciona, só a busca por palavra do produto fica degradada.
    showStatus("Aviso: " + erros.join("; ") + ". Busca por código funciona; por palavra pode falhar.");
    return true;
  }
  showStatus("");
  return true;
}

/* ---------- detalhe ---------- */
function localizar(cod) {
  for (const p of DATA)
    for (const f of p.ClassificacoesTributarias)
      if (f.CodClassTrib === cod) return { pai: p, filho: f };
  return null;
}

function dlRow(dt, dd) {
  return `<dt>${esc(dt)}</dt><dd>${dd}</dd>`;
}

function abrirDetalhe(cod, fromBtn) {
  const ach = localizar(cod);
  if (!ach) return;
  if (fromBtn) lastBtnDetalhe = document.activeElement;
  const { pai, filho: f } = ach;
  $("dlgTitulo").textContent = `${f.CodClassTrib} — ${(f.NomeReduzido || "").trim()}`;
  try {
    const url = new URL(location.href);
    url.searchParams.set("cct", f.CodClassTrib);
    history.replaceState(null, "", url);
  } catch (e) {}

  const flags = [...FILHO_FLAGS, "IndMonoRetem", "IndMonoRet", "IndMonoDif",
    "IndMonoVal", "IndPbioDiferenca", "PossuiIndDfe"]
    .map((k) => dlRow(k, f[k] ? "Sim" : "Não")).join("");

  $("dlgBody").innerHTML = `
    <dl class="dl">
      ${dlRow("CST", `<strong>${esc(pai.Cst)}</strong> — ${esc(pai.NomeCst || "")}`)}
      ${dlRow("Nome completo", esc(f.NomeClassTrib || ""))}
      ${dlRow("Tipo de alíquota", f.TipoAliq ? esc(`${f.TipoAliq} — ${TIPO_ALIQ[f.TipoAliq] || ""}`) : "—")}
      ${dlRow("Redução IBS / CBS", `${fmtPerc(f.PercRedIbs)} / ${fmtPerc(f.PercRedCbs)}`)}
      ${dlRow("Tipo RB SN", esc(f.TipoRbSn ?? "—"))}
      ${dlRow("DF-e aplicáveis", esc(dfesOf(f).join(", ") || "—"))}
      ${dlRow("Publicação", fmtDate(f.DthPublicacao))}
      ${dlRow("Início vigência", fmtDate(f.DthIniVig))}
      ${dlRow("Fim vigência", fmtDate(f.DthFimVig))}
      ${dlRow("Legislação", f.TexUrlLegislacao
        ? `<a href="${esc(f.TexUrlLegislacao)}" target="_blank" rel="noopener">abrir texto legal</a>` : "—")}
      ${flags}
    </dl>
    ${f.TexRegIbs ? `<details class="regra"><summary>Regra IBS</summary><pre>${esc(f.TexRegIbs)}</pre></details>` : ""}
    ${f.TexRegCbs ? `<details class="regra"><summary>Regra CBS</summary><pre>${esc(f.TexRegCbs)}</pre></details>` : ""}
    <div id="anexosWrap" style="margin-top:12px"></div>` +
    `<div id="anexo8Wrap" style="margin-top:12px"></div>`;

  const wrap = $("anexosWrap");
  if (f.qtdAnexos > 0) {
    wrap.innerHTML = `<button type="button" class="btn" id="btnAnexos">
      Carregar ${f.qtdAnexos} item(ns) de anexo (NCM/NBS)</button><div id="anexosTab"></div>`;
    $("btnAnexos").onclick = () => carregarAnexosToggle(cod, f.qtdAnexos);
  } else {
    wrap.innerHTML = `<p style="color:var(--muted)">Sem itens de anexo (NCM/NBS) para este código.</p>`;
  }
  const dlg = $("dlg");
  dlg.showModal();
  if (lastBtnDetalhe) {
    try { lastBtnDetalhe.focus(); } catch (e) {}
  }
  preencherAnexo8Dlg(cod);
}

async function carregarAnexos(cod) {
  const tab = $("anexosTab");
  tab.innerHTML = "<p>Carregando…</p>";
  const mostra = (anexos) => {
    if (!anexos.length) { tab.innerHTML = "<p>Nenhum anexo encontrado.</p>"; return; }
    tab.innerHTML = `<div class="tab-wrap"><table>
      <thead><tr><th>Tipo</th><th>Código</th><th>Item</th><th>Início</th><th>Fim</th><th>Permissão</th></tr></thead>
      <tbody>${anexos.map((a) => `<tr>
        <td>${esc(a.TipoCodigo ?? "")}</td>
        <td class="cod">${esc(a.CodNcmNbs ?? "")}</td>
        <td title="${esc(a.Observacao || "")}${a.Curadoria ? esc(` — Curadoria: ${a.Curadoria}`) : ""}">${esc(a.DescItemAnexo || a.DescAnexo || "")}${a.Curadoria ? ` <span class="badge cura" title="${esc(a.Curadoria)}">${esc(a.Curadoria)}</span>` : ""}</td>
        <td class="num">${fmtDate(a.DthIniVig)}</td>
        <td class="num">${fmtDate(a.DthFimVig)}</td>
        <td class="${a.TipoPermissao === "VEDADO" ? "vedado" : "permitido"}">${esc(a.TipoPermissao ?? "")}</td>
      </tr>`).join("")}</tbody></table></div>`;
  };
  // 1) fragmento por código (KB, gerado por scripts/gerar_anexos.py)
  try {
    const r = await fetch(urlV(`data/anexos/${cod}.json`));
    if (r.ok) { mostra((await r.json()).anexos || []); return; }
  } catch (e) { /* cai para o snapshot completo */ }
  // 2) fallback: snapshot completo (MB, só quando o fragmento não existe)
  try {
    if (!fullCache) {
      const r = await fetch(urlV("data/classificacao-tributaria.json"));
      if (!r.ok) throw new Error("HTTP " + r.status);
      fullCache = await r.json();
    }
    let anexos = [];
    if (MAP_CCT && MAP_CCT.get(cod)) {
      anexos = (MAP_CCT.get(cod).filho.Anexos) || [];
    } else {
      outer: for (const p of fullCache)
        for (const f of p.ClassificacoesTributarias)
          if (f.CodClassTrib === cod) { anexos = f.Anexos || []; break outer; }
    }
    mostra(anexos);
  } catch (e) {
    tab.innerHTML = `<p>Não foi possível carregar os anexos (${esc(e.message)}).</p>`;
  }
}

async function carregarAnexosToggle(cod, qtd) {
  const tab = $("anexosTab");
  const btn = $("btnAnexos");
  if (tab.innerHTML.trim() !== "") {
    tab.innerHTML = "";
    btn.textContent = `Carregar ${qtd} item(ns) de anexo (NCM/NBS)`;
    return;
  }
  btn.disabled = true;
  btn.textContent = "Carregando…";
  await carregarAnexos(cod);
  btn.disabled = false;
  btn.textContent = `Recolher anexos (${qtd})`;
}

async function preencherAnexo8Dlg(cod) {
  const ok = await garantirAnexo8(true);
  if (!ok || !ANEXO8) return;
  if (!$("dlg").open) return; // diálogo fechado durante a carga
  const titulo = $("dlgTitulo").textContent || "";
  if (!titulo.startsWith(cod + " —")) return; // diálogo trocou de código
  const wrap = $("anexo8Wrap");
  if (!wrap) return;
  const ach = ANEXO8.itens.filter((it) => it.cClassTrib === cod);
  if (!ach.length) {
    wrap.innerHTML = `<p style="color:var(--muted)">Sem correlações do Anexo VIII (NBS/IndOp) para este cClassTrib.</p>`;
    return;
  }
  // Hierarquia de nomes: prevalece o Portal (IT 1.70, cabeçalho do detalhe);
  // a planilha do Anexo VIII v1.01.00 diverge em alguns códigos — avisa.
  const nomePortal = ((localizar(cod) || {}).filho || {}).NomeReduzido;
  const nomePlan = ach[0].nomeClassTrib || "";
  const divergente = nomePortal && nomePlan &&
    nomePortal.trim() !== nomePlan.trim();
  const notaNome = divergente
    ? `<p style="color:var(--muted)">Nome no Portal (IT 1.70): “${esc(nomePortal.trim())}”. ` +
      `Abaixo, nome conforme a planilha do Anexo VIII v1.01.00.</p>`
    : "";
  const MAX = 200;
  const linhas = ach.slice(0, MAX).map((it) => `<tr>
    <td class="cod">${esc(it.nbs || "—")}</td>
    <td>${esc(it.descNbs || "")}</td>
    <td class="cod">${esc(it.indop)}</td>
    <td>${esc(it.localIncidencia || "—")}</td>
    <td>${esc(it.psOnerosa || "—")}</td>
    <td>${esc(it.adqExterior || "—")}</td>
    <td class="cod">${esc(it.itemLc116)}</td>
  </tr>`).join("");
  wrap.innerHTML = `<details class="regra" open><summary>Anexo VIII — ${ach.length} correlação(ões) NBS/IndOp</summary>
    ${notaNome}
    <div class="tab-wrap"><table>
    <thead><tr><th>NBS</th><th>Descrição NBS</th><th>IndOp</th><th>Local de incidência</th><th>PS Onerosa</th><th>Adq. Exterior</th><th>Item LC 116</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>
    ${ach.length > MAX ? `<p style="color:var(--muted)">…e mais ${ach.length - MAX}.</p>` : ""}
    </details>`;
}

/* ---------- exportação ---------- */
const csvCell = (v) => {
  const s = (v ?? "").toString();
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function baixar(nome, conteudo, tipo) {
  baixarBlob(nome, new Blob([conteudo], { type: tipo }));
}

function baixarBlob(nome, blob) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function exportarCSV(filtered) {
  const head = ["CST", "Nome CST", "cClassTrib", "Descrição", "Tipo alíquota",
    "Red IBS %", "Red CBS %", "Trib regular", "Cred presumido", "Estorno",
    "DF-e", "Início vigência", "Fim vigência", "Legislação"];
  const linhas = [head.map(csvCell).join(";")];
  for (const g of filtered)
    for (const f of g.filhos)
      linhas.push([
        g.pai.Cst, g.pai.NomeCst, f.CodClassTrib, f.NomeReduzido,
        f.TipoAliq ? `${f.TipoAliq} - ${TIPO_ALIQ[f.TipoAliq] || ""}` : "",
        f.PercRedIbs ?? "", f.PercRedCbs ?? "",
        f.IndTribRegular ? "Sim" : "Não",
        f.IndPermiteCredPres ? "Sim" : "Não",
        f.IndEstornoCred ? "Sim" : "Não",
        dfesOf(f).join(", "),
        (f.DthIniVig || "").slice(0, 10), (f.DthFimVig || "").slice(0, 10),
        f.TexUrlLegislacao || "",
      ].map(csvCell).join(";"));
  baixar("cst-cclasstrib.csv", "﻿" + linhas.join("\r\n"), "text/csv;charset=utf-8");
}

function exportarJSON(filtered) {
  baixar("cst-cclasstrib.json",
    JSON.stringify(filtered.map((g) => ({ ...g.pai, ClassificacoesTributarias: g.filhos })),
      null, 1), "application/json");
}

/* ---------- consulta em lote por NCM (importa CSV/texto, exporta CSV/Excel) ---------- */

// Colunas da lista em lote: ordem de exibição, largura na planilha, tipo do
// valor (para ordenar e para decidir texto x número no .xlsx), a classe da
// célula na tela e de onde o valor sai.
const LOTE_COLS = [
  { id: "ncm", rotulo: "NCM consultado", larg: 16, tipo: "cod", cls: "cod", valor: (l) => l.ncm },
  { id: "descNcm", rotulo: "Descrição NCM", larg: 52, tipo: "txt", cls: "dsc", valor: (l) => l.descNcm },
  { id: "cst", rotulo: "CST", larg: 6, tipo: "cod", cls: "cod", valor: (l) => l.cst },
  { id: "cod", rotulo: "cClassTrib", larg: 11, tipo: "cod", cls: "cod", valor: (l) => l.cod },
  { id: "desc", rotulo: "Descrição CClassTrib", larg: 58, tipo: "txt", cls: "", valor: (l) => l.desc },
  { id: "tipo", rotulo: "Tipo alíq.", larg: 20, tipo: "txt", cls: "num", valor: (l) => l.tipo },
  { id: "red", rotulo: "Redução", larg: 20, tipo: "txt", cls: "num", valor: (l) => l.red },
  { id: "tr", rotulo: "TR", larg: 5, tipo: "txt", cls: "", valor: (l) => l.tr },
  { id: "cp", rotulo: "CP", larg: 5, tipo: "txt", cls: "", valor: (l) => l.cp },
  { id: "ec", rotulo: "EC", larg: 5, tipo: "txt", cls: "", valor: (l) => l.ec },
  { id: "dfe", rotulo: "DF-e", larg: 34, tipo: "txt", cls: "dfes", valor: (l) => l.dfe },
  { id: "anexos", rotulo: "Anexos", larg: 8, tipo: "num", cls: "num", valor: (l) => l.anexos },
];
const LOTE_DELIM = [";", "\t", ",", "|"];
const LOTE_MAX_NCM = 5000;    // trava: códigos por importação
const LOTE_MAX_LINHA = 20000; // trava: linhas geradas
const LOTE_IDS = LOTE_COLS.map((c) => c.id);

let LOTE = { ncms: 0, linhas: [], semVinculo: 0, naoEncontrado: 0, truncado: false };
let lotePagina = 0;
let loteTam = 50;
let loteFiltro = "";
let loteOrdem = { col: "", dir: "asc" };
let loteColunas = LOTE_IDS.slice(); // ordem de exibição
let loteOcultas = [];              // ids escondidos

function aplicarPrefsLote() {
  const p = lerPrefs().lote || {};
  if (TAMS.includes(p.tam)) loteTam = p.tam;
  if (Array.isArray(p.colunas)) {
    const ids = p.colunas.filter((id) => LOTE_IDS.includes(id));
    // Coluna nova entra na posição padrão dela (e não no fim), para quem já
    // tinha uma ordem salva no navegador.
    for (const id of LOTE_IDS) {
      if (ids.includes(id)) continue;
      let pos = ids.length;
      for (let i = LOTE_IDS.indexOf(id) + 1; i < LOTE_IDS.length; i++) {
        const j = ids.indexOf(LOTE_IDS[i]);
        if (j >= 0) { pos = j; break; }
      }
      ids.splice(pos, 0, id);
    }
    loteColunas = ids;
  }
  if (Array.isArray(p.ocultas)) loteOcultas = p.ocultas.filter((id) => LOTE_IDS.includes(id));
  if (p.ordem && LOTE_IDS.includes(p.ordem.col)) {
    loteOrdem = { col: p.ordem.col, dir: p.ordem.dir === "desc" ? "desc" : "asc" };
  }
}

function salvarPrefsLote() {
  gravarPrefs({ lote: { tam: loteTam, colunas: loteColunas, ocultas: loteOcultas, ordem: loteOrdem } });
}

const colsVisiveis = () => loteColunas
  .map((id) => LOTE_COLS.find((c) => c.id === id))
  .filter((c) => c && !loteOcultas.includes(c.id));

// Nomes de cabeçalho aceitos como coluna de NCM (já normalizados).
const LOTE_CABECALHO = ["ncm consultado", "ncm", "codigo ncm", "cod ncm", "codncm"];

const soDigitos = (s) => (s ?? "").toString().replace(/\D/g, "");

// Cache da última extração: gravarHash() roda a cada tecla e não pode
// reprocessar uma lista de 5.000 códigos a cada render.
let loteNcmsCache = { texto: null, lista: [] };

function extrairNcmsCache(texto) {
  if (loteNcmsCache.texto === texto) return loteNcmsCache.lista;
  loteNcmsCache = { texto, lista: extrairNcms(texto) };
  return loteNcmsCache.lista;
}

function dividirLinha(linha, delim) {
  // Quebra respeitando aspas (CSV padrão: "" escapa aspas).
  const out = [];
  let cur = "", aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch !== '"') { cur += ch; continue; }
      if (linha[i + 1] === '"') { cur += '"'; i++; } else aspas = false;
    } else if (ch === '"') {
      aspas = true;
    } else if (ch === delim) {
      out.push(cur); cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// Coluna NCM de um CSV/TSV com cabeçalho reconhecível; null quando não há.
function colunaNcm(texto) {
  const linhas = texto.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (!linhas.length) return null;
  for (const d of LOTE_DELIM) {
    if (!linhas[0].includes(d)) continue;
    const cab = dividirLinha(linhas[0], d).map((c) => norm(c));
    let col = cab.findIndex((c) => LOTE_CABECALHO.includes(c));
    if (col < 0) col = cab.findIndex((c) => /ncm|codigo|cod/.test(c) && !/descri|nome|produto/.test(c));
    if (col < 0) continue;
    const out = [];
    for (const l of linhas.slice(1)) {
      const dig = soDigitos(dividirLinha(l, d)[col]);
      if (dig.length >= 4 && dig.length <= 9) out.push(dig);
    }
    if (out.length) return out;
  }
  return null;
}

// NCMs soltos no texto (uma por linha, separados por vírgula, com pontos etc.).
function codigosDeTexto(texto) {
  const toks = (texto.match(/\d[\d.]*/g) || [])
    .map(soDigitos)
    .filter((d) => d.length >= 4 && d.length <= 8);
  const longos = toks.filter((d) => d.length >= 7);
  return longos.length ? longos : toks;
}

function extrairNcms(texto) {
  const t = (texto || "").trim();
  if (!t) return [];
  const cods = colunaNcm(t) || codigosDeTexto(t);
  const vistos = new Set();
  const out = [];
  for (const c of cods) {
    if (vistos.has(c)) continue;
    vistos.add(c);
    out.push(c);
    if (out.length >= LOTE_MAX_NCM) break;
  }
  return out;
}

// Código do índice (exato ou por prefixo, ex. "0901").
function casarCodigo(cod) {
  if (!IDX || !IDX.codes) return [];
  if (IDX.codes[cod]) return [cod];
  if (!IDX_KEYS) IDX_KEYS = Object.keys(IDX.codes).sort();
  let lo = 0, hi = IDX_KEYS.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (IDX_KEYS[m] < cod) lo = m + 1; else hi = m;
  }
  const out = [];
  for (let i = lo; i < IDX_KEYS.length && IDX_KEYS[i].startsWith(cod); i++) {
    out.push(IDX_KEYS[i]);
    if (out.length >= 300) break;
  }
  return out;
}

function linhaLote(cod, ref, f) {
  return {
    ncm: cod,
    descNcm: descNcm(cod) || "",
    cst: ref[0] || "",
    cod: ref[1] || "",
    desc: (f && (f.NomeReduzido || f.NomeClassTrib) || "").trim(),
    tipo: f && f.TipoAliq ? `${f.TipoAliq} — ${TIPO_ALIQ[f.TipoAliq] || ""}` : "",
    red: fmtReducao(f),
    tr: f ? (f.IndTribRegular ? "Sim" : "Não") : "",
    cp: f ? (f.IndPermiteCredPres ? "Sim" : "Não") : "",
    ec: f ? (f.IndEstornoCred ? "Sim" : "Não") : "",
    dfe: f ? (dfesOf(f).join(", ") || "—") : "",
    anexos: f && f.qtdAnexos ? f.qtdAnexos : "",
    perm: ref[2] || "",
    curadoria: ref[5] || "",
    nota: "",
  };
}

// NCM válido (com descrição no índice) que não aparece em nenhum anexo:
// a classificação é a regra geral (CST 000 / cClassTrib 000001).
function linhaRegraGeral(ncm) {
  const f = (MAP_CCT.get(REGRA_GERAL_CCT) || {}).filho;
  const l = linhaLote(ncm, [REGRA_GERAL_CST, REGRA_GERAL_CCT, ""], f);
  l.nota = REGRA_GERAL_NOTA;
  l.regra = true;
  return l;
}

function montarLote(ncms) {
  const linhas = [];
  let semVinculo = 0, naoEncontrado = 0, truncado = false;
  for (const ncm of ncms) {
    const cods = casarCodigo(ncm);
    if (!cods.length) {
      const desc = descNcm(ncm) || "";
      if (desc) {
        semVinculo++;
        linhas.push(linhaRegraGeral(ncm));
      } else {
        naoEncontrado++;
        linhas.push({
          ncm, descNcm: "", cst: "", cod: "", desc: "", tipo: "", red: "", tr: "",
          cp: "", ec: "", dfe: "", anexos: "", perm: "",
          nota: "não encontrado no índice",
        });
      }
      continue;
    }
    for (const cod of cods) {
      const e = IDX.codes[cod] || {};
      const refs = e.ref || [];
      if (!refs.length) continue;
      for (const r of refs) {
        const f = (MAP_CCT.get(r[1]) || {}).filho;
        linhas.push(linhaLote(cod, r, f));
      }
    }
    if (linhas.length >= LOTE_MAX_LINHA) { truncado = true; break; }
  }
  LOTE = { ncms: ncms.length, linhas, semVinculo, naoEncontrado, truncado };
}

/* ---------- lista em lote: filtro, ordenação, colunas e paginação ---------- */

function linhasLoteFiltradas() {
  const t = norm(loteFiltro).trim();
  if (!t) return LOTE.linhas;
  const termos = t.split(/\s+/).filter((w) => w.length >= 2);
  if (!termos.length) return LOTE.linhas;
  return LOTE.linhas.filter((l) => {
    const hay = norm([l.ncm, l.descNcm, l.cst, l.cod, l.desc, l.tipo, l.red, l.tr, l.cp,
      l.ec, l.dfe, l.anexos, l.perm, l.nota].join(" "));
    return termos.every((term) => hay.includes(term));
  });
}

function linhasLoteVisiveis() {
  const linhas = linhasLoteFiltradas();
  const col = LOTE_COLS.find((c) => c.id === loteOrdem.col);
  if (!col) return linhas;
  const mul = loteOrdem.dir === "desc" ? -1 : 1;
  return linhas.slice().sort((a, b) => {
    const va = col.valor(a), vb = col.valor(b);
    if (col.tipo === "num") {
      const na = va === "" ? -1 : Number(va);
      const nb = vb === "" ? -1 : Number(vb);
      return (na - nb) * mul;
    }
    return String(va ?? "").localeCompare(String(vb ?? ""), "pt-BR") * mul;
  });
}

const matrizLote = (linhas, cols) => linhas.map((l) => cols.map((c) => c.valor(l)));

function celulaLote(c, l) {
  const v = c.valor(l);
  const nota = l.nota ? `<span class="via-ncm">${esc(l.nota)}</span>` : "";
  // Curadoria (scripts/patches.json): vínculo fora da lista oficial do portal.
  const curadoria = l.curadoria
    ? ` <span class="via-ncm cura" title="${esc(l.curadoria)}">${esc(l.curadoria)}</span>` : "";
  if (c.id === "ncm") {
    const marca = l.perm
      ? `<span class="via-ncm${l.perm === "VEDADO" ? " ved" : ""}">${esc(l.perm)}</span>`
      : l.regra ? `<span class="via-ncm">${REGRA_GERAL_TXT}</span>` : "";
    return `<td class="cod">${esc(v)}${marca}</td>`;
  }
  // A nota ("sem vínculo...", "não encontrado...") é sobre o NCM: fica junto
  // da Descrição NCM, não da descrição do cClassTrib.
  if (c.id === "descNcm" || c.id === "desc") {
    const selo = c.id === "descNcm" ? nota + curadoria : "";
    return `<td${c.cls ? ` class="${c.cls}"` : ""}>${v ? esc(v) : "—"}${selo}</td>`;
  }
  const cls = c.cls || "";
  const vazio = v === "" || v === null || v === undefined;
  return `<td${cls ? ` class="${cls}"` : ""}>${vazio ? "—" : esc(v)}</td>`;
}

function renderColunasLote() {
  const ul = $("loteColunasLista");
  if (!ul) return;
  const cols = loteColunas.map((id) => LOTE_COLS.find((c) => c.id === id)).filter(Boolean);
  ul.innerHTML = cols.map((c, i) => `<li draggable="true" data-coluna="${c.id}">
    <span class="arrasta" aria-hidden="true" title="Arraste para reordenar">⠿</span>
    <label><input type="checkbox" data-vis="${c.id}"${loteOcultas.includes(c.id) ? "" : " checked"}> ${esc(c.rotulo)}</label>
    <span class="dir">
      <button type="button" class="btn btn-mini" data-mv="${c.id}:subir"${i === 0 ? " disabled" : ""} aria-label="Mover ${esc(c.rotulo)} para cima">▲</button>
      <button type="button" class="btn btn-mini" data-mv="${c.id}:descer"${i === cols.length - 1 ? " disabled" : ""} aria-label="Mover ${esc(c.rotulo)} para baixo">▼</button>
    </span>
  </li>`).join("");

  const resumo = $("loteColunasResumo");
  if (resumo) resumo.textContent = `Colunas (${colsVisiveis().length}/${LOTE_COLS.length})`;

  ul.querySelectorAll("input[data-vis]").forEach((cb) => {
    cb.onchange = () => {
      const id = cb.dataset.vis;
      loteOcultas = cb.checked
        ? loteOcultas.filter((x) => x !== id)
        : [...new Set([...loteOcultas, id])];
      salvarPrefsLote();
      renderLote();
    };
  });
  ul.querySelectorAll("[data-mv]").forEach((b) => {
    b.onclick = () => {
      const [id, dir] = b.dataset.mv.split(":");
      const i = loteColunas.indexOf(id);
      const j = dir === "subir" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= loteColunas.length) return;
      [loteColunas[i], loteColunas[j]] = [loteColunas[j], loteColunas[i]];
      salvarPrefsLote();
      renderLote();
    };
  });
  let arrastando = null;
  ul.querySelectorAll("li").forEach((li) => {
    li.addEventListener("dragstart", () => {
      arrastando = li.dataset.coluna;
      li.classList.add("arrastando");
    });
    li.addEventListener("dragend", () => li.classList.remove("arrastando"));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const alvo = li.dataset.coluna;
      if (!arrastando || arrastando === alvo) return;
      const de = loteColunas.indexOf(arrastando);
      const para = loteColunas.indexOf(alvo);
      if (de < 0 || para < 0) return;
      loteColunas.splice(de, 1);
      loteColunas.splice(para, 0, arrastando);
      arrastando = null;
      salvarPrefsLote();
      renderLote();
    });
  });
}

function renderLote() {
  const box = $("loteResultados");
  const info = $("loteResumo");
  const n = LOTE.linhas.length;
  $("btnLoteCsv").disabled = !n;
  $("btnLoteXlsx").disabled = !n;
  // A barra (filtro, colunas, exportação) só faz sentido com resultado na tela.
  if ($("loteBarra")) $("loteBarra").hidden = !n;
  renderColunasLote();

  if (!LOTE.ncms) {
    info.textContent = "Colunas padrão: " + LOTE_COLS.map((c) => c.rotulo).join(" · ") + ".";
    box.innerHTML = "";
    return;
  }
  const partes = [
    `${LOTE.ncms} NCM(s) importado(s)`,
    `${n} linha(s)`,
  ];
  if (LOTE.semVinculo) partes.push(`${LOTE.semVinculo} sem vínculo → regra geral`);
  if (LOTE.naoEncontrado) partes.push(`${LOTE.naoEncontrado} não encontrado(s)`);
  if (LOTE.truncado) partes.push(`limitado a ${LOTE_MAX_LINHA} linhas`);
  info.textContent = partes.join(" · ") + ".";

  if (!n) {
    box.innerHTML = `<div class="vazio">Nenhum NCM reconhecido no texto importado.
      Use 7+ dígitos por código (ex.: <code>07082000</code>) ou prefixos quando não houver
      nenhum código completo (ex.: <code>0901</code>).</div>`;
    return;
  }

  const cols = colsVisiveis();
  if (!cols.length) {
    box.innerHTML = `<div class="vazio">Todas as colunas estão ocultas — marque ao menos uma em
      <strong>Colunas</strong>.</div>`;
    return;
  }
  const todas = linhasLoteVisiveis();
  if (!todas.length) {
    box.innerHTML = `<div class="vazio">Nenhuma linha corresponde ao filtro
      “${esc(loteFiltro.trim())}”. <button type="button" class="btn btn-mini" id="loteLimpaFiltro">Limpar filtro</button></div>`;
    const b = $("loteLimpaFiltro");
    if (b) b.onclick = () => {
      loteFiltro = "";
      if ($("loteFiltro")) $("loteFiltro").value = "";
      renderLote();
    };
    return;
  }
  lotePagina = paginaValida(lotePagina, todas.length, loteTam);
  const ini = lotePagina * loteTam;
  const fatia = todas.slice(ini, ini + loteTam);

  const cab = cols.map((c) => {
    const ativo = loteOrdem.col === c.id;
    const seta = ativo ? (loteOrdem.dir === "asc" ? " ▲" : " ▼") : "";
    const aria = ativo ? (loteOrdem.dir === "asc" ? "ascending" : "descending") : "none";
    return `<th class="ordenavel${ativo ? " ativo" : ""}" data-sort="${c.id}" aria-sort="${aria}"` +
      ` title="Ordenar por ${esc(c.rotulo)}">${esc(c.rotulo)}${seta}</th>`;
  }).join("");
  const linhas = fatia.map((l) => `<tr>${cols.map((c) => celulaLote(c, l)).join("")}</tr>`).join("");
  const rotulo = loteFiltro.trim()
    ? `${todas.length} de ${n} linha(s) — filtro ativo`
    : `${todas.length} linha(s)`;

  box.innerHTML = `<div class="grupo"><div class="tab-wrap"><table>
      <thead><tr>${cab}</tr></thead><tbody>${linhas}</tbody></table></div>
    ${barraPaginacao("lote", todas.length, lotePagina, loteTam, rotulo)}</div>`;

  ligarPaginacao(box, "lote", (acao, v) => {
    if (acao === "ant") lotePagina = Math.max(0, lotePagina - 1);
    else if (acao === "prox") lotePagina += 1;
    else { loteTam = v; lotePagina = 0; salvarPrefsLote(); }
    renderLote();
  });
  box.querySelectorAll("[data-sort]").forEach((th) => {
    th.onclick = () => {
      const id = th.dataset.sort;
      if (loteOrdem.col === id) loteOrdem.dir = loteOrdem.dir === "asc" ? "desc" : "asc";
      else loteOrdem = { col: id, dir: "asc" };
      lotePagina = 0;
      salvarPrefsLote();
      renderLote();
    };
  });
}

// Escopo da exportação: tudo (filtro+ordem aplicados) ou só a página na tela.
function escopoExportLote() {
  const todas = linhasLoteVisiveis();
  const escopo = $("loteEscopo") ? $("loteEscopo").value : "tudo";
  if (escopo !== "pagina") return todas;
  const pg = paginaValida(lotePagina, todas.length, loteTam);
  return todas.slice(pg * loteTam, pg * loteTam + loteTam);
}

async function processarLote() {
  const texto = $("loteTexto").value;
  if (!texto.trim()) {
    LOTE = { ncms: 0, linhas: [], semVinculo: 0, naoEncontrado: 0, truncado: false };
    renderLote();
    return;
  }
  const ok = await garantirIdx(false);
  if (!ok || !IDX) {
    $("loteResumo").textContent = "Não foi possível carregar o índice NCM (data/ncm-nbs.json).";
    return;
  }
  montarLote(extrairNcmsCache($("loteTexto").value));
  lotePagina = 0;
  renderLote();
}

function lerArquivoLote(ev) {
  const arq = ev.target.files && ev.target.files[0];
  if (!arq) return;
  const r = new FileReader();
  // Só os dígitos importam, então UTF-8 x Latin-1 não muda o resultado.
  r.onload = () => {
    $("loteTexto").value = String(r.result || "").replace(/\u0000/g, "").slice(0, 1000000);
    processarLote();
  };
  r.onerror = () => { $("loteResumo").textContent = `Não foi possível ler "${arq.name}".`; };
  r.readAsText(arq, "utf-8");
  ev.target.value = ""; // permite reabrir o mesmo arquivo
}

function limparLote() {
  $("loteTexto").value = "";
  loteFiltro = "";
  if ($("loteFiltro")) $("loteFiltro").value = "";
  lotePagina = 0;
  LOTE = { ncms: 0, linhas: [], semVinculo: 0, naoEncontrado: 0, truncado: false };
  renderLote();
  $("loteTexto").focus();
}

function exportarLoteCSV() {
  const cols = colsVisiveis();
  const linhas = escopoExportLote();
  if (!linhas.length || !cols.length) return;
  const out = [cols.map((c) => csvCell(c.rotulo)).join(";")];
  for (const r of matrizLote(linhas, cols)) out.push(r.map(csvCell).join(";"));
  baixar("ncm-cst-cclasstrib.csv", "﻿" + out.join("\r\n"), "text/csv;charset=utf-8");
}

async function exportarLoteXLSX() {
  const cols = colsVisiveis();
  const linhas = escopoExportLote();
  if (!linhas.length || !cols.length) return;
  // Só as colunas numéricas viram número; CST e cClassTrib precisam ficar
  // como texto por causa dos zeros à esquerda.
  const dados = [cols.map((c) => c.rotulo)];
  for (const r of matrizLote(linhas, cols)) {
    dados.push(r.map((v, i) => (cols[i].tipo === "num" && v !== "" ? Number(v) : v)));
  }
  try {
    baixarBlob("ncm-cst-cclasstrib.xlsx",
      await xlsxBlob("NCM x cClassTrib", dados, cols.map((c) => c.larg)));
  } catch (e) {
    $("loteResumo").textContent = `Falha ao gerar a planilha (${e.message}). Use a exportação CSV.`;
  }
}

/* ---------- planilha .xlsx sem dependências (OOXML + ZIP) ---------- */

const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TAB[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Compressão nativa (deflate) quando disponível; senão, ZIP "store".
async function deflateRaw(bytes) {
  if (typeof CompressionStream === "undefined" || typeof Response === "undefined") return null;
  try {
    const fluxo = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(fluxo).arrayBuffer());
  } catch (e) {
    return null;
  }
}

// ZIP do pacote OOXML (método 8 = deflate, 0 = store).
async function zipStore(arquivos) {
  const enc = new TextEncoder();
  const entradas = [];
  for (const [nome, conteudo] of arquivos) {
    const nomeB = enc.encode(nome);
    const dados = typeof conteudo === "string" ? enc.encode(conteudo) : conteudo;
    const comp = await deflateRaw(dados);
    entradas.push(comp && comp.length < dados.length
      ? { nomeB, dados: comp, tam: dados.length, crc: crc32(dados), metodo: 8 }
      : { nomeB, dados, tam: dados.length, crc: crc32(dados), metodo: 0 });
  }
  const partes = [];
  const central = [];
  let offset = 0;
  for (const e of entradas) {
    const cab = new Uint8Array(30);
    const dv = new DataView(cab.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);     // versão necessária
    dv.setUint16(6, 0x0800, true); // nomes em UTF-8
    dv.setUint16(8, e.metodo, true);
    dv.setUint16(10, 0, true);     // hora
    dv.setUint16(12, 0x21, true);  // data (01/01/1980)
    dv.setUint32(14, e.crc, true);
    dv.setUint32(18, e.dados.length, true);
    dv.setUint32(22, e.tam, true);
    dv.setUint16(26, e.nomeB.length, true);
    dv.setUint16(28, 0, true);
    central.push({ nomeB: e.nomeB, crc: e.crc, comp: e.dados.length, tam: e.tam, metodo: e.metodo, offset });
    partes.push(cab, e.nomeB, e.dados);
    offset += cab.length + e.nomeB.length + e.dados.length;
  }
  const cdIni = offset;
  for (const c of central) {
    const cab = new Uint8Array(46);
    const dv = new DataView(cab.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(6, 20, true);
    dv.setUint16(8, 0x0800, true);
    dv.setUint16(10, c.metodo, true);
    dv.setUint16(12, 0, true);
    dv.setUint16(14, 0x21, true);
    dv.setUint32(16, c.crc, true);
    dv.setUint32(20, c.comp, true);
    dv.setUint32(24, c.tam, true);
    dv.setUint16(28, c.nomeB.length, true);
    dv.setUint32(42, c.offset, true);
    partes.push(cab, c.nomeB);
    offset += cab.length + c.nomeB.length;
  }
  const fim = new Uint8Array(22);
  const dvf = new DataView(fim.buffer);
  dvf.setUint32(0, 0x06054b50, true);
  dvf.setUint16(8, central.length, true);
  dvf.setUint16(10, central.length, true);
  dvf.setUint32(12, offset - cdIni, true);
  dvf.setUint32(16, cdIni, true);
  partes.push(fim);
  let total = 0;
  for (const p of partes) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) { out.set(p, pos); pos += p.length; }
  return out;
}

function xlsxCol(n) {
  let s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
  return s;
}

const xlsxEsc = (v) =>
  String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function xlsxPlanilha(linhas, larguras) {
  const cols = larguras && larguras.length
    ? `<cols>${larguras.map((w, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = linhas.map((cels, i) => {
    const cs = cels.map((v, j) => {
      const ref = xlsxCol(j + 1) + (i + 1);
      const est = i === 0 ? ' s="1"' : "";
      if (v === null || v === undefined || v === "") return `<c r="${ref}"${est}/>`;
      if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${est}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"${est}><is><t xml:space="preserve">${xlsxEsc(v)}</t></is></c>`;
    }).join("");
    return `<row r="${i + 1}">${cs}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

async function xlsxBlob(nomeAba, linhas, larguras) {
  const arquivos = [
    ["[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`],
    ["_rels/.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xlsxEsc(nomeAba)}" sheetId="1" r:id="rId1"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ["xl/worksheets/sheet1.xml", xlsxPlanilha(linhas, larguras)],
  ];
  return new Blob([await zipStore(arquivos)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/* ---------- init ---------- */
function popularSelects() {
  const sCst = $("fCst");
  for (const p of DATA) {
    const o = document.createElement("option");
    o.value = p.Cst;
    o.textContent = `${p.Cst} — ${p.NomeCst}`;
    sCst.appendChild(o);
  }
  const dfeBox = $("dfes");
  for (const [key, label] of DFES) {
    const lab = document.createElement("label");
    lab.title = key;
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.value = key;
    lab.append(cb, " " + label);
    dfeBox.appendChild(lab);
  }
  reconstruirCodigos();
}

function reconstruirCodigos() {
  const cst = $("fCst").value;
  const sel = $("fCod");
  const atual = sel.value;
  sel.innerHTML = '<option value="">Todos</option>';
  for (const p of DATA) {
    if (cst && p.Cst !== cst) continue;
    for (const f of p.ClassificacoesTributarias) {
      const o = document.createElement("option");
      o.value = f.CodClassTrib;
      o.textContent = `${f.CodClassTrib} — ${(f.NomeReduzido || "").trim()}`;
      sel.appendChild(o);
    }
  }
  if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
}

function atualizar() {
  const F = collectFilters();
  render(applyFilters(DATA, F), F);
}

function limpar() {
  // Escopo: só a janela 1 (a busca NBS tem limpeza própria no × do campo,
  // e o painel do lote tem o próprio botão Limpar).
  $("q").value = "";
  $("fCst").value = "";
  $("fCod").value = "";
  $("fNomeCst").value = "";
  $("fNomeRed").value = "";
  $("fTipoAliq").value = "";
  $("painelFiltros").querySelectorAll('input[type="checkbox"]')
    .forEach((c) => (c.checked = false));
  document.querySelector('input[name="view"][value="grupo"]').checked = true;
  document.querySelector('input[name="op"][value="E"]').checked = true;
  reconstruirCodigos();
  atualizar();
}

let debounce = null;
const agenda = () => {
  clearTimeout(debounce);
  debounce = setTimeout(atualizar, 150);
};

function setBuscaValor(v) {
  const qel = $("q");
  qel.value = v;
}

function gravarHash() {
  try {
    const url = new URL(location.href);
    const qv = $("q").value.trim();
    if (qv) url.searchParams.set("q", qv);
    else url.searchParams.delete("q");
    history.replaceState(null, "", url);
  } catch (e) {}
}

async function init() {
  $("dlgFechar").onclick = () => $("dlg").close();
$("dlg").addEventListener("close", () => {
  try {
    const url = new URL(location.href);
    url.searchParams.delete("cct");
    history.replaceState(null, "", url);
  } catch (e) {}
});
  $("dlg").addEventListener("click", (e) => {
    if (e.target === $("dlg")) $("dlg").close();
  });
  try {
    const r = await fetch(urlV("data/resumo.json"));
    if (!r.ok) throw new Error("HTTP " + r.status);
    DATA = await r.json();
    MAP_CCT.clear();
    for (const p of DATA) {
      for (const f of p.ClassificacoesTributarias) {
        MAP_CCT.set(f.CodClassTrib, { pai: p, filho: f });
      }
    }
  } catch (e) {
    showStatus("Não foi possível carregar data/resumo.json (" + e.message + "). " +
      "Sirva esta pasta por HTTP (ex.: python -m http.server) ou publique no GitHub Pages — abrir index.html direto pelo protocolo file:// bloqueia o fetch.");
    return;
  }
  popularSelects();
  aplicarPrefsLote();
  if (lerPrefs().loteEscopo === "pagina" && $("loteEscopo")) $("loteEscopo").value = "pagina";
  if ($("loteLegenda")) $("loteLegenda").textContent = LEGENDA;

  $("q").addEventListener("input", () => {
    clearTimeout(tBusca);
    tBusca = setTimeout(() => { gravarHash(); agenda(); }, 150);
  });
  let debounce8 = null;
  $("q8").addEventListener("input", () => {
    clearTimeout(debounce8);
    debounce8 = setTimeout(() => { pagina8 = 0; renderAnexo8(); }, 150);
  });
  $("btnCsv8").onclick = exportarCSVAnexo8;
  $("fNomeCst").addEventListener("input", agenda);
  $("fNomeRed").addEventListener("input", agenda);
  $("fCst").addEventListener("change", () => { reconstruirCodigos(); atualizar(); });
  document.querySelectorAll("select, input").forEach((el) => {
    if (!["q", "q8", "fNomeCst", "fNomeRed", "loteArquivo", "loteFiltro", "loteEscopo"].includes(el.id)) {
      el.addEventListener("change", atualizar);
    }
  });
  $("btnLimpar").onclick = limpar;
  $("btnCsv").onclick = () => exportarCSV(applyFilters(DATA, collectFilters()));
  $("btnJson").onclick = () => exportarJSON(applyFilters(DATA, collectFilters()));

  // Consulta em lote por NCM (importa CSV/texto, exporta CSV/Excel).
  $("btnLoteArquivo").onclick = () => $("loteArquivo").click();
  $("loteArquivo").addEventListener("change", lerArquivoLote);
  $("btnLoteProcessar").onclick = processarLote;
  $("btnLoteLimpar").onclick = limparLote;
  $("btnLoteCsv").onclick = exportarLoteCSV;
  $("btnLoteXlsx").onclick = exportarLoteXLSX;
  $("loteTexto").addEventListener("input", () => {
    clearTimeout(tLote);
    tLote = setTimeout(processarLote, 400);
  });
  $("loteFiltro").addEventListener("input", () => {
    clearTimeout(tLoteFiltro);
    tLoteFiltro = setTimeout(() => {
      loteFiltro = $("loteFiltro").value;
      lotePagina = 0;
      renderLote();
    }, 200);
  });
  $("loteEscopo").addEventListener("change", () => {
    gravarPrefs({ loteEscopo: $("loteEscopo").value });
  });
  $("loteColunasPadrao").onclick = () => {
    loteColunas = LOTE_IDS.slice();
    loteOcultas = [];
    salvarPrefsLote();
    renderLote();
  };

  renderLote();
  atualizar();

  // Pre-carrega o indice NCM em segundo plano para que a busca
  // da janela 1 tambem encontre vinculos de anexos sem espera.
  garantirIdx(true).then((ok) => {
    if (ok) {
    const qv = $("q").value.trim();
    if (normCod(qv).length >= 7 || qv.length >= 2) atualizar();
    if ($("loteTexto").value.trim()) processarLote(); // lista vinda da URL
  }
  });

  // Pre-carrega o Anexo VIII em segundo plano (janela 2 + detalhe do cClassTrib).
  garantirAnexo8(true).then((ok) => {
    if (!ok) return;
    renderRegra8();
    renderAnexo8();
    mostrarVersao8();
  });
  // Hash inicial
  try {
    const url = new URL(location.href);
    const qv = url.searchParams.get("q");
    if (qv) { $("q").value = qv; }
    const cct = url.searchParams.get("cct");
    if (cct && MAP_CCT.has(cct)) {
      setTimeout(() => abrirDetalhe(cct), 50);
    }
  } catch (e) {}
}

document.addEventListener("DOMContentLoaded", init);
