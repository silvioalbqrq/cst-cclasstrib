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

let DATA = [];
let fullCache = null; // full JSON (anexos), carregado sob demanda
let IDX = null;       // indice reverso NCM/NBS, carregado sob demanda
let NCM_DESC = null;  // descricoes NCM (g: grupos, i: itens), sob demanda
let NCM_NORM = null;  // cache codigo -> descricao normalizada (busca textual)

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
      (map[it.cod] = map[it.cod] || []).push({ codigo: g.codigo, perm: it.perm });
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
        if (!arr.some((x) => x.codigo === c)) arr.push({ codigo: c, perm: r[2] || "—" });
      }
    } else {
      const d = descNcm(c);
      if (d) avulsos.push({ codigo: c, desc: d });
    }
  }
  return { map, avulsos, parcial: achados.length >= 40 };
}

function applyFilters(data, F) {
  // Vinculos NCM/NBS: so para consultas com 7+ digitos, para nao colidir
  // com CST (3 digitos) nem cClassTrib (6 digitos).
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
  // NCM valido (8 digitos) com descricao, mesmo sem vinculo nos anexos
  out.ncmAvulso = avulsos.slice();
  if (!out.length && F.q && normCod(F.q).length === 8 &&
      (!ncmMap || !Object.keys(ncmMap).length)) {
    const qc = normCod(F.q);
    const d = descNcm(qc);
    if (d && !out.ncmAvulso.some((a) => a.codigo === qc)) {
      out.ncmAvulso.push({ codigo: qc, desc: d });
    }
  }
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
      ini: r[3] || "", fim: r[4] || "",
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

/* ---------- render ---------- */
function badgesPai(p) {
  return Object.entries(PAI_BADGES)
    .filter(([k]) => p[k])
    .map(([, label]) => `<span class="badge">${esc(label)}</span>`)
    .join("");
}

function badgeNcm(info, cod, descs) {
  return (info[cod] || []).map((e) => {
    const d = (descs || {})[e.codigo];
    return `<span class="via-ncm${e.perm === "VEDADO" ? " ved" : ""}"` +
      (d ? ` title="${esc(d)}"` : "") +
      `>${esc(e.codigo)} · ${esc(e.perm)}</span>`;
  }).join("");
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

function render(filtered, F) {
  const box = $("resultados");
  const total = filtered.reduce((a, g) => a + g.filhos.length, 0);
  $("contador").textContent =
    `${total} classificação(ões) em ${filtered.length} CST(s)` +
    (filtered.viaNcm ? " · inclui vínculos NCM/NBS" : "") +
    (filtered.ncmParcial ? " · lista parcial, refine a busca" : "");

  if (!total) {
    const av = filtered.ncmAvulso || [];
    if (av.length) {
      $("contador").textContent = "NCM localizado · sem vínculos com cClassTrib";
      const mostrar = av.slice(0, 20);
      box.innerHTML = `<div class="ncm-desc"><strong>NCM localizado${av.length > 1 ? "s" : ""}:</strong>` +
        mostrar.map((n) => `<div><code>${esc(n.codigo)}</code> — ${esc(n.desc)}</div>`).join("") +
        (av.length > mostrar.length ? `<div>…e mais ${av.length - mostrar.length}. Refine a busca.</div>` : "") +
        `<p style="margin:8px 0 0;color:var(--muted)">Sem vínculos nos anexos de cClassTrib.</p></div>`;
      return;
    }
    box.innerHTML = `<div class="vazio">Nenhum resultado para os filtros atuais.
      <br><button type="button" class="btn" id="vLimpar" style="margin-top:10px">Limpar filtros</button></div>`;
    $("vLimpar").onclick = limpar;
    return;
  }

  const info = filtered.ncmInfo || {};
  const descs = filtered.ncmDesc || {};
  const descKeys = Object.keys(descs);
  if (F.view === "lista") {
    const linhas = filtered
      .flatMap((g) => g.filhos.map((f) => linhaFilho(f, true, badgeNcm(info, f.CodClassTrib, descs))))
      .join("");
    box.innerHTML = (descKeys.length ? descBox(descs) : "") +
      `<div class="grupo"><div class="tab-wrap">
      <table>${headFilho(true)}<tbody>${linhas}</tbody></table></div></div>`;
  } else {
    box.innerHTML = (descKeys.length ? descBox(descs) : "") + filtered.map((g) => `
      <article class="grupo">
        <div class="grupo-head">
          <h2><code>${esc(g.pai.Cst)}</code> — ${esc(g.pai.NomeCst || "")}</h2>
          <p>Vigência: ${fmtDate(g.pai.DthIniVig)} a ${fmtDate(g.pai.DthFimVig)}
             · ${g.filhos.length} classificação(ões)</p>
        </div>
        ${badgesPai(g.pai) ? `<div class="badges">${badgesPai(g.pai)}</div>` : ""}
        <div class="tab-wrap"><table>${headFilho(false)}
          <tbody>${g.filhos.map((f) => linhaFilho(f, false, badgeNcm(info, f.CodClassTrib, descs))).join("")}</tbody>
        </table></div>
      </article>`).join("");
  }

  box.querySelectorAll("[data-detalhe]").forEach((b) =>
    b.addEventListener("click", () => abrirDetalhe(b.dataset.detalhe)));
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
      IDX = await carregarJson("data/ncm-nbs.json");
    } catch (e) {
      erros.push("ncm-nbs.json (" + e.message + ")");
    }
  }
  if (!NCM_DESC) {
    try {
      NCM_DESC = await carregarJson("data/ncm-descricoes.json");
    } catch (e) {
      erros.push("ncm-descricoes.json (" + e.message + ")");
    }
  }
  if (erros.length) {
    showStatus("Não foi possível carregar: " + erros.join("; ") + ".");
    return false;
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

function abrirDetalhe(cod) {
  const ach = localizar(cod);
  if (!ach) return;
  const { pai, filho: f } = ach;
  $("dlgTitulo").textContent = `${f.CodClassTrib} — ${f.NomeReduzido || ""}`;

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
    <div id="anexosWrap" style="margin-top:12px"></div>`;

  const wrap = $("anexosWrap");
  if (f.qtdAnexos > 0) {
    wrap.innerHTML = `<button type="button" class="btn" id="btnAnexos">
      Carregar ${f.qtdAnexos} item(ns) de anexo (NCM/NBS)</button><div id="anexosTab"></div>`;
    $("btnAnexos").onclick = () => carregarAnexos(cod);
  } else {
    wrap.innerHTML = `<p style="color:var(--muted)">Sem itens de anexo (NCM/NBS) para este código.</p>`;
  }
  $("dlg").showModal();
}

async function carregarAnexos(cod) {
  const tab = $("anexosTab");
  tab.innerHTML = "<p>Carregando…</p>";
  try {
    if (!fullCache) {
      const r = await fetch("data/classificacao-tributaria.json");
      if (!r.ok) throw new Error("HTTP " + r.status);
      fullCache = await r.json();
    }
    let anexos = [];
    outer: for (const p of fullCache)
      for (const f of p.ClassificacoesTributarias)
        if (f.CodClassTrib === cod) { anexos = f.Anexos || []; break outer; }
    if (!anexos.length) { tab.innerHTML = "<p>Nenhum anexo encontrado.</p>"; return; }
    tab.innerHTML = `<div class="tab-wrap"><table>
      <thead><tr><th>Tipo</th><th>Código</th><th>Item</th><th>Início</th><th>Fim</th><th>Permissão</th></tr></thead>
      <tbody>${anexos.map((a) => `<tr>
        <td>${esc(a.TipoCodigo ?? "")}</td>
        <td class="cod">${esc(a.CodNcmNbs ?? "")}</td>
        <td title="${esc(a.Observacao || "")}">${esc(a.DescItemAnexo || a.DescAnexo || "")}</td>
        <td class="num">${fmtDate(a.DthIniVig)}</td>
        <td class="num">${fmtDate(a.DthFimVig)}</td>
        <td class="${a.TipoPermissao === "VEDADO" ? "vedado" : "permitido"}">${esc(a.TipoPermissao ?? "")}</td>
      </tr>`).join("")}</tbody></table></div>`;
  } catch (e) {
    tab.innerHTML = `<p>Não foi possível carregar os anexos (${esc(e.message)}).</p>`;
  }
}

/* ---------- exportação ---------- */
const csvCell = (v) => {
  const s = (v ?? "").toString();
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function baixar(nome, conteudo, tipo) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
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
      o.textContent = `${f.CodClassTrib} — ${f.NomeReduzido}`;
      sel.appendChild(o);
    }
  }
  if ([...sel.options].some((o) => o.value === atual)) sel.value = atual;
}

function atualizar() {
  render(applyFilters(DATA, collectFilters()), collectFilters());
}

function limpar() {
  $("q").value = "";
  $("fCst").value = "";
  $("fNomeCst").value = "";
  $("fNomeRed").value = "";
  $("fTipoAliq").value = "";
  document.querySelectorAll('input[type="checkbox"]').forEach((c) => (c.checked = false));
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

async function init() {
  $("dlgFechar").onclick = () => $("dlg").close();
  $("dlg").addEventListener("click", (e) => {
    if (e.target === $("dlg")) $("dlg").close();
  });
  try {
    const r = await fetch("data/resumo.json");
    if (!r.ok) throw new Error("HTTP " + r.status);
    DATA = await r.json();
  } catch (e) {
    showStatus("Não foi possível carregar data/resumo.json (" + e.message + "). " +
      "Sirva esta pasta por HTTP (ex.: python -m http.server) ou publique no GitHub Pages — abrir index.html direto pelo protocolo file:// bloqueia o fetch.");
    return;
  }
  popularSelects();

  $("q").addEventListener("input", agenda);
  $("fNomeCst").addEventListener("input", agenda);
  $("fNomeRed").addEventListener("input", agenda);
  $("fCst").addEventListener("change", () => { reconstruirCodigos(); atualizar(); });
  document.querySelectorAll("select, input").forEach((el) => {
    if (!["q", "fNomeCst", "fNomeRed"].includes(el.id)) el.addEventListener("change", atualizar);
  });
  $("btnLimpar").onclick = limpar;
  $("btnCsv").onclick = () => exportarCSV(applyFilters(DATA, collectFilters()));
  $("btnJson").onclick = () => exportarJSON(applyFilters(DATA, collectFilters()));

  atualizar();

  // Pre-carrega o indice NCM/NBS em segundo plano para que a busca
  // unica tambem encontre vinculos de anexos sem espera.
  garantirIdx(true).then((ok) => {
    if (ok && normCod($("q").value).length >= 7) atualizar();
  });
}

document.addEventListener("DOMContentLoaded", init);
