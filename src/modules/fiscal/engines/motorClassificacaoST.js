// ============================================================
// MOTOR DE CLASSIFICAÇÃO ST — NCM + DESCRIÇÃO (2026)
// ------------------------------------------------------------
// Substitui completamente o motor genérico de score.
// Fonte única de regras: RICMS/BA Anexo 1 (Dec. 13.780/2012),
// já disponibilizado em src/lib/ricmsBaAnexo1.js, enriquecido em
// tempo de carga com padrões de NCM, palavras obrigatórias e
// sinônimos.
//
// Princípios:
//   • CEST é evidência adicional, não requisito.
//   • CST/CSOSN não classifica ST; serve apenas para detectar
//     conflito (CST 40/41/50/60 sinaliza bloqueio de cálculo).
//   • NCM sozinho não confirma ST; descrição sozinha não confirma.
//   • ST só é confirmada se NCM, descrição e condições coincidirem.
//   • Resultado incerto NUNCA dispara cálculo automático de ST.
// ============================================================

// LIMITAÇÃO DE COBERTURA GEOGRÁFICA (arquitetura):
// A base carregada aqui é EXCLUSIVAMENTE o Anexo 1 do RICMS/BA. A MVA e o
// CEST aplicados são sempre os da Bahia. Quando a UF de destino tiver MVA
// própria distinta, ou tiver sido excluída do protocolo (como ocorreu com SP
// no Prot. ICM 11/91 a partir de 01/07/26), o sistema só consegue enxergar
// isso se a exclusão estiver registrada no texto do próprio item baiano —
// o que hoje é o caso, mas NÃO é garantido para todos os itens.
// Não há cobertura multiestado implementada.
import { RICMS_BA_ANEXO1 } from "../data/ricmsBaAnexo1";
import CONV_142_18 from "../data/conv142_18.js";
import { derivarDiferenciadores } from "./desambiguacao.js";
import { calcularScoreNCMProporcional } from "./motorNCMProporcional";

import {
  parseVersoesTexto,
  extrairUfsDeTexto,
  extrairMvasDeTexto,
  vigenteEm,
  normalizarData,
} from "./vigenciaUf.js";

// ---------- Utilidades ------------------------------------------------

export function normalizarNCM(v) {
  return String(v ?? "").replace(/\D/g, "");
}

// Extrai todos os NCM alternativos de uma regra. Um item do RICMS/BA
// pode declarar "2201.1 e 2201.9" no texto original — cada alternativa
// é mantida com os dígitos realmente definidos (não completa com zeros).
function extrairNCMsRegra(regra) {
  const brutos = new Set();
  const push = (s) => {
    const d = normalizarNCM(s);
    if (d && d.length >= 2 && d.length <= 8) brutos.add(d);
  };
  push(regra.ncm);
  const tx = regra.texto_original || "";
  // captura NCMs com pontos e alternativas ligadas por "e"/","/"/"
  const re = /\b\d{4}(?:\.\d{1,2})*(?:\.\d{1,2})?/g;
  const encontrados = tx.match(re) || [];
  for (const m of encontrados) push(m);
  // remove itens que sejam prefixo estrito de outro do mesmo conjunto:
  // se a regra listou "2201.1" e "2201", mantém "2201.1" (mais específico).
  const arr = [...brutos].sort((a,b) => b.length - a.length);
  const finais = [];
  for (const cand of arr) {
    // se já houver um MAIS específico começando com este, não descartar —
    // são alternativas legítimas. Aqui só evita duplicatas literais.
    if (!finais.includes(cand)) finais.push(cand);
  }
  return finais.length ? finais : (regra.ncm ? [normalizarNCM(regra.ncm)] : []);
}

export function normalizarTexto(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["de","da","do","das","dos","e","ou","com","sem","para","por","em","a","o","as","os","um","uma","the","of","and"]);
function tokens(s) {
  return normalizarTexto(s).split(" ").filter(t => t.length >= 3 && !STOPWORDS.has(t));
}

// ---------- Score de NCM por dígito -----------------------------------

const PESOS_NCM = [5, 5, 10, 10, 15, 15, 20, 20]; // total 100 (8 dígitos)

const NIVEIS_NCM = { 2: "CAPITULO", 4: "POSICAO", 6: "SUBPOSICAO", 8: "ITEM" };
function nivelPorDigitos(n) {
  if (n >= 8) return "ITEM";
  if (n >= 6) return "SUBPOSICAO";
  if (n >= 4) return "POSICAO";
  if (n >= 2) return "CAPITULO";
  return "INSUFICIENTE";
}

/**
 * Compara um NCM de produto contra o NCM declarado pela regra usando o
 * MOTOR PROPORCIONAL (motorNCMProporcional): a norma nem sempre legisla os
 * 8 dígitos, então a compatibilidade é medida sobre os dígitos legislados.
 * Mantém os campos legados de auditoria (nivel_correspondencia,
 * primeiro_conflito, detalhes_por_digito) e acrescenta os campos novos.
 */
export function calcularScoreNCM(ncmProduto, ncmRegra) {
  const prop = calcularScoreNCMProporcional(ncmProduto, ncmRegra);
  const nDefinidos = prop.digitos_legislados;

  if (!nDefinidos) {
    return {
      ncm_produto: prop.ncm_produto, ncm_regra: prop.ncm_regra,
      digitos_regra: 0, score_ncm: 0, ncm_compativel: false,
      nivel_correspondencia: "INSUFICIENTE",
      detalhes_por_digito: [],
      primeiro_conflito: null,
      motivo: "Regra sem NCM definido.",
      proporcional: prop,
    };
  }

  const primeiroConflito = prop.conflitos.length
    ? {
        posicao: prop.conflitos[0].posicao,
        produto: prop.conflitos[0].produto,
        regra: prop.conflitos[0].legislacao,
      }
    : null;

  return {
    ncm_produto: prop.ncm_produto,
    ncm_regra: prop.ncm_regra,
    digitos_regra: nDefinidos,
    digitos_coincidentes: prop.digitos_coincidentes,
    score_ncm: prop.score_ncm,
    ncm_compativel: prop.ncm_compativel,
    nivel_correspondencia: nivelPorDigitos(nDefinidos),
    tipo_compatibilidade: prop.tipo_compatibilidade,
    regra_aplicada: prop.regra_aplicada,
    detalhes_por_digito: prop.detalhes_por_digito.map((d) => ({
      posicao: d.posicao,
      produto: d.produto,
      regra: d.legislacao,
      status: d.status === "CONFLITO" && d.produto === null ? "FALTA_NO_PRODUTO" : d.status,
      tipo_comparacao: d.tipo_comparacao,
    })),
    conflitos: prop.conflitos,
    primeiro_conflito: primeiroConflito,
    avisos: prop.avisos,
    motivo: prop.ncm_compativel
      ? prop.motivo
      : primeiroConflito
        ? `Divergência no ${primeiroConflito.posicao}º dígito (produto="${primeiroConflito.produto ?? "—"}", regra="${primeiroConflito.regra}").`
        : prop.motivo,
  };
}


// Seleciona a alternativa de NCM mais específica que casa com o produto.
function melhorAlternativaNCM(ncmProduto, alternativas) {
  let melhor = null;
  const historicos = [];
  for (const alt of alternativas) {
    const sc = calcularScoreNCM(ncmProduto, alt);
    historicos.push(sc);
    if (sc.ncm_compativel) {
      if (!melhor || sc.digitos_regra > melhor.digitos_regra) melhor = sc;
    }
  }
  return { escolhida: melhor, historico: historicos };
}

// ---------- Análise da descrição -------------------------------------

// remove termos comerciais neutros mas preserva medidas/unidades
const TERMOS_NEUTROS = new Set(["ref","cod","codigo","item","produto","embalagem","pacote","unid","unidade","cx","caixa","pc","pcs"]);
function tokensProduto(s) {
  return tokens(s).filter(t => !TERMOS_NEUTROS.has(t));
}

export function calcularScoreDescricao(descProduto, regra) {
  const evidenciasPos = [];
  const evidenciasNeg = [];
  const tProd = new Set(tokensProduto(descProduto));
  const tRegra = tokensProduto(regra.descricao_legal || regra.descricao || "");
  const obrig = regra.palavras_obrigatorias || [];
  const excl  = regra.palavras_excludentes || [];
  const sin   = regra.sinonimos || [];

  // 1) palavras excludentes → reprova imediatamente
  for (const ex of excl) {
    const t = normalizarTexto(ex);
    if (t && tProd.has(t)) {
      evidenciasNeg.push(`Termo excludente encontrado: "${ex}".`);
      return { compativel: false, score: 0, evidencias_positivas: [], evidencias_negativas: evidenciasNeg, ratio: 0 };
    }
  }

  // 2) palavras obrigatórias
  const obrigNorm = obrig.map(normalizarTexto).filter(Boolean);
  const faltando = obrigNorm.filter(t => !(tProd.has(t) || sin.some(s => tProd.has(normalizarTexto(s)))));
  if (obrigNorm.length && faltando.length) {
    evidenciasNeg.push(`Palavras obrigatórias ausentes: ${faltando.join(", ")}.`);
    return { compativel: false, score: 0, evidencias_positivas: [], evidencias_negativas: evidenciasNeg, ratio: 0 };
  }
  if (obrigNorm.length) evidenciasPos.push(`Todas as palavras obrigatórias presentes (${obrigNorm.join(", ")}).`);

  // 3) sobreposição com a descrição legal
  if (!tRegra.length) {
    return { compativel: obrigNorm.length > 0, score: obrigNorm.length ? 60 : 30,
             evidencias_positivas: evidenciasPos, evidencias_negativas: evidenciasNeg, ratio: 0 };
  }
  const hits = tRegra.filter(t => tProd.has(t) || sin.some(s => normalizarTexto(s) === t)).length;
  const ratio = hits / Math.min(tRegra.length, 6);
  const score = Math.round(Math.min(100, ratio * 100));
  if (hits > 0) evidenciasPos.push(`Sobreposição semântica: ${hits}/${tRegra.length} termos da descrição legal.`);
  const compativel = obrigNorm.length ? true : (ratio >= 0.4);
  if (!compativel) evidenciasNeg.push(`Correspondência semântica insuficiente (${(ratio*100).toFixed(0)}%).`);

  return { compativel, score, evidencias_positivas: evidenciasPos, evidencias_negativas: evidenciasNeg, ratio, hits };
}

// ---------- Registro de regras (a partir do Anexo 1) -----------------

function derivarSinonimos(desc) {
  const d = normalizarTexto(desc);
  const s = [];
  if (/\bagua\b/.test(d)) s.push("aguas");
  if (/\bcerveja/.test(d)) s.push("chope","chopp");
  if (/\brefrigerante/.test(d)) s.push("refri","refrig");
  if (/\bmedicamento/.test(d)) s.push("remedio","farmaco");
  if (/\bautomotor|automotivo|veiculo\b/.test(d)) s.push("automotivo","automotor");
  return s;
}

function inferirSegmento(regra) {
  return (regra.segmento || "").trim();
}

function inferirAcordo(regra) {
  const t = regra.texto_original || "";
  const m = t.match(/(Prot(?:ocolo)?\.?|Conv(?:ênio|enio)?\.?)\s*ICM?S?\s*\d+\/\d{2}/i);
  return regra.acordo || (m ? m[0] : "");
}

// Substituído por extrairUfsDeTexto (módulo compartilhado vigenciaUf.js).
// A leitura passou a ser feita por VERSÃO do item, e não sobre o texto
// inteiro — que pode conter a redação anterior com outra lista de UFs.

// ---------- Modo de desambiguação por grupo --------------------------
// A lei distingue certos sub-itens por um atributo que NÃO existe (e nunca
// existirá) na descrição comercial da nota — p.ex. a lista ANVISA
// (positiva/negativa/neutra) e a classe referência/genérico/similar dos
// medicamentos, ou o "contrato de fidelidade" das autopeças. Marcar esses
// grupos evita que o motor esconda a incerteza atrás de "não classificado".
const MAPA_MODO_DESAMBIGUACAO = [
  { re: /^9\.[1-5](\.|$)/, modo: "REFERENCIA_EXTERNA" }, // medicamentos/contraceptivos — lista ANVISA/CMED
  { re: /^1\.1(\.|$)/,     modo: "ATRIBUTO_NEGOCIO" },   // autopeças — contrato de fidelidade
];

export function modoDesambiguacaoDoItem(itemRicms) {
  const it = String(itemRicms ?? "").trim();
  for (const m of MAPA_MODO_DESAMBIGUACAO) if (m.re.test(it)) return m.modo;
  return "TEXTUAL";
}

// grupo_id: agrupa itens-irmãos que compartilham o mesmo NCM efetivo e o
// mesmo modo de desambiguação — para fins de "isso é ST?", são a MESMA
// decisão; só o MVA exato varia dentro do grupo.
function grupoIdDe(regra, modo, ncms) {
  if (modo === "TEXTUAL") return `TEXTUAL:${regra.id}`;
  const raizItem = String(regra.item || regra.id).split(".").slice(0, 1).join(".");
  const ncmBase = [...ncms].map((n) => n.slice(0, 4)).sort().join("+");
  return `${modo}:${raizItem}:${ncmBase}`;
}

function mvaNumFromPct(str) {
  if (!str) return null;
  const s = String(str).replace("%","").replace(",",".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Deriva o(s) registro(s) estruturado(s) exigido(s) pelo motor.
// Um item do Anexo 1 pode gerar MAIS DE UM registro quando o texto legal
// documenta redações anteriores — cada versão com a sua própria janela de
// vigência, UFs signatárias e MVAs.
function toRegistros(regra) {
  const ncms = extrairNCMsRegra(regra);
  const seg = inferirSegmento(regra);
  const acordo = inferirAcordo(regra);
  const versoes = parseVersoesTexto(regra.texto_original || "");
  const modo = modoDesambiguacaoDoItem(regra.item || regra.id);
  const grupo = grupoIdDe(regra, modo, ncms);

  return versoes.map((v, idx) => {
    const ufs = extrairUfsDeTexto(v.trecho) ;
    const mvasTrecho = extrairMvasDeTexto(v.trecho);
    const pick = (doTrecho, doCampo) =>
      mvaNumFromPct(v.atual ? (doCampo || doTrecho) : (doTrecho || doCampo));
    return {
      id: idx === 0 ? regra.id : `${regra.id}__V${idx}`,
      id_item: regra.id,
      tipo: (regra.tipo || "ICMS_ST").toUpperCase(),
      versao: idx,
      vigente: v.atual,
      item_ricms: regra.item || regra.id,
      modo_desambiguacao: modo,
      grupo_id: grupo,
      cest: regra.cest || null,
      ncm_patterns: ncms,
      descricao_legal: regra.descricao || "",
      segmento: seg,
      palavras_obrigatorias: [],
      sinonimos: derivarSinonimos(regra.descricao),
      palavras_excludentes: [],
      condicoes_obrigatorias: [],
      acordo,
      ufs_signatarias: ufs,
      vigencia_inicio: v.vigencia_inicio,
      vigencia_fim: v.vigencia_fim,
      mva_original: mvaNumFromPct(regra.mva_original),
      mva_ajustada_4: pick(mvasTrecho.mva_ajustada_4, regra.mva_ajustada_4),
      mva_ajustada_7: pick(mvasTrecho.mva_ajustada_7, regra.mva_ajustada_7),
      mva_ajustada_12: pick(mvasTrecho.mva_ajustada_12, regra.mva_ajustada_12),
      fonte: "RICMS/BA – Decreto 13.780/2012 – Anexo 1 (vig. 2026)",
      fundamento: regra.fundamento || "RICMS/BA Anexo 1",
    };
  });
}

let _REGISTRO_CACHE = null;
export function registroRegras() {
  if (_REGISTRO_CACHE) return _REGISTRO_CACHE;
  const base = RICMS_BA_ANEXO1
    .filter(r => (r.tipo || "").toUpperCase() === "ICMS_ST")
    .flatMap(toRegistros);

  // Desambiguação por embalagem/medida/teor/finalidade entre itens do mesmo NCM.
  // Calculada apenas entre as versões VIGENTES (uma por item), e replicada nas
  // versões históricas do mesmo item — a descrição do produto não muda com a data.
  const diferenciadores = derivarDiferenciadores(base.filter(r => r.versao === 0), { termosIgnorados: TERMOS_NEUTROS });
  const revisar = [];
  for (const reg of base) {
    const d = diferenciadores.get(reg.id_item);
    if (!d) continue;
    reg.palavras_obrigatorias = d.palavras_obrigatorias;
    reg.palavras_excludentes = d.palavras_excludentes;
    if (d.revisar && reg.versao === 0) revisar.push(d.revisar);
  }
  if (revisar.length) {
    // Não silenciamos: itens sem termo diferenciador seguro ficam registrados.
    _REGISTRO_REVISAR = revisar;
  }

  _REGISTRO_CACHE = base;
  return _REGISTRO_CACHE;
}

let _REGISTRO_REVISAR = [];
/** Itens que compartilham NCM e não têm termo diferenciador seguro. */
export function itensSemDiferenciador() {
  registroRegras();
  return _REGISTRO_REVISAR;
}

// Permite injetar regras adicionais em testes.
export function registrarRegrasExtras(regras) {
  _REGISTRO_CACHE = [...registroRegras(), ...regras];
}
export function _resetRegistroParaTeste(regrasSubstitutas) {
  _REGISTRO_CACHE = regrasSubstitutas ? [...regrasSubstitutas] : null;
  _REGISTRO_REVISAR = [];
}


// ---------- Validações auxiliares ------------------------------------

const CST_BLOQUEIA_ST = new Set(["40","41","50","60"]);
// CSOSN com semântica equivalente a bloqueio (ver MAPA_CSOSN em motorCST.js).
const CSOSN_BLOQUEIA_ST = {
  "300":"CSOSN 300 — Imune. ICMS-ST não deve ser calculado.",
  "400":"CSOSN 400 — Não tributada pelo Simples Nacional. ICMS-ST não deve ser calculado.",
  "500":"CSOSN 500 — ST/antecipação já recolhida anteriormente. Novo cálculo vedado.",
};
function detectarBloqueioCST(cstRaw) {
  const bruto = String(cstRaw || "").replace(/\D/g, "");
  if (bruto.length === 3 && CSOSN_BLOQUEIA_ST[bruto]) {
    return { bloqueia: true, cst: bruto, motivo: CSOSN_BLOQUEIA_ST[bruto] };
  }
  if (bruto.length === 3) return { bloqueia: false, cst: bruto };
  const cst = bruto.slice(-2);
  if (CST_BLOQUEIA_ST.has(cst)) {
    return {
      bloqueia: true,
      cst,
      motivo: {
        "40":"CST 40 — Operação isenta. ICMS-ST não deve ser calculado.",
        "41":"CST 41 — Operação não tributada. ICMS-ST não deve ser calculado.",
        "50":"CST 50 — Suspensão. ICMS-ST não deve ser calculado.",
        "60":"CST 60 — ST já retida anteriormente. Novo cálculo vedado.",
      }[cst],
    };
  }
  return { bloqueia: false, cst };
}


function validarUF(regra, ufOrigem, ufDestino) {
  const ufs = regra.ufs_signatarias || { modo: "TODOS", ufs: [] };
  if (ufs.modo === "TODOS_EXCETO") {
    if (ufOrigem && ufs.ufs.includes(ufOrigem)) {
      return { ok: false, motivo: `Origem ${ufOrigem} excluída pelo acordo (${regra.acordo || "—"}).` };
    }
    // A ST interestadual pressupõe que AMBAS as UFs sejam signatárias do
    // acordo. Ex.: SP foi excluído do Prot. ICM 11/91 a partir de 01/07/26.
    if (ufDestino && ufs.ufs.includes(ufDestino)) {
      return { ok: false, motivo: `Destino ${ufDestino} excluído pelo acordo (${regra.acordo || "—"}).` };
    }
  }
  return { ok: true };
}


// ---------- Grupo homogêneo não-textual ------------------------------

// POSICAO (4 díg.) é aceita porque o Anexo 1 define os itens de medicamentos
// e autopeças apenas em nível de posição ("3003 e 3004"); CAPITULO (2 díg.)
// nunca é suficiente — "é do capítulo de remédios" não confirma nada.
const NIVEIS_ACEITOS_GRUPO = new Set(["POSICAO", "SUBPOSICAO", "ITEM"]);

/**
 * Detecta o caso "com certeza é ST deste segmento, só não dá para saber
 * qual sub-item exato": todos os candidatos NCM-compatíveis pertencem ao
 * mesmo grupo_id, com modo de desambiguação não-textual.
 * Se dois grupos distintos disputarem o produto, retorna null (a ambiguidade
 * é entre segmentos, não entre sub-itens).
 */
export function detectarGrupoHomogeneoNaoTextual(rejeitados, compativeisOriginais) {
  const membros = (compativeisOriginais || []).filter((c) => c.scoreNCM?.ncm_compativel);
  if (!membros.length) return null;

  const grupos = new Map();
  for (const m of membros) {
    const g = m.regra.grupo_id || `TEXTUAL:${m.regra.id}`;
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(m);
  }
  if (grupos.size !== 1) return null; // disputa entre grupos → revisão normal

  const [grupo_id, candidatos] = [...grupos.entries()][0];
  const modo = candidatos[0].regra.modo_desambiguacao;
  if (!modo || modo === "TEXTUAL") return null;
  if (!candidatos.every((c) => c.regra.modo_desambiguacao === modo)) return null;
  if (!candidatos.every((c) => (c.regra.tipo || "ICMS_ST") === "ICMS_ST")) return null;
  if (!candidatos.every((c) => NIVEIS_ACEITOS_GRUPO.has(c.scoreNCM.nivel_correspondencia))) return null;

  return { grupo_id, modo_desambiguacao: modo, candidatos };
}

// ---------- Pipeline principal ---------------------------------------

/**
 * Classifica um produto quanto à Substituição Tributária.
 * @returns {{
 *   status: "ST_CONFIRMADA"|"ST_CONFIRMADA_MVA_PENDENTE"|"ST_SUGERIDA"|"REVISAO_NECESSARIA"|"NAO_ENQUADRADO"|"SEM_REGRA_POR_NCM",
 *   regra: object|null, candidatos_rejeitados: array,
 *   score_ncm: number, nivel_correspondencia: string,
 *   detalhes_por_digito: array, primeiro_conflito: object|null,
 *   evidencias_positivas: array, evidencias_negativas: array,
 *   condicoes_pendentes: array, bloqueio_cst: object|null,
 *   confianca: string, log: array,
 * }}
 */
/**
 * Seleciona a melhor MVA para ST de autopeças.
 * 1º) Anexo 1 do RICMS/BA  2º) fallback Convênio ICMS 142/18.
 * Retorna null quando nenhuma das duas fontes se aplica.
 */
export function selecionarMVAAutopecas(ncm, ufDestino, aliqInterestadual, aliqInterna, ufOrigem = null) {
  const ncmProd = normalizarNCM(ncm);
  if (!ncmProd) return null;

  // 1) Anexo 1 RICMS/BA tem prioridade absoluta.
  const regrasBA = registroRegras().filter(
    (r) => r.vigente !== false && (r.ncm_patterns || []).some((p) => {
      const pat = normalizarNCM(p);
      return pat && ncmProd.startsWith(pat);
    })
  );
  if (regrasBA.length > 0) {
    // Mais específica = maior prefixo casado
    const especificidade = (r) => Math.max(...(r.ncm_patterns || []).map((p) => {
      const pat = normalizarNCM(p);
      return pat && ncmProd.startsWith(pat) ? pat.length : 0;
    }));
    const regra = [...regrasBA].sort((a, b) => especificidade(b) - especificidade(a))[0];
    const mvaOrig = Number(regra.mva_original) || 0;
    const tabela = mvaAjustadaPor(regra, aliqInterestadual);
    return {
      mva: mvaOrig,
      mvaAjustada: Number(tabela) || mvaOrig,
      origem: "RICMS_BA",
      cest: regra.cest,
      regra: regra.item_ricms,
      fundamento: `RICMS/BA Anexo 1, item ${regra.item_ricms}`,
    };
  }

  // 2) Fallback: Convênio ICMS 142/18 (autopeças).
  const ufDest = String(ufDestino || "").toUpperCase();
  const ufOrig = String(ufOrigem || "").toUpperCase();
  if (!CONV_142_18.isAutopeca(ncmProd)) return null;
  if (ufDest && !CONV_142_18.isSignataria(ufDest)) return null;
  if (ufOrig && !CONV_142_18.isSignataria(ufOrig)) return null;
  if (CONV_142_18.temExclusao(ufDest, ncmProd)) return null;

  const interna = ufOrig && ufDest && ufOrig === ufDest;
  const mvaOrig = CONV_142_18.obterMVA(interna ? "interno" : "interestadual") * 100;
  const aInter = Number(aliqInterestadual);
  const aIntra = Number(aliqInterna);
  let mvaAjustada = mvaOrig;
  if (!isNaN(aInter) && !isNaN(aIntra) && aInter > 0 && aInter < aIntra && aIntra < 100) {
    mvaAjustada = +((((1 + mvaOrig / 100) * (1 - aInter / 100)) / (1 - aIntra / 100) - 1) * 100).toFixed(4);
  }
  return {
    mva: mvaOrig,
    mvaAjustada,
    origem: "CONV_142_18",
    cest: null,
    regra: "Conv. 142/18",
    fundamento: "Convênio ICMS 142/18 — Autopeças (fallback: NCM não regulamentado no Anexo 1 do RICMS/BA)",
  };
}

export function classificarProduto(input) {
  const {
    ncm, descricao, cest, cst, cfop, ufOrigem, ufDestino, valor,
    dataFatoGerador,
    regras: regrasCustom,
  } = input || {};

  const log = [];
  const dataRef = normalizarData(dataFatoGerador) || new Date();
  const registroBruto = regrasCustom || registroRegras();
  // Versionamento temporal: para cada item, mantém apenas a versão cuja
  // janela [vigencia_inicio, vigencia_fim) contém a data do fato gerador.
  const registro = registroBruto.filter((reg) => vigenteEm(reg, dataRef));
  log.push(`[VIGÊNCIA] Data do fato gerador: ${dataRef.toISOString().slice(0,10)} — ${registro.length} regra(s) vigente(s).`);
  const ncmProd = normalizarNCM(ncm);
  log.push(`[NCM] Produto normalizado: ${ncmProd || "—"}`);

  const bloqCST = detectarBloqueioCST(cst);
  if (bloqCST.bloqueia) log.push(`[CST] ${bloqCST.motivo}`);

  if (!ncmProd) {
    return baseResultado("SEM_REGRA_POR_NCM", { log, bloqueio_cst: bloqCST.bloqueia ? bloqCST : null,
      motivo: "NCM do produto ausente." });
  }

  // 1) filtra candidatos que compartilhem pelo menos o capítulo (2 díg.)
  const candidatosPreliminares = registro.filter(reg =>
    reg.ncm_patterns.some(pat => ncmProd.startsWith(pat.slice(0,2)))
  );

  if (!candidatosPreliminares.length) {
    return baseResultado("SEM_REGRA_POR_NCM", { log: [...log, "[NCM] Nenhuma regra candidata pelo capítulo."],
      bloqueio_cst: bloqCST.bloqueia ? bloqCST : null });
  }

  // 2) score dígito-a-dígito para cada candidata (escolhe alternativa mais específica)
  const avaliados = candidatosPreliminares.map(reg => {
    const { escolhida, historico } = melhorAlternativaNCM(ncmProd, reg.ncm_patterns);
    const scoreNCM = escolhida || historico.sort((a,b)=>b.score_ncm-a.score_ncm)[0];
    return { regra: reg, scoreNCM, historicoAlternativas: historico };
  });

  const compativeis = avaliados.filter(a => a.scoreNCM.ncm_compativel);
  const rejeitadosPorNCM = avaliados
    .filter(a => !a.scoreNCM.ncm_compativel)
    .map(a => ({
      regra: a.regra, motivo: a.scoreNCM.motivo,
      score_ncm: a.scoreNCM.score_ncm,
      primeiro_conflito: a.scoreNCM.primeiro_conflito,
    }));

  if (!compativeis.length) {
    return baseResultado("NAO_ENQUADRADO", {
      log: [...log, `[NCM] ${avaliados.length} candidata(s) rejeitadas por divergência de NCM.`],
      candidatos_rejeitados: rejeitadosPorNCM,
      bloqueio_cst: bloqCST.bloqueia ? bloqCST : null,
      motivo: "NCM não coincide com nenhuma regra legal aplicável.",
    });
  }

  // 3) valida descrição, UF, CEST em cada candidata compatível
  const enriquecidos = compativeis.map(({ regra, scoreNCM }) => {
    const desc = calcularScoreDescricao(descricao, regra);
    const uf = validarUF(regra, ufOrigem, ufDestino);
    let cestOK = true, cestNota = null;
    if (regra.cest && cest) {
      const a = String(cest).replace(/\D/g,"");
      const b = String(regra.cest).replace(/\D/g,"");
      if (a && b && a !== b && !a.startsWith(b.slice(0,5)) && !b.startsWith(a.slice(0,5))) {
        cestOK = false; cestNota = `CEST divergente (produto ${a} × regra ${b}).`;
      } else if (a === b) {
        cestNota = "CEST idêntico ao da regra.";
      }
    }
    return { regra, scoreNCM, desc, uf, cestOK, cestNota };
  });

  // REGRA PRINCIPAL: o NCM é soberano. Se o enquadramento proporcional de NCM
  // for conclusivo (todos os dígitos legislados coincidem), CEST e descrição
  // são ignorados — só a UF continua sendo condição de aplicabilidade legal.
  const ncmSoberano = (x) => x.scoreNCM?.ncm_compativel && Number(x.scoreNCM?.score_ncm) >= 100;

  const validos = enriquecidos.filter(x => x.uf.ok && (ncmSoberano(x) || (x.desc.compativel && x.cestOK)));
  const rejeitadosDetalhados = enriquecidos
    .filter(x => !(x.uf.ok && (ncmSoberano(x) || (x.desc.compativel && x.cestOK))))
    .map(x => ({
      regra: x.regra,
      motivo: [
        !x.desc.compativel ? "Descrição incompatível." : null,
        !x.uf.ok ? x.uf.motivo : null,
        !x.cestOK ? x.cestNota : null,
      ].filter(Boolean).join(" "),
      score_ncm: x.scoreNCM.score_ncm,
      evidencias_negativas: x.desc.evidencias_negativas,
    }));

  const todosRejeitados = [...rejeitadosPorNCM, ...rejeitadosDetalhados];

  // Ambiguidade de MVA entre irmãos do mesmo NCM: mesmo com NCM soberano,
  // a escolha do sub-item (e portanto da MVA) depende de dado externo.
  const assinaturaMVA = (x) => [x.regra.mva_ajustada_4, x.regra.mva_ajustada_7, x.regra.mva_ajustada_12].join("|");
  let ambiguidadeMVA = validos.length > 1
    && new Set(validos.map(assinaturaMVA)).size > 1;

  if (ambiguidadeMVA) {
    // Desempate textual: quando a descrição/CEST distinguem os irmãos,
    // ela volta a ser usada apenas para escolher o sub-item (nunca para
    // negar o enquadramento já definido pelo NCM).
    const desempatados = validos.filter((x) => x.desc.compativel && x.cestOK);
    if (desempatados.length && new Set(desempatados.map(assinaturaMVA)).size === 1) {
      validos.length = 0;
      validos.push(...desempatados);
      ambiguidadeMVA = false;
    }
  }

  if (!validos.length || ambiguidadeMVA) {
    // A incerteza pode ser apenas de SUB-ITEM: o NCM confirma o segmento
    // inteiro, mas a lei distingue os irmãos por um dado externo à nota.
    const grupoHomogeneo = detectarGrupoHomogeneoNaoTextual(rejeitadosDetalhados, compativeis);
    if (grupoHomogeneo) {
      const mvasMin = grupoHomogeneo.candidatos
        .map((c) => c.regra.mva_ajustada_12).filter((v) => v != null);
      const mvasMax = grupoHomogeneo.candidatos
        .map((c) => c.regra.mva_ajustada_4).filter((v) => v != null);
      return baseResultado("ST_CONFIRMADA_MVA_PENDENTE", {
        log: [...log, `[Desambiguação] NCM confirma o segmento "${grupoHomogeneo.grupo_id}", mas ${grupoHomogeneo.modo_desambiguacao} não é resolvível pela descrição da nota.`],
        candidatos_rejeitados: todosRejeitados,
        candidatos_mva: grupoHomogeneo.candidatos.map((c) => ({
          id: c.regra.id,
          item_ricms: c.regra.item_ricms,
          cest: c.regra.cest,
          descricao_legal: c.regra.descricao_legal,
          mva_ajustada_4: c.regra.mva_ajustada_4,
          mva_ajustada_7: c.regra.mva_ajustada_7,
          mva_ajustada_12: c.regra.mva_ajustada_12,
          fundamento: c.regra.fundamento,
        })),
        mva_faixa: {
          minima: mvasMin.length ? Math.min(...mvasMin) : null,
          maxima: mvasMax.length ? Math.max(...mvasMax) : null,
        },
        grupo_id: grupoHomogeneo.grupo_id,
        modo_desambiguacao: grupoHomogeneo.modo_desambiguacao,
        dado_necessario: grupoHomogeneo.modo_desambiguacao === "REFERENCIA_EXTERNA"
          ? "Registro ANVISA ou GTIN/EAN do produto, consultado contra a lista positiva/negativa/neutra vigente."
          : "Confirmação do relacionamento comercial (ex.: contrato de fidelidade) com o fornecedor.",
        motivo: "ICMS-ST aplicável com alta confiança (NCM compatível para todo o grupo). MVA exato depende de dado externo ao produto.",
        confianca: "ALTA_SUBITEM_PENDENTE",
        ncm_produto: ncmProd,
        score_ncm: 100,
        nivel_correspondencia: grupoHomogeneo.candidatos[0].scoreNCM.nivel_correspondencia,
        bloqueio_cst: bloqCST.bloqueia ? bloqCST : null,
      });
    }
    return baseResultado("REVISAO_NECESSARIA", {
      log: [...log, "[Descrição/UF/CEST] Candidatos compatíveis por NCM não passaram nos filtros."],
      candidatos_rejeitados: todosRejeitados,
      bloqueio_cst: bloqCST.bloqueia ? bloqCST : null,
      motivo: "NCM compatível, porém descrição/UF/CEST não confirmam a regra.",
    });
  }

  // 4) escolhe o melhor: NCM soberano primeiro, depois nº de dígitos legislados
  //    e, só como desempate residual, o score de descrição.
  validos.sort((a, b) => {
    const s = (ncmSoberano(b) ? 1 : 0) - (ncmSoberano(a) ? 1 : 0);
    if (s) return s;
    const d = b.scoreNCM.digitos_regra - a.scoreNCM.digitos_regra;
    if (d) return d;
    return b.desc.score - a.desc.score;
  });
  const escolhido = validos[0];
  const restantes = validos.slice(1);
  const multiplos = validos.length > 1;
  const ncmDecisivo = ncmSoberano(escolhido);

  const evidenciasPos = [
    ...(ncmDecisivo ? [] : escolhido.desc.evidencias_positivas),
    escolhido.cestNota && escolhido.cestOK ? escolhido.cestNota : null,
    `NCM compatível a nível ${escolhido.scoreNCM.nivel_correspondencia} (${escolhido.scoreNCM.digitos_regra} díg.).`,
    ncmDecisivo
      ? `Enquadramento definido pelo NCM (${escolhido.scoreNCM.tipo_compatibilidade || "COMPLETO"}): CEST e descrição desconsiderados por regra de precedência.`
      : null,
  ].filter(Boolean);
  const evidenciasNeg = ncmDecisivo ? [] : [...escolhido.desc.evidencias_negativas];

  // 5) status final
  let status;
  const condicoesPendentes = [];
  if (bloqCST.bloqueia) {
    // regra existe e casaria, mas CST bloqueia cálculo automático
    status = "REVISAO_NECESSARIA";
    condicoesPendentes.push(bloqCST.motivo);
  } else if (multiplos && restantes[0].scoreNCM.digitos_regra === escolhido.scoreNCM.digitos_regra
             && ncmSoberano(restantes[0]) === ncmDecisivo
             && escolhido.regra.id !== restantes[0].regra.id
             && (!ncmDecisivo
                 || escolhido.regra.mva_ajustada_12 !== restantes[0].regra.mva_ajustada_12)) {
    status = "REVISAO_NECESSARIA";
    condicoesPendentes.push(`Existem ${validos.length} regras candidatas com a mesma especificidade — decisão manual necessária.`);
  } else if (ncmDecisivo) {
    // REGRA PRINCIPAL: NCM conclusivo confirma o ST sem depender de descrição/CEST.
    status = "ST_CONFIRMADA";
  } else if (escolhido.desc.compativel) {
    // Palavras obrigatórias confirmadas OU alta sobreposição semântica confirmam ST.
    status = escolhido.desc.score >= 60 || (escolhido.regra.palavras_obrigatorias || []).length > 0
      ? "ST_CONFIRMADA"
      : "ST_SUGERIDA";
    if (status === "ST_SUGERIDA") condicoesPendentes.push("Descrição comercial provável, mas sem termos legais explícitos — validar manualmente.");
  } else {
    status = "ST_SUGERIDA";
    condicoesPendentes.push("Descrição comercial provável, mas sem termos legais explícitos — validar manualmente.");
  }


  const confianca = status === "ST_CONFIRMADA" ? "ALTA"
                  : status === "ST_SUGERIDA"    ? "MEDIA"
                  : "REVISAR";

  return {
    status,
    regra: escolhido.regra,
    candidatos_rejeitados: todosRejeitados,
    candidatos_alternativos: restantes.map(x => ({ regra: x.regra, score_ncm: x.scoreNCM.score_ncm })),
    score_ncm: escolhido.scoreNCM.score_ncm,
    ncm_produto: ncmProd,
    ncm_regra: escolhido.scoreNCM.ncm_regra,
    nivel_correspondencia: escolhido.scoreNCM.nivel_correspondencia,
    detalhes_por_digito: escolhido.scoreNCM.detalhes_por_digito,
    primeiro_conflito: escolhido.scoreNCM.primeiro_conflito,
    evidencias_positivas: evidenciasPos,
    evidencias_negativas: evidenciasNeg,
    condicoes_pendentes: condicoesPendentes,
    bloqueio_cst: bloqCST.bloqueia ? bloqCST : null,
    confianca,
    log,
  };
}

function baseResultado(status, extra) {
  return {
    status,
    regra: null,
    candidatos_rejeitados: [],
    candidatos_alternativos: [],
    score_ncm: 0,
    ncm_produto: extra?.ncm_produto || "",
    ncm_regra: "",
    nivel_correspondencia: "INSUFICIENTE",
    detalhes_por_digito: [],
    primeiro_conflito: null,
    evidencias_positivas: [],
    evidencias_negativas: extra?.motivo ? [extra.motivo] : [],
    condicoes_pendentes: [],
    bloqueio_cst: extra?.bloqueio_cst || null,
    confianca: "BAIXA",
    log: extra?.log || [],
    ...extra,
  };
}

// Helper: retorna somente o objeto de MVAs ajustadas para uma alíquota destacada.
export function mvaAjustadaPor(regra, aliqDestacada) {
  const a = Number(aliqDestacada);
  if (a <= 4) return regra.mva_ajustada_4;
  if (a <= 7) return regra.mva_ajustada_7;
  return regra.mva_ajustada_12;
}
