// ============================================================
// GATE TRIBUTÁRIO — LIBERAÇÃO DE CÁLCULO
// ------------------------------------------------------------
// Executa a ordem lógica obrigatória ANTES de qualquer fórmula:
//   CLASSIFICAÇÃO
//   → INTERPRETA CST/CSOSN
//   → INTERPRETA CFOP
//   → VERIFICA INCIDÊNCIA
//   → VERIFICA SE O ICMS JÁ FOI RECOLHIDO POR ST
//   → VERIFICA BENEFÍCIOS/EXCEÇÕES
//   → DECIDE SE O CÁLCULO ESTÁ LIBERADO
//
// Não altera as regras de CST/CSOSN: apenas as cruza com a nova
// camada de CFOP e devolve a decisão + memória auditável.
// ============================================================
import { interpretarCST, validarCFOPxCST } from "./motorCST";
import { interpretarCFOP } from "./motorCFOP";

export const TRIBUTOS = ["ICMS_PROPRIO", "ICMS_ST", "DIFAL", "ANTECIPACAO"];

const num = (v) => Number(v) || 0;

function proibe(perm, tributo) {
  const lista = perm?.calculosProibidos || [];
  if (lista.includes(tributo)) return true;
  if (tributo === "ICMS_ST" && lista.includes("ICMS_ST_NOVO")) return true;
  return false;
}

/**
 * @param {object} entrada
 *  cst, cfop, ncm, cest, permCST?, permCFOP?
 *  valorIcmsStXml, valorIcmsStRetido, valorIcmsXml
 *  sujeitoST (bool) — NCM/CEST está no regime de ST
 *  valoresEstimados: { ICMS_PROPRIO, ICMS_ST, ... } (opcional)
 */
export function avaliarLiberacaoCalculo(entrada = {}) {
  const {
    cst, cfop, ncm = "", cest = "",
    valorIcmsStXml = 0, valorIcmsStRetido = 0,
    sujeitoST = false, valoresEstimados = {},
  } = entrada;

  const permCST = entrada.permCST || interpretarCST(cst);
  const permCFOP = entrada.permCFOP || interpretarCFOP(cfop);
  const processadoEm = new Date().toISOString();

  const log = [...(permCST.log || []), ...(permCFOP.log || [])];
  const bloqueios = [];
  const liberado = {};

  const registrar = (tributo, regra, motivo, fundamento) => {
    bloqueios.push({
      status: "BLOQUEADO",
      tributo,
      cfop: permCFOP.codigo || String(cfop || ""),
      cst: permCST.codigo_informado || permCST.codigo,
      cst_interpretado: permCST.codigo,
      ncm: ncm || null,
      cest: cest || null,
      regra,
      fundamento,
      valor_estimado: valoresEstimados[tributo] ?? null,
      valor_calculado: 0,
      motivo,
      processado_em: processadoEm,
    });
    log.push(`[BLOQUEIO] ${tributo}: ${motivo}`);
  };

  // --- VERIFICA INCIDÊNCIA + PROIBIÇÕES ----------------------
  TRIBUTOS.forEach((t) => {
    let ok = true;
    if (proibe(permCST, t)) {
      ok = false;
      registrar(t, `CST/CSOSN ${permCST.codigo}`,
        `Cálculo bloqueado pelo CST/CSOSN ${permCST.codigo} (${permCST.nome}).`,
        permCST.fundamento);
    }
    if (proibe(permCFOP, t)) {
      if (ok) {
        registrar(t, `CFOP ${permCFOP.codigo}`,
          permCFOP.titulo
            ? `Cálculo bloqueado: CFOP ${permCFOP.codigo} é código-título da EFD e não pode ser usado em lançamento real.`
            : `Cálculo de ${t === "ICMS_ST" ? "ICMS-ST" : "ICMS"} bloqueado pelo CFOP: operação classificada como não geradora de ICMS (${permCFOP.nome}).`,
          permCFOP.fundamento);
      }
      ok = false;
    }
    liberado[t] = ok;
  });

  // --- VERIFICA SE O ICMS-ST JÁ FOI RECOLHIDO ----------------
  const stJaRecolhida =
    !!permCST.stRetidaAnterior ||
    !!permCFOP.stJaRecolhida ||
    num(valorIcmsStRetido) > 0;

  if (stJaRecolhida && liberado.ICMS_ST) {
    liberado.ICMS_ST = false;
    const origem = permCST.stRetidaAnterior
      ? `CST ${permCST.codigo} (ST retida anteriormente)`
      : permCFOP.stJaRecolhida
        ? `CFOP ${permCFOP.codigo} (contribuinte substituído)`
        : "ICMS-ST retido informado no XML";
    registrar("ICMS_ST", origem,
      `Cálculo de ICMS-ST bloqueado: ICMS-ST já identificado/recolhido na operação (${origem}).`,
      permCST.stRetidaAnterior ? permCST.fundamento : permCFOP.fundamento);
  }

  // --- REGIME DE ST ≠ ST DEVIDA NESTA OPERAÇÃO ---------------
  // A simples existência de NCM/CEST sujeito à ST não libera cálculo.
  const stDevidaNestaOperacao =
    liberado.ICMS_ST && sujeitoST && !stJaRecolhida &&
    permCFOP.geraICMS !== false;

  if (sujeitoST && !stDevidaNestaOperacao && !bloqueios.some((b) => b.tributo === "ICMS_ST")) {
    liberado.ICMS_ST = false;
    registrar("ICMS_ST", "Regime de ST × operação",
      "Produto pertence ao regime de ST, mas a operação atual não exige novo cálculo de ICMS-ST.",
      permCFOP.fundamento);
  }

  // --- CONFLITOS / INCONSISTÊNCIAS ---------------------------
  const cruzada = validarCFOPxCST({ permCST, permCFOP, cfop, ncm, cest });
  cruzada.advertencias.forEach((a) => log.push(`[AVISO] ${a.tipo}: ${a.mensagem}`));

  const revisaoManual = permCFOP.geraICMS === null || permCFOP.titulo;

  return {
    permCST,
    permCFOP,
    liberado,
    bloqueios,
    advertencias: cruzada.advertencias,
    conflito: cruzada.advertencias.some((a) => a.tipo.startsWith("CST_x_CFOP")),
    stJaRecolhida,
    valor_icms_st_xml: num(valorIcmsStXml),
    stDevidaNestaOperacao,
    revisaoManual,
    processado_em: processadoEm,
    log,
    memoria: [
      `CST/CSOSN ${permCST.codigo_informado || permCST.codigo} → ${permCST.nome}`,
      `CFOP ${permCFOP.codigo || "—"} → ${permCFOP.nome} (geraICMS: ${permCFOP.geraICMS === null ? "indefinido" : permCFOP.geraICMS})`,
      ...bloqueios.map((b) => `BLOQUEADO ${b.tributo} — ${b.motivo} · Fundamento: ${b.fundamento}`),
      ...cruzada.advertencias.map((a) => `INCONSISTÊNCIA ${a.tipo} — ${a.mensagem}`),
    ],
  };
}

/** Atalho booleano usado pelos Services antes de executar a fórmula. */
export function calculoLiberado(avaliacao, tributo) {
  return !!avaliacao?.liberado?.[tributo];
}
