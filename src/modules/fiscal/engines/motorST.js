// ============================================================
// MOTOR INTELIGENTE DE IDENTIFICAÇÃO DE ICMS-ST + CÁLCULO POR PAUTA
// Baseado em:
//   - CONVÊNIO ICMS 142/18 (normas gerais ST – CEST/segmentos)
//   - PROTOCOLO ICMS 41/08 e 97/10 (autopeças interestadual)
//   - regra_icms_st_pmc (prioridade PMC > PMPF > MVA)
//   - motor_identificacao_st_completo v3.0 (hierarquia CEST→NCM→DESC→SEGMENTO)
// ============================================================

import { resolverPauta } from "./motorPauta";

// --- normalização textual ----------------------------------------
export function normalizarTexto(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// --- segmentos (Convênio 142/18 – simplificado) -----------------
export const SEGMENTOS_ST = [
  { nome: "Medicamentos", usar_pmc: true, palavras: ["medicamento","remedio","comprimido","capsula","xarope","farmaco","drogaria","antibiotico","analgesico"] },
  { nome: "Autopecas", protocolo: "41/08 e 97/10", palavras: ["filtro","pastilha","vela","embreagem","rolamento","amortecedor","retentor","correia","disco freio","bateria automotiva","oleo lubrificante","junta motor","mangueira","pivot","bucha","coxim","valvula injecao"] },
  { nome: "Cosmeticos", palavras: ["shampoo","creme","perfume","desodorante","sabonete","colonia","hidratante","esmalte","batom"] },
  { nome: "Bebidas", palavras: ["cerveja","refrigerante","agua mineral","bebida","energetico","isotonico","vinho","cachaca","whisky","vodka"] },
  { nome: "Cigarros", palavras: ["cigarro","charuto","cigarrilha","tabaco"] },
  { nome: "Combustiveis", palavras: ["gasolina","diesel","etanol","gnv","querosene","oleo combustivel"] },
  { nome: "MateriaisConstrucao", palavras: ["cimento","argamassa","telha","tijolo","cal hidratada","piso ceramico","azulejo"] },
  { nome: "Sorvetes", palavras: ["sorvete","picole","gelato"] },
  { nome: "Pneus", palavras: ["pneu","camara de ar","protetor de pneu"] },
];

// --- prefixos NCM tipicamente sujeitos a ST (Convênio 142/18 Anexos) ---
// Não exaustivo, mas cobre os capítulos mais críticos.
const NCM_ST_PREFIXOS = [
  { prefixo: "2201", segmento: "Bebidas" },
  { prefixo: "2202", segmento: "Bebidas" },
  { prefixo: "2203", segmento: "Bebidas" },
  { prefixo: "2204", segmento: "Bebidas" },
  { prefixo: "2205", segmento: "Bebidas" },
  { prefixo: "2206", segmento: "Bebidas" },
  { prefixo: "2207", segmento: "Bebidas" },
  { prefixo: "2208", segmento: "Bebidas" },
  { prefixo: "2402", segmento: "Cigarros" },
  { prefixo: "2403", segmento: "Cigarros" },
  { prefixo: "2710", segmento: "Combustiveis" },
  { prefixo: "2105", segmento: "Sorvetes" },
  { prefixo: "2523", segmento: "MateriaisConstrucao" },
  { prefixo: "3003", segmento: "Medicamentos" },
  { prefixo: "3004", segmento: "Medicamentos" },
  { prefixo: "3208", segmento: "Tintas" },
  { prefixo: "3303", segmento: "Cosmeticos" },
  { prefixo: "3304", segmento: "Cosmeticos" },
  { prefixo: "3305", segmento: "Cosmeticos" },
  { prefixo: "3307", segmento: "Cosmeticos" },
  { prefixo: "4011", segmento: "Pneus" },
  { prefixo: "8539", segmento: "Lampadas" },
  { prefixo: "8708", segmento: "Autopecas" }, // Protocolo 41/08 e 97/10
  { prefixo: "8512", segmento: "Autopecas" },
  { prefixo: "8511", segmento: "Autopecas" },
  { prefixo: "8483", segmento: "Autopecas" },
  { prefixo: "8482", segmento: "Autopecas" },
  { prefixo: "4016", segmento: "Autopecas" },
  { prefixo: "8409", segmento: "Autopecas" },
];

function ncmDigits(n) { return String(n || "").replace(/\D/g, ""); }
function cstDigits(c) { return String(c || "").replace(/\D/g, ""); }

// CSTs / CSOSNs que indicam operação com ST
export const CST_ST_FORTE = new Set(["10","30","60","70","201","202","203","500"]);
export const CST_ST_FRACO = new Set(["90","900"]); // possível ST, sem confirmação

// ---- Helpers unificados da matriz NCM60/Desc30/CST10 -----------
// Toda classificação de ICMS-ST (sugestão OU regra cadastrada)
// deve passar por estas funções para garantir os MESMOS thresholds.
export function scoreCSTMatriz(cstRaw) {
  const cst = cstDigits(cstRaw);
  if (!cst) return { score: 0, nivel: "NAO_INFORMADO", cst };
  if (CST_ST_FORTE.has(cst)) return { score: 10, nivel: "COMPATIVEL_ST", cst };
  if (CST_ST_FRACO.has(cst)) return { score: 5,  nivel: "POSSIVEL_ST",  cst };
  return { score: 0, nivel: "INCOMPATIVEL", cst };
}

// Classificação oficial – aplicada em identificarST e scoreRegraST
export function classificarMatrizST({ scoreNcm = 0, scoreDesc = 0, scoreCst = 0, cestExato = false } = {}) {
  let score = Math.max(0, Math.min(100, scoreNcm + scoreDesc + scoreCst));
  // CEST exato = confirmação oficial → eleva a 90 no mínimo
  if (cestExato) score = Math.max(score, 90);
  let classificacao;
  if (score > 80)      classificacao = scoreNcm >= 45 ? "CLASSIFICAR_ST" : "VALIDACAO_MANUAL";
  else if (score >= 66) classificacao = "ALTA_PROBABILIDADE";
  else if (score >= 46) classificacao = "BAIXA_MEDIA_PROBABILIDADE";
  else                  classificacao = "NAO_SUGERIR";
  const status =
    classificacao === "CLASSIFICAR_ST"           ? "ST_CONFIRMADA" :
    classificacao === "ALTA_PROBABILIDADE"       ? "ALTA_PROBABILIDADE" :
    classificacao === "BAIXA_MEDIA_PROBABILIDADE"? "BAIXA_MEDIA_PROBABILIDADE" :
    classificacao === "VALIDACAO_MANUAL"         ? "VALIDACAO_MANUAL" :
                                                   "SEM_CONFIRMACAO";
  return { score, classificacao, status };
}

// ============================================================
// IDENTIFICAÇÃO HIERÁRQUICA (motor v4.0 — matriz NCM60/Desc30/CST10)
// ============================================================
export function identificarST(produto) {
  const ncm = ncmDigits(produto.ncm);
  const cest = ncmDigits(produto.cest);
  const cst = cstDigits(produto.cst || produto.CST || produto.csosn);
  const desc = normalizarTexto(produto.descricao);

  const evidencias = [];
  const alertas = [];

  // --------------------------------------------------------------
  // 1) SCORE NCM (0..60)
  // --------------------------------------------------------------
  let scoreNCM = 0;
  let segmentoDetectado = null;
  let matchNcm = null;
  let nivelNCM = "SEM_RELACAO";

  if (ncm) {
    // procura o prefixo mais longo compatível
    const candidatos = NCM_ST_PREFIXOS
      .filter(p => ncm.startsWith(p.prefixo))
      .sort((a, b) => b.prefixo.length - a.prefixo.length);
    matchNcm = candidatos[0] || null;

    if (matchNcm) {
      segmentoDetectado = matchNcm.segmento;
      const L = matchNcm.prefixo.length;
      if (L >= 8)      { scoreNCM = 60; nivelNCM = "NCM_8_DIGITOS"; }
      else if (L >= 6) { scoreNCM = 45; nivelNCM = "NCM_6_DIGITOS"; }
      else if (L >= 4) { scoreNCM = 25; nivelNCM = "NCM_4_DIGITOS"; }
      else             { scoreNCM = 10; nivelNCM = "NCM_CAPITULO"; }
    } else {
      // relação apenas por capítulo (2 dígitos) se houver algum prefixo do mesmo cap.
      const cap = ncm.slice(0, 2);
      const capST = NCM_ST_PREFIXOS.some(p => p.prefixo.startsWith(cap));
      if (capST) { scoreNCM = 10; nivelNCM = "CAPITULO_RELACIONADO"; }
    }
  }
  evidencias.push({
    etapa: "1. Análise do NCM (peso 60)",
    peso: `+${scoreNCM}/60`,
    detalhe: matchNcm
      ? `NCM ${ncm||"—"} corresponde ao prefixo ${matchNcm.prefixo} do Convênio 142/18 (segmento "${matchNcm.segmento}") — nível ${nivelNCM}.`
      : ncm
      ? `NCM ${ncm} sem correspondência direta com prefixos ST conhecidos (nível ${nivelNCM}).`
      : "NCM não informado.",
  });

  // --------------------------------------------------------------
  // 2) SCORE DESCRIÇÃO (0..30)
  // --------------------------------------------------------------
  let scoreDESC = 0;
  let nivelDESC = "SEM_CORRESPONDENCIA";
  const palavrasEncontradas = [];
  let segmentoPorDesc = null;

  for (const seg of SEGMENTOS_ST) {
    for (const palavra of seg.palavras) {
      if (desc.includes(palavra)) {
        palavrasEncontradas.push({ palavra, segmento: seg.nome });
        if (!segmentoPorDesc) segmentoPorDesc = seg.nome;
      }
    }
  }

  if (palavrasEncontradas.length > 0) {
    const mesmoSeg = segmentoDetectado && segmentoPorDesc === segmentoDetectado;
    if (mesmoSeg && palavrasEncontradas.length >= 1) {
      scoreDESC = 30; nivelDESC = "FORTE"; // descrição confirma segmento do NCM
    } else if (palavrasEncontradas.length >= 2) {
      scoreDESC = 20; nivelDESC = "MEDIA";
    } else {
      scoreDESC = 10; nivelDESC = "PARCIAL";
    }
    if (!segmentoDetectado) segmentoDetectado = segmentoPorDesc;
  }
  evidencias.push({
    etapa: "2. Análise da descrição (peso 30)",
    peso: `+${scoreDESC}/30`,
    detalhe: palavrasEncontradas.length
      ? `Termos identificados: ${palavrasEncontradas.map(p=>`"${p.palavra}"→${p.segmento}`).join("; ")} — nível ${nivelDESC}.`
      : `Nenhum termo de segmento ST encontrado em "${produto.descricao||"—"}".`,
  });

  // --------------------------------------------------------------
  // 3) SCORE CST (0..10)
  // --------------------------------------------------------------
  let scoreCST = 0;
  let nivelCST = "INCOMPATIVEL";
  if (cst) {
    if (CST_ST_FORTE.has(cst))      { scoreCST = 10; nivelCST = "COMPATIVEL_ST"; }
    else if (CST_ST_FRACO.has(cst)) { scoreCST = 5;  nivelCST = "POSSIVEL_ST"; }
    else                            { scoreCST = 0;  nivelCST = "INCOMPATIVEL"; }
  } else {
    nivelCST = "NAO_INFORMADO";
  }
  evidencias.push({
    etapa: "3. Análise do CST (peso 10)",
    peso: `+${scoreCST}/10`,
    detalhe: cst
      ? `CST/CSOSN ${cst} → ${nivelCST}.`
      : "CST/CSOSN não informado — critério complementar não pontuou.",
  });

  // bônus reforço via CEST (não faz parte da matriz oficial, mas registrado)
  if (cest && cest.length >= 7) {
    evidencias.push({
      etapa: "Observação — CEST informado",
      peso: "info",
      detalhe: `CEST ${cest} presente. O CEST é indicador oficial de ST (Convênio 142/18); considere-o na revisão manual.`,
    });
  }

  // --------------------------------------------------------------
  // SCORE FINAL + CLASSIFICAÇÃO (usa helper unificado — mesma matriz
  // e mesmos thresholds em identificarST e scoreRegraST)
  // --------------------------------------------------------------
  const cl = classificarMatrizST({ scoreNcm: scoreNCM, scoreDesc: scoreDESC, scoreCst: scoreCST, cestExato: false });
  const scoreFinal = cl.score;
  const status = cl.status;
  if (cl.classificacao === "VALIDACAO_MANUAL") {
    alertas.push("Score alto porém NCM insuficiente (<45) — validação manual obrigatória");
  }

  // conflitos → alerta
  if (scoreDESC >= 20 && scoreNCM === 0) {
    alertas.push("Descrição sugere ST mas NCM é incompatível — revisão recomendada");
  }
  if (produto.vPMC > 0 && status === "SEM_CONFIRMACAO") {
    alertas.push("PMC informado na NF-e sem identificação ST — revisar");
  }

  // fundamento
  const fundamento = segmentoDetectado === "Autopecas"
    ? "Protocolo ICMS 41/08 e 97/10 c/c Convênio ICMS 142/18 – Autopeças (peças, componentes e acessórios para veículos automotores)"
    : "RICMS/BA – Decreto 13.780/2012 (Anexo 1 – Substituição Tributária)";

  const usaPMC = segmentoDetectado === "Medicamentos" || (produto.vPMC && produto.vPMC > 0);

  const metodo = scoreNCM >= scoreDESC && scoreNCM > 0 ? "NCM"
              : scoreDESC > 0 ? "DESCRICAO"
              : cest ? "CEST" : null;

  const conclusao =
    status === "ST_CONFIRMADA"
      ? `Score ${scoreFinal}/100 (NCM ${scoreNCM}/60 + Desc ${scoreDESC}/30 + CST ${scoreCST}/10) → CLASSIFICAR COMO ST. Segmento "${segmentoDetectado||"—"}". Fundamento: ${fundamento}.`
      : status === "VALIDACAO_MANUAL"
      ? `Score ${scoreFinal}/100 mas NCM ${scoreNCM}/60 (<45) → VALIDAÇÃO MANUAL NECESSÁRIA. Regra de proteção fiscal impede classificação automática.`
      : status === "ALTA_PROBABILIDADE"
      ? `Score ${scoreFinal}/100 (66-80) → ALTA PROBABILIDADE DE ST. Sugerir ST mantendo validação manual.`
      : status === "BAIXA_MEDIA_PROBABILIDADE"
      ? `Score ${scoreFinal}/100 (46-65) → BAIXA/MÉDIA PROBABILIDADE DE ST. Exige análise manual antes de aplicar.`
      : `Score ${scoreFinal}/100 (≤45) → NÃO SUGERIR ST. Evidências insuficientes.`;

  return {
    score: scoreFinal,
    score_ncm: scoreNCM,
    score_descricao: scoreDESC,
    score_cst: scoreCST,
    nivel_ncm: nivelNCM,
    nivel_descricao: nivelDESC,
    nivel_cst: nivelCST,
    status,
    metodo,
    segmento: segmentoDetectado,
    fundamento,
    usaPMC,
    alertas,
    evidencias,
    conclusao,
    ncm_consultado: ncm,
    cest_consultado: cest,
    cst_consultado: cst,
  };
}

// ============================================================
// CÁLCULO ST POR PAUTA — prioridade PMC > PMPF > MVA
// (regra_icms_st_pmc.json)
// ============================================================
export function calcularSTporPauta({
  vPMC = 0,
  pmpf = 0,
  mva = 0,
  quantidade = 1,
  valorProduto = 0,
  frete = 0,
  seguro = 0,
  despesas = 0,
  ipi = 0,
  aliquotaInterna = 20.5,
  icmsProprio = 0,
  // Bloco 2 — contexto para resolução automática de pauta
  ncm = null,
  cest = null,
  ean = null,
  uf = "BA",
  data = null,
}) {
  const numero = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  quantidade = numero(quantidade);
  valorProduto = numero(valorProduto);
  frete = numero(frete);
  seguro = numero(seguro);
  despesas = numero(despesas);
  ipi = numero(ipi);
  mva = numero(mva);
  aliquotaInterna = numero(aliquotaInterna);
  icmsProprio = numero(icmsProprio);
  const aliqInt = aliquotaInterna / 100;

  const pauta = resolverPauta({ ncm, cest, ean, uf, data, vPMC, pmpf });
  const avisos = [...pauta.avisos];

  let base, metodo, formula;

  if (pauta.metodo === "PMC" || pauta.metodo === "PMPF") {
    metodo = pauta.metodo;
    const v = pauta.valorUnitario;
    base = v * quantidade;
    formula = `${metodo} (${v.toFixed(2)}) × Qtd (${quantidade}) = ${base.toFixed(2)}`;
  } else {
    metodo = "MVA";
    const mvaFactor = 1 + (mva / 100);
    base = (valorProduto + frete + seguro + despesas + ipi) * mvaFactor;
    formula = `(${valorProduto.toFixed(2)} + ${frete.toFixed(2)} + ${seguro.toFixed(2)} + ${despesas.toFixed(2)} + ${ipi.toFixed(2)}) × (1 + ${mva}%) = ${base.toFixed(2)}`;
    if (mva <= 0) {
      avisos.push({
        tipo: "MVA_INDISPONIVEL",
        mensagem: "Sem pauta (PMC/PMPF) e sem MVA aplicável: base de cálculo da ST igual ao valor da operação — revisar manualmente.",
        fundamento: "Convênio ICMS 142/18",
      });
    }
  }

  const icmsST = Math.max(0, base * aliqInt - icmsProprio);

  return {
    metodo,
    base_calculo: base,
    aliquota_interna: aliquotaInterna,
    icms_proprio: icmsProprio,
    icms_st: icmsST,
    formula,
    fonte_pauta: pauta.fonte,
    pauta_esperada: pauta.pautaEsperada,
    avisos,
    fundamento: metodo === "MVA"
      ? "Convênio 142/18 – MVA ajustada"
      : (pauta.fundamento || "Convênio 142/18 – pauta fiscal"),
  };
}


// ============================================================
// MOTOR DE PRIORIDADE TRIBUTÁRIA — ST + REDUÇÃO DE BASE
// ------------------------------------------------------------
// Aplica ST e Redução de Base de Cálculo de forma CUMULATIVA,
// na ordem legal (Convênio ICMS 142/18 c/c Convênio 52/91):
//   1) BC ST original = (Valor + Frete + IPI + Despesas) × (1 + MVA)
//   2) Redução → BC ST reduzida = BC ST × (1 - %redução)
//      (%redução deriva de carga efetiva, se informada)
//   3) ICMS destino = BC ST reduzida × alíquota interna
//   4) ICMS-ST = max(0, ICMS destino - ICMS próprio)
//   5) FCP-ST (opcional) = BC ST reduzida × FCP%
// ============================================================
export function calcularSTcomBeneficio({
  valorProduto = 0,
  frete = 0,
  seguro = 0,
  outrasDespesas = 0,
  despesas = 0,
  desconto = 0,
  ipi = 0,
  mva = 0,             // MVA (original ou ajustada) já resolvida pelo chamador
  mvaAjustada = null,  // opcional — apenas registro
  mvaOriginal = null,  // opcional — apenas registro
  reducaoBase = null,  // fração 0..1 direta (ex.: 0.4)
  cargaEfetiva = null, // % (ex.: 8.80) — se sem reducaoBase, deriva RED
  aliquotaInterna = 20.5,
  icmsProprio = 0,
  fcpPercentual = 0,   // ex.: 2.00
  fundamentoST = "RICMS/BA – Convênio ICMS 142/18",
  fundamentoBeneficio = null,
}) {
  // A base presumida da ST inclui o IPI do item (LC 87/96, art. 8º, II).
  const seguroNumero = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
  aliquotaInterna = seguroNumero(aliquotaInterna);
  icmsProprio = seguroNumero(icmsProprio);
  fcpPercentual = seguroNumero(fcpPercentual);
  mva = seguroNumero(mva);
  if (reducaoBase != null) reducaoBase = seguroNumero(reducaoBase);
  if (cargaEfetiva != null) cargaEfetiva = seguroNumero(cargaEfetiva);
  const aliqInt = aliquotaInterna / 100;
  const mvaFactor = 1 + (mva / 100);
  valorProduto = seguroNumero(valorProduto);
  frete = seguroNumero(frete);
  seguro = seguroNumero(seguro);
  desconto = seguroNumero(desconto);
  ipi = seguroNumero(ipi);
  const outras = seguroNumero(outrasDespesas) + seguroNumero(despesas);
  const bcOriginal = Math.max(0, valorProduto + frete + seguro + outras + ipi - desconto);
  const bcSTOriginal = bcOriginal * mvaFactor;

  // Redução: prioridade → reducaoBase direta > cargaEfetiva derivada
  let percReducao = 0;
  if (reducaoBase != null && reducaoBase > 0 && reducaoBase < 1) {
    percReducao = reducaoBase;
  } else if (cargaEfetiva != null && aliquotaInterna > 0) {
    percReducao = Math.max(0, 1 - (cargaEfetiva / aliquotaInterna));
  }
  const bcSTReduzida = bcSTOriginal * (1 - percReducao);
  const icmsDestino = bcSTReduzida * aliqInt;
  const icmsST = Math.max(0, icmsDestino - icmsProprio);
  const fcpST = fcpPercentual > 0 ? bcSTReduzida * (fcpPercentual / 100) : 0;

  const etapas = [
    { etapa: "1. BC Original (LC 87/96 — com IPI)", valor: bcOriginal, formula: `${valorProduto.toFixed(2)} + ${frete.toFixed(2)} + ${seguro.toFixed(2)} + ${outras.toFixed(2)} + ${ipi.toFixed(2)} - ${desconto.toFixed(2)}` },
    { etapa: `2. BC ST (× (1 + MVA ${mva}%))`, valor: bcSTOriginal, formula: `${bcOriginal.toFixed(2)} × ${mvaFactor.toFixed(4)}` },
    ...(percReducao > 0 ? [{
      etapa: `3. BC ST Reduzida (${(percReducao*100).toFixed(4)}%)`,
      valor: bcSTReduzida,
      formula: `${bcSTOriginal.toFixed(2)} × (1 - ${percReducao.toFixed(4)})`,
      fundamento: fundamentoBeneficio || "Redução de base (Convênio 52/91 ou similar)",
    }] : []),
    { etapa: `4. ICMS Destino (${aliquotaInterna}%)`, valor: icmsDestino, formula: `${bcSTReduzida.toFixed(2)} × ${aliqInt.toFixed(4)}` },
    { etapa: "5. ICMS-ST = ICMS destino − ICMS próprio", valor: icmsST, formula: `max(0, ${icmsDestino.toFixed(2)} − ${icmsProprio.toFixed(2)})` },
    ...(fcpST > 0 ? [{ etapa: `6. FCP-ST (${fcpPercentual}%)`, valor: fcpST, formula: `${bcSTReduzida.toFixed(2)} × ${(fcpPercentual/100).toFixed(4)}` }] : []),
  ];

  return {
    bc_original: bcOriginal,
    bc_st_original: bcSTOriginal,
    bc_st_reduzida: bcSTReduzida,
    percentual_reducao: percReducao,
    carga_efetiva: cargaEfetiva,
    mva_aplicada: mva,
    mva_ajustada: mvaAjustada,
    mva_original: mvaOriginal,
    aliquota_interna: aliquotaInterna,
    icms_proprio: icmsProprio,
    icms_destino: icmsDestino,
    icms_st: icmsST,
    fcp_percentual: fcpPercentual,
    fcp_st: fcpST,
    etapas,
    fundamento: percReducao > 0
      ? `${fundamentoST} + ${fundamentoBeneficio || "Redução de base cumulativa"} (aplicação em cascata)`
      : fundamentoST,
    memoria: etapas.map(e => `${e.etapa}: R$ ${e.valor.toFixed(2)} — ${e.formula}`).join(" · "),
  };
}

// ============================================================
// Helper para anexar a sugestão como "regra virtual" no produto
// (sinalização — NÃO calcula automaticamente)
// ============================================================
export function gerarRegraSugerida(produto) {
  const r = identificarST(produto);
  if (r.status === "SEM_CONFIRMACAO") return null;
  return {
    tipo: "ST_SUGERIDA",
    fundamento: r.fundamento,
    descricao: `${r.segmento || "Produto"} – sugestão do Motor de Identificação ST (score ${r.score})`,
    ncm_encontrado: produto.ncm,
    cest: produto.cest || "",
    status: r.status,
    score: r.score,
    score_ncm: r.score_ncm,
    score_descricao: r.score_descricao,
    score_cst: r.score_cst,
    nivel_ncm: r.nivel_ncm,
    nivel_descricao: r.nivel_descricao,
    nivel_cst: r.nivel_cst,
    cst_consultado: r.cst_consultado,
    metodo_identificacao: r.metodo,
    segmento: r.segmento,
    usa_pmc: r.usaPMC,
    alertas: r.alertas,
    evidencias: r.evidencias,
    conclusao: r.conclusao,
    ncm_consultado: r.ncm_consultado,
    cest_consultado: r.cest_consultado,
    beneficio: false,
    sugestao: true,
  };
}
