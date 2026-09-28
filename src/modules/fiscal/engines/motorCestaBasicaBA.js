// ============================================================
// MOTOR DE IDENTIFICAÇÃO — CESTA BÁSICA DA BAHIA
// ------------------------------------------------------------
// Identifica se o produto pertence à base de produtos da Cesta
// Básica de Salvador/BA (SEI, 25 itens) usando o NCM como CHAVE
// PRINCIPAL, na ordem:
//   NCM EXATO → SUBPOSIÇÃO (6) → POSIÇÃO (4) → DESCRIÇÃO FISCAL
//
// REGRAS DURAS:
//  · A descrição NUNCA concede benefício sozinha — apenas SUGERE análise.
//  · Pertencer à cesta ≠ ter benefício fiscal. O tratamento tributário
//    vem da matriz (tipoBeneficio/fundamentoLegal) e só se aplica quando
//    todas as condições legais forem atendidas.
//  · Nunca alterar CST/CFOP originais da NF-e — apenas registrar
//    divergências com o fundamento correspondente.
// ============================================================
import { MATRIZ_CESTA_BASICA_BA } from "../data/cestaBasicaBA";

/** Remove pontuação e normaliza o NCM para 8 dígitos. */
export function normalizarNCMCesta(ncm) {
  const d = String(ncm ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length >= 8 ? d.slice(0, 8) : d;
}

function normalizarTextoCesta(txt) {
  return String(txt ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const familias = (item) => (item.ncmFamilia || []).map((f) => String(f).replace(/\D/g, ""));

/**
 * Identifica o produto da cesta básica.
 * @returns {{item:object|null, nivel:"NCM_EXATO"|"SUBPOSICAO"|"POSICAO"|"DESCRICAO"|"NAO_IDENTIFICADO", candidatos:object[], ncmNormalizado:string, confiavel:boolean}}
 */
export function identificarProdutoCesta({ ncm, descricao } = {}) {
  const n = normalizarNCMCesta(ncm);
  const desc = normalizarTextoCesta(descricao);
  const vazio = { item: null, nivel: "NAO_IDENTIFICADO", candidatos: [], ncmNormalizado: n, confiavel: false };

  const ordenar = (lista) => [...lista].sort((a, b) => (a.prioridade || 100) - (b.prioridade || 100));

  if (n.length === 8) {
    // 1) NCM exato
    const exatos = MATRIZ_CESTA_BASICA_BA.filter((i) => (i.ncm || []).includes(n));
    if (exatos.length) {
      const lista = ordenar(exatos);
      return { item: lista[0], nivel: "NCM_EXATO", candidatos: lista, ncmNormalizado: n, confiavel: true };
    }
    // 2) Subposição (6 dígitos)
    const sub = MATRIZ_CESTA_BASICA_BA.filter(
      (i) => familias(i).includes(n.slice(0, 6)) || (i.ncm || []).some((c) => c.slice(0, 6) === n.slice(0, 6)),
    );
    if (sub.length) {
      const lista = ordenar(sub);
      return { item: lista[0], nivel: "SUBPOSICAO", candidatos: lista, ncmNormalizado: n, confiavel: lista.length === 1 };
    }
    // 3) Posição (4 dígitos)
    const pos = MATRIZ_CESTA_BASICA_BA.filter(
      (i) => familias(i).includes(n.slice(0, 4)) || (i.ncm || []).some((c) => c.slice(0, 4) === n.slice(0, 4)),
    );
    if (pos.length) {
      const lista = ordenar(pos);
      return { item: lista[0], nivel: "POSICAO", candidatos: lista, ncmNormalizado: n, confiavel: false };
    }
  }

  // 4) Descrição — apenas sugere análise, nunca concede benefício
  if (desc) {
    const porDesc = MATRIZ_CESTA_BASICA_BA.filter((i) =>
      (i.palavrasChave || []).some((p) => desc.includes(normalizarTextoCesta(p))),
    );
    if (porDesc.length) {
      const lista = ordenar(porDesc);
      return { item: lista[0], nivel: "DESCRICAO", candidatos: lista, ncmNormalizado: n, confiavel: false };
    }
  }

  return vazio;
}

function vigente(item, dataRef) {
  const d = dataRef ? new Date(dataRef) : new Date();
  if (item.vigenciaInicio && d < new Date(item.vigenciaInicio)) return false;
  if (item.vigenciaFim && d > new Date(item.vigenciaFim)) return false;
  return true;
}

/**
 * Avaliação completa: responde às perguntas do motor e devolve
 * memória de cálculo auditável, sem alterar CST/CFOP do XML.
 *
 * @param {object} entrada { ncm, descricao, cfop, cst, csosn, ufOrigem, ufDestino, dataEmissao, gate }
 */
export function avaliarCestaBasicaBA(entrada = {}) {
  const {
    ncm, descricao, cfop, cst, csosn,
    ufOrigem, ufDestino, dataEmissao, gate,
  } = entrada;

  const ident = identificarProdutoCesta({ ncm, descricao });
  const item = ident.item;
  const memoria = [];
  const divergencias = [];

  const ufO = String(ufOrigem || "").toUpperCase();
  const ufD = String(ufDestino || "").toUpperCase();
  const operacaoInterna = !!ufO && ufO === ufD;
  const destinoBA = ufD === "BA";

  if (!item) {
    memoria.push(`Cesta Básica/BA: produto não identificado na matriz (NCM ${ident.ncmNormalizado || "—"}).`);
    return {
      pertenceCesta: false,
      produto: null,
      ncm: ident.ncmNormalizado,
      nivelIdentificacao: ident.nivel,
      candidatos: [],
      operacaoInterna,
      destinoBA,
      condicoesAtendidas: null,
      beneficio: null,
      tipoBeneficio: null,
      fundamentoLegal: null,
      calcularIcmsProprio: gate ? !!gate?.liberado?.ICMS_PROPRIO : null,
      calcularIcmsST: gate ? !!gate?.liberado?.ICMS_ST : null,
      conflitoCstCfop: !!gate?.conflito,
      divergencias,
      revisaoManual: false,
      memoria,
    };
  }

  memoria.push(
    `Cesta Básica/BA: NCM ${ident.ncmNormalizado || "—"} → ${item.nome} (${item.categoria}) · ` +
    `identificação por ${ident.nivel}${ident.confiavel ? "" : " — requer confirmação"}.`,
  );

  // Divergência NCM × descrição (prioridade do NCM sobre a descrição)
  const desc = normalizarTextoCesta(descricao);
  if (desc && ident.nivel !== "DESCRICAO") {
    const casaDescricao = (item.palavrasChave || []).some((p) => desc.includes(normalizarTextoCesta(p)));
    const outro = MATRIZ_CESTA_BASICA_BA.find(
      (i) => i.codigo !== item.codigo && (i.palavrasChave || []).some((p) => desc.includes(normalizarTextoCesta(p))),
    );
    if (!casaDescricao && outro) {
      divergencias.push({
        tipo: "DIVERGENCIA_CLASSIFICACAO",
        mensagem: `Descrição sugere "${outro.nome}", mas o NCM ${ident.ncmNormalizado} enquadra "${item.nome}". Prevalece o NCM; benefício não concedido automaticamente.`,
      });
    }
  }
  if (ident.nivel === "DESCRICAO") {
    divergencias.push({
      tipo: "IDENTIFICACAO_POR_DESCRICAO",
      mensagem: `Produto sugerido como "${item.nome}" apenas pela descrição — NCM ${ident.ncmNormalizado || "não informado"} não consta na matriz. Análise manual necessária; benefício não aplicado automaticamente.`,
    });
  }
  if (ident.candidatos.length > 1) {
    divergencias.push({
      tipo: "MULTIPLOS_CANDIDATOS",
      mensagem: `NCM compatível com mais de um item da cesta (${ident.candidatos.map((c) => c.nome).join(", ")}) — confirmar características do produto.`,
    });
  }

  const ufOk = (!item.ufOrigem?.length || !ufO || item.ufOrigem.includes(ufO)) &&
    (!item.ufDestino?.length || !ufD || item.ufDestino.includes(ufD));
  const operacaoOk = !item.tipoOperacao?.length || (operacaoInterna
    ? item.tipoOperacao.includes("INTERNA")
    : item.tipoOperacao.includes("INTERESTADUAL"));
  const naVigencia = vigente(item, dataEmissao);

  // Benefício só existe quando a matriz o define E todas as condições
  // legais são atendidas E a identificação é confiável (NCM exato/subposição única).
  const condicoesAtendidas = ufOk && operacaoOk && naVigencia && ident.confiavel && !divergencias.length;
  const beneficioCadastrado = !!item.tipoBeneficio;
  const beneficioAplicavel = beneficioCadastrado && condicoesAtendidas;

  if (!beneficioCadastrado) {
    memoria.push(
      `Cesta Básica/BA: ${item.nome} pertence à base de produtos da cesta, porém sem benefício fiscal cadastrado na matriz — ` +
      `tratamento tributário permanece o da NF-e (nenhuma alteração aplicada).`,
    );
  } else {
    memoria.push(
      beneficioAplicavel
        ? `Cesta Básica/BA: benefício ${item.tipoBeneficio} aplicável · Fundamento: ${item.fundamentoLegal || "—"}.`
        : `Cesta Básica/BA: benefício ${item.tipoBeneficio} NÃO aplicado — condições legais não atendidas (UF ${ufO}→${ufD}, operação ${operacaoInterna ? "interna" : "interestadual"}${naVigencia ? "" : ", fora de vigência"}).`,
    );
  }
  (item.condicoes || []).forEach((c) => memoria.push(`Cesta Básica/BA · condição: ${c}`));
  divergencias.forEach((d) => memoria.push(`Cesta Básica/BA · ${d.tipo}: ${d.mensagem}`));

  if (gate?.conflito) {
    memoria.push("Cesta Básica/BA: há conflito entre CST/CSOSN e CFOP registrado pelo gate tributário.");
  }

  return {
    pertenceCesta: true,
    produto: { codigo: item.codigo, nome: item.nome, categoria: item.categoria },
    ncm: ident.ncmNormalizado,
    nivelIdentificacao: ident.nivel,
    candidatos: ident.candidatos.map((c) => ({ codigo: c.codigo, nome: c.nome })),
    cfop: cfop ?? null,
    cst: cst ?? csosn ?? null,
    operacaoInterna,
    destinoBA,
    naVigencia,
    condicoesAtendidas,
    caracteristicasExigidas: item.condicoes || [],
    excecoes: item.excecoes || [],
    beneficio: beneficioAplicavel ? { tipo: item.tipoBeneficio, fundamento: item.fundamentoLegal } : null,
    tipoBeneficio: beneficioAplicavel ? item.tipoBeneficio : null,
    fundamentoLegal: beneficioAplicavel ? item.fundamentoLegal : null,
    calculosProibidos: beneficioAplicavel ? item.calculosProibidos || [] : [],
    calcularIcmsProprio: gate ? !!gate?.liberado?.ICMS_PROPRIO : null,
    calcularIcmsST: gate ? !!gate?.liberado?.ICMS_ST : null,
    conflitoCstCfop: !!gate?.conflito,
    divergencias,
    revisaoManual: !ident.confiavel || divergencias.length > 0,
    memoria,
  };
}

export { MATRIZ_CESTA_BASICA_BA };
