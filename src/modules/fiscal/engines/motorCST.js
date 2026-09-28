// ============================================================
// MOTOR DE INTERPRETAÇÃO DE CST / CSOSN
// ------------------------------------------------------------
// Camada obrigatória ANTES de qualquer cálculo tributário.
// Transforma o código CST/CSOSN em um objeto de permissões que
// autoriza (ou proíbe) cada tipo de cálculo (ICMS próprio, ST,
// DIFAL, Antecipação, Redução de Base, Diferimento, Isenção,
// Não Tributação, Suspensão, ST Retida Anteriormente).
//
// Também expõe:
//   • validarCST({...})           → validações cruzadas (CST × NCM/CFOP/…)
//   • validarReducaoBase({...})   → impede redução dupla de BC
// ============================================================

function digs(s) { return String(s ?? "").replace(/\D/g, ""); }

// --- MATRIZ OFICIAL DE CST -----------------------------------
// Regime Normal (RICMS/BA — Convênio ICMS 142/18 e Anexo do CST)
const MATRIZ_CST = {
  "00": {
    codigo: "00", nome: "Tributada integralmente",
    temICMSProprio:true, temST:false, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_ST_NOVO"],
    beneficiosCoexistentes:["DIFAL","ANTECIPACAO"],
    fundamento:"CST 00 — Tributação integral (art. 2º RICMS/BA)",
  },
  "10": {
    codigo:"10", nome:"Tributada e com cobrança do ICMS por substituição tributária",
    temICMSProprio:true, temST:true, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:true,
    calculosProibidos:[],
    beneficiosCoexistentes:["ICMS_ST","ICMS_PROPRIO"],
    fundamento:"CST 10 — Tributada com ST (Convênio ICMS 142/18)",
  },
  "20": {
    codigo:"20", nome:"Com redução de base de cálculo",
    temICMSProprio:true, temST:false, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:true, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:true, possuiST:false,
    calculosProibidos:["REDUCAO_DUPLICADA"],
    beneficiosCoexistentes:["REDUCAO_BC"],
    fundamento:"CST 20 — Redução de base já aplicada pelo emitente. Nova redução é vedada.",
  },
  "30": {
    codigo:"30", nome:"Isenta ou não tributada e com cobrança do ICMS por ST",
    temICMSProprio:false, temST:true, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:true, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:true,
    calculosProibidos:["ICMS_PROPRIO"],
    beneficiosCoexistentes:["ISENCAO","ICMS_ST"],
    fundamento:"CST 30 — Isenta na operação própria, ST devida.",
  },
  "40": {
    codigo:"40", nome:"Isenta",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:true, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_PROPRIO","ICMS_ST","DIFAL","ANTECIPACAO"],
    beneficiosCoexistentes:["ISENCAO"],
    fundamento:"CST 40 — Operação isenta. Nenhum imposto deve ser calculado, salvo previsão legal expressa.",
  },
  "41": {
    codigo:"41", nome:"Não tributada",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:true,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_PROPRIO","ICMS_ST","DIFAL","ANTECIPACAO"],
    beneficiosCoexistentes:[],
    fundamento:"CST 41 — Operação não tributada. Nenhum imposto deve ser calculado, salvo previsão legal expressa.",
  },
  "50": {
    codigo:"50", nome:"Suspensão",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:true, stRetidaAnterior:false,
    baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_PROPRIO","ICMS_ST","DIFAL","ANTECIPACAO"],
    beneficiosCoexistentes:["SUSPENSAO"],
    fundamento:"CST 50 — Operação com suspensão. Nenhum imposto deve ser calculado.",
  },
  "51": {
    codigo:"51", nome:"Diferimento",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:true, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_ST","DIFAL","ANTECIPACAO"],
    beneficiosCoexistentes:["DIFERIMENTO"],
    fundamento:"CST 51 — Diferimento. Calcular somente conforme percentual previsto na legislação.",
  },
  "60": {
    codigo:"60", nome:"ICMS cobrado anteriormente por substituição tributária",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:true,
    baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_ST_NOVO","ICMS_PROPRIO"],
    beneficiosCoexistentes:["ST_RETIDA"],
    fundamento:"CST 60 — ST já retida na origem. Vedado novo cálculo de ST salvo complementação específica.",
  },
  "70": {
    codigo:"70", nome:"Com redução de base e cobrança do ICMS por ST",
    temICMSProprio:true, temST:true, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:true, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:true, possuiST:true,
    calculosProibidos:["REDUCAO_DUPLICADA"],
    beneficiosCoexistentes:["REDUCAO_BC","ICMS_ST"],
    fundamento:"CST 70 — Redução de base já aplicada + ST. Nova redução é vedada.",
  },
  "90": {
    codigo:"90", nome:"Outras",
    temICMSProprio:true, temST:true, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false,
    baseReduzida:false, possuiST:false,
    calculosProibidos:[],
    beneficiosCoexistentes:["*"],
    fundamento:"CST 90 — Outras. Executar conforme legislação específica.",
  },
};

// --- CSOSN (Simples Nacional) ---------------------------------
// O CSOSN tem semântica própria e NÃO pode cair no fallback CST 90
// ("Outras"), que liberaria ICMS próprio + ST + DIFAL + Antecipação
// simultaneamente. Fundamento: Anexo do CSOSN (Ajuste SINIEF 07/05,
// tabela do Simples Nacional — LC 123/06) c/c Convênio ICMS 142/18.
const MAPA_CSOSN = {
  "101": {
    codigo: "101", nome: "Tributada pelo Simples Nacional com permissão de crédito",
    temICMSProprio:true, temST:false, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_ST_NOVO"],
    beneficiosCoexistentes:["DIFAL","ANTECIPACAO"],
    fundamento:"CSOSN 101 — Tributada pelo Simples com permissão de crédito. Sem ST na operação.",
  },
  "102": {
    codigo: "102", nome: "Tributada pelo Simples Nacional sem permissão de crédito",
    temICMSProprio:true, temST:false, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:false,
    calculosProibidos:[],
    beneficiosCoexistentes:["DIFAL","ANTECIPACAO"],
    fundamento:"CSOSN 102 — Tributada pelo Simples sem permissão de crédito. Cálculo liberado normalmente, sem bloqueio por CST.",
  },
  "103": {
    codigo: "103", nome: "Isenção do ICMS no Simples Nacional para faixa de receita bruta",
    temICMSProprio:false, temST:false, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:false, temDiferimento:false, isento:true, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_PROPRIO","ICMS_ST_NOVO"],
    beneficiosCoexistentes:["ISENCAO"],
    // REVISAR: a isenção do CSOSN 103 alcança apenas a operação própria do
    // emitente; DIFAL/Antecipação do destinatário seguem regra estadual.
    fundamento:"CSOSN 103 — Isenção por faixa de receita bruta. Sem crédito e sem ICMS próprio.",
  },
  "201": {
    codigo: "201", nome: "Tributada pelo Simples com permissão de crédito e com cobrança do ICMS por ST",
    temICMSProprio:true, temST:true, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:true,
    calculosProibidos:[],
    beneficiosCoexistentes:["ICMS_ST","ICMS_PROPRIO"],
    fundamento:"CSOSN 201 — Simples com crédito e ST devida na operação.",
  },
  "202": {
    codigo: "202", nome: "Tributada pelo Simples sem permissão de crédito e com cobrança do ICMS por ST",
    temICMSProprio:true, temST:true, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:true,
    calculosProibidos:[],
    beneficiosCoexistentes:["ICMS_ST"],
    fundamento:"CSOSN 202 — Simples sem crédito e ST devida na operação.",
  },
  "203": {
    codigo: "203", nome: "Isenção do ICMS no Simples para faixa de receita bruta e com cobrança do ICMS por ST",
    temICMSProprio:false, temST:true, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:true, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:true,
    calculosProibidos:["ICMS_PROPRIO"],
    beneficiosCoexistentes:["ISENCAO","ICMS_ST"],
    fundamento:"CSOSN 203 — Isenta na operação própria, ST devida (equivalente ao CST 30).",
  },
  "300": {
    codigo: "300", nome: "Imune",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:true, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_PROPRIO","ICMS_ST","DIFAL","ANTECIPACAO"],
    beneficiosCoexistentes:["IMUNIDADE"],
    fundamento:"CSOSN 300 — Imunidade constitucional. Nenhum imposto deve ser calculado.",
  },
  "400": {
    codigo: "400", nome: "Não tributada pelo Simples Nacional",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:true,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_PROPRIO","ICMS_ST","DIFAL","ANTECIPACAO"],
    beneficiosCoexistentes:[],
    fundamento:"CSOSN 400 — Não tributada pelo Simples Nacional (equivalente ao CST 41).",
  },
  "500": {
    codigo: "500", nome: "ICMS cobrado anteriormente por substituição tributária ou por antecipação",
    temICMSProprio:false, temST:false, temDIFAL:false, temAntecipacao:false,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:true, baseReduzida:false, possuiST:false,
    calculosProibidos:["ICMS_ST_NOVO","ICMS_PROPRIO","ANTECIPACAO"],
    beneficiosCoexistentes:["ST_RETIDA"],
    fundamento:"CSOSN 500 — ST/antecipação já recolhida anteriormente. Vedado novo cálculo de ST (equivalente ao CST 60).",
  },
  "900": {
    codigo: "900", nome: "Outros (Simples Nacional)",
    temICMSProprio:true, temST:true, temDIFAL:true, temAntecipacao:true,
    temReducaoBase:false, temDiferimento:false, isento:false, naoTributado:false,
    suspenso:false, stRetidaAnterior:false, baseReduzida:false, possuiST:false,
    calculosProibidos:[],
    beneficiosCoexistentes:["*"],
    fundamento:"CSOSN 900 — Outros. Executar conforme legislação específica.",
  },
};

/**
 * Interpreta CST (regime normal) ou CSOSN (Simples Nacional, 3 dígitos).
 * Códigos realmente desconhecidos caem no fallback CST 90, com aviso.
 */
export function interpretarCST(cstOrCsosn) {
  const cod = digs(cstOrCsosn);
  if (!cod) {
    return {
      ...MATRIZ_CST["90"],
      codigo_informado: "",
      origem_codigo: "NAO_INFORMADO",
      log:["[AVISO] CST/CSOSN não informado — aplicando permissões padrão (CST 90)."],
    };
  }

  // CSOSN (3 dígitos)
  if (cod.length === 3) {
    const base = MAPA_CSOSN[cod];
    if (base) {
      return {
        ...base,
        codigo_informado: cod,
        origem_codigo: "CSOSN",
        log:[`[OK] CSOSN ${cod} identificado → ${base.nome}.`],
      };
    }
    return {
      ...MATRIZ_CST["90"],
      codigo_informado: cod,
      origem_codigo: "CSOSN_DESCONHECIDO",
      log:[`[AVISO] CSOSN ${cod} não mapeado. Aplicado fallback CST 90 — cálculo procederá conforme classificação por NCM/descrição.`],
    };
  }

  const cst = MATRIZ_CST[cod.padStart(2,"0")] ? cod.padStart(2,"0") : cod.padStart(2,"0").slice(-2);
  const base = MATRIZ_CST[cst] || MATRIZ_CST["90"];
  return {
    ...base,
    codigo_informado: cod,
    origem_codigo: "CST",
    log:[`[OK] CST ${cod} identificado → CST ${base.codigo} (${base.nome}).`],
  };
}



// ------------------------------------------------------------
// VALIDAÇÕES CRUZADAS
// ------------------------------------------------------------
export function validarCST({ permCST, ncm, cfop, temConvenioReducao=false, temBeneficio=false,
                             temProtocoloST=false, crt="", ufOrigem="", ufDestino="" }) {
  const advertencias = [];
  const cst = permCST?.codigo;
  const cfop2 = String(cfop||"").slice(0,1);

  // CST × CFOP
  if (cst === "60" && cfop && !/^[1-6][.-]?4/.test(String(cfop))) {
    advertencias.push({
      tipo:"CST_x_CFOP",
      mensagem:`CST 60 (ST retida) normalmente exige CFOP de operação com ST. CFOP informado: ${cfop}.`,
    });
  }
  if ((cst === "40" || cst === "41") && cfop && /^[1-6][.-]?4/.test(String(cfop))) {
    advertencias.push({
      tipo:"CST_x_CFOP",
      mensagem:`CFOP ${cfop} sugere operação com ST, mas CST ${cst} indica isenção/não tributação.`,
    });
  }

  // CST × Convênio (redução)
  if (temConvenioReducao && permCST.baseReduzida) {
    advertencias.push({
      tipo:"CST_x_CONVENIO",
      mensagem:`Convênio prevê redução de base, mas CST ${cst} indica que a redução já foi aplicada pelo emitente. Nova redução será BLOQUEADA.`,
    });
  }

  // CST × Benefício (isenção com CST tributado)
  if (temBeneficio && (cst === "00" || cst === "10")) {
    advertencias.push({
      tipo:"CST_x_BENEFICIO",
      mensagem:`Foi identificado benefício fiscal (isenção/redução) para o NCM ${ncm||"—"}, mas o CST ${cst} indica tributação integral. Verifique enquadramento.`,
    });
  }

  // CST × Protocolo ST
  if (temProtocoloST && (permCST.isento || permCST.naoTributado || permCST.suspenso)) {
    advertencias.push({
      tipo:"CST_x_PROTOCOLO",
      mensagem:`Protocolo/Convênio ST aplicável ao NCM ${ncm||"—"}, mas CST ${cst} bloqueia a incidência. Verifique compatibilidade.`,
    });
  }

  // CST × Regime (CRT): nesta versão o CSOSN é ignorado — não emitimos
  // advertência para CRT=1 com CST, pois o motor já força o tratamento
  // padrão via fallback CST 90.


  // CST × UF (Operação interestadual isenta sem previsão)
  if ((cst === "40" || cst === "41") && ufOrigem && ufDestino && ufOrigem !== ufDestino) {
    advertencias.push({
      tipo:"CST_x_UF",
      mensagem:`Operação interestadual ${ufOrigem}→${ufDestino} com CST ${cst} (isenta/não tributada). Verifique se há previsão legal para a isenção interestadual.`,
    });
  }

  return { ok: advertencias.length === 0, advertencias };
}

// ------------------------------------------------------------
// VALIDADOR DE REDUÇÃO DE BASE (impede dupla redução)
// ------------------------------------------------------------
export function validarReducaoBase({ permCST, beneficioReducao=false,
                                     baseOriginal=0, baseReduzidaXML=null }) {
  const log = [];
  const baseReduzidaCST = !!(permCST && permCST.baseReduzida);
  const baseOriginalNum = Number(baseOriginal) || 0;
  const baseReduzidaXMLNum = Number(baseReduzidaXML) || 0;
  const baseReduzidaNoXML = baseOriginalNum > 0 && baseReduzidaXMLNum > 0 && baseReduzidaXMLNum < (baseOriginalNum - 0.01);
  const baseJaReduzida = baseReduzidaCST || baseReduzidaNoXML;
  const aplicarReducao = beneficioReducao && !baseJaReduzida;

  if (baseReduzidaCST) {
    log.push(`[OK] CST ${permCST.codigo} identificado — base já reduzida na origem.`);
  }
  if (baseReduzidaNoXML && !baseReduzidaCST) {
    log.push(`[OK] XML indica base reduzida: BC R$ ${baseReduzidaXMLNum.toFixed(2)} inferior à operação R$ ${baseOriginalNum.toFixed(2)}.`);
  }
  if (beneficioReducao) {
    log.push(`[OK] Convênio/Benefício prevê redução adicional de base.`);
  }
  if (baseJaReduzida && beneficioReducao) {
    log.push(`[AÇÃO] Segunda redução BLOQUEADA — base já foi reduzida ${baseReduzidaCST ? `via CST ${permCST.codigo}` : "no XML"}.`);
    log.push(`[MOTIVO] Vedação legal — não aplicar duas reduções sobre a mesma base de cálculo.`);
    log.push(`[RESULTADO] Cálculo prosseguirá sem duplicidade de benefício.`);
  }

  const baseFinal = baseReduzidaXMLNum > 0 ? baseReduzidaXMLNum : baseOriginalNum;

  return {
    aplicarReducao,
    bloqueioReducao: baseJaReduzida && beneficioReducao,
    motivo: baseJaReduzida && beneficioReducao
      ? "Base já reduzida no documento fiscal — nova redução vedada."
      : (aplicarReducao ? "Redução aplicada pelo benefício identificado." : "Sem redução aplicável."),
    memoria: {
      baseOriginal: baseOriginalNum,
      baseReduzidaXML: baseReduzidaXMLNum,
      baseReduzidaCST,
      baseReduzidaNoXML,
      beneficioPrevisto: beneficioReducao,
      novaReducaoBloqueada: baseJaReduzida && beneficioReducao,
      baseFinal,
    },
    log,
  };
}

// ------------------------------------------------------------
// Helper — descreve textualmente o CST para a UI
// ------------------------------------------------------------
export function descreverCST(perm) {
  if (!perm) return "—";
  const parts = [];
  if (perm.temICMSProprio)     parts.push("ICMS próprio");
  if (perm.possuiST)           parts.push("ICMS-ST");
  if (perm.temDIFAL)           parts.push("DIFAL");
  if (perm.temAntecipacao)     parts.push("Antecipação");
  if (perm.baseReduzida)       parts.push("Base reduzida (origem)");
  if (perm.temDiferimento)     parts.push("Diferimento");
  if (perm.isento)             parts.push("Isento");
  if (perm.naoTributado)       parts.push("Não tributado");
  if (perm.suspenso)           parts.push("Suspenso");
  if (perm.stRetidaAnterior)   parts.push("ST retida anteriormente");
  return parts.join(" · ") || "Sem incidência";
}

// ------------------------------------------------------------
// VALIDAÇÃO CRUZADA CST/CSOSN × CFOP
// ------------------------------------------------------------
// Camada ADICIONAL — não altera nenhuma regra de CST/CSOSN.
// Compara as permissões do CST com as permissões do CFOP
// (motorCFOP.js) e emite advertências de inconsistência,
// alimentando a memória do processamento.
export function validarCFOPxCST({ permCST, permCFOP, cfop = "", ncm = "", cest = "" }) {
  const advertencias = [];
  if (!permCST || !permCFOP) return { ok: true, advertencias };

  const cst = permCST.codigo;
  const cfopCod = permCFOP.codigo || String(cfop || "");

  if (permCFOP.titulo) {
    advertencias.push({
      tipo: "CFOP_TITULO",
      mensagem: `CFOP ${cfopCod} é código-título da EFD e não pode ser usado em lançamento real. Provável erro de digitação.`,
      fundamento: permCFOP.fundamento,
    });
  }

  if (permCFOP.geraICMS === false && (permCST.temICMSProprio || permCST.possuiST)) {
    advertencias.push({
      tipo: "CST_x_CFOP_INCIDENCIA",
      mensagem: `Conflito: CST/CSOSN ${cst} indica tributação (${descreverCST(permCST)}), mas o CFOP ${cfopCod} corresponde a operação sem incidência de ICMS (${permCFOP.nome}).`,
      fundamento: `${permCST.fundamento} × ${permCFOP.fundamento}`,
    });
  }

  if (permCFOP.geraICMS === true && (permCST.isento || permCST.naoTributado || permCST.suspenso)) {
    advertencias.push({
      tipo: "CST_x_CFOP_INCIDENCIA",
      mensagem: `Conflito: CFOP ${cfopCod} indica operação tributada, mas o CST/CSOSN ${cst} bloqueia a incidência do ICMS.`,
      fundamento: `${permCST.fundamento} × ${permCFOP.fundamento}`,
    });
  }

  if (permCFOP.stJaRecolhida && permCST.possuiST) {
    advertencias.push({
      tipo: "CST_x_CFOP_ST",
      mensagem: `CFOP ${cfopCod} indica mercadoria com ICMS-ST já recolhido (contribuinte substituído), mas o CST ${cst} prevê cobrança de ST na operação. Novo cálculo de ST será bloqueado.`,
      fundamento: permCFOP.fundamento,
    });
  }

  if (permCFOP.geraICMS === null) {
    advertencias.push({
      tipo: "CFOP_INDEFINIDO",
      mensagem: `CFOP ${cfopCod} identificado: operação indefinida (NCM ${ncm || "—"}${cest ? ` / CEST ${cest}` : ""}). Revisão manual necessária.`,
      fundamento: permCFOP.fundamento,
    });
  }

  return { ok: advertencias.length === 0, advertencias };
}
