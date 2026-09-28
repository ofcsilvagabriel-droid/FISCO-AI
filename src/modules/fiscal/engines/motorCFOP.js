// ============================================================
// MOTOR DE INTERPRETAÇÃO DE CFOP
// ------------------------------------------------------------
// Camada ADICIONAL de verificação, executada junto com o motor
// de CST/CSOSN e ANTES de qualquer fórmula de cálculo.
//
// Mesmo padrão da MATRIZ_CST / MAPA_CSOSN de motorCST.js:
//   codigo · nome · geraICMS · calculosProibidos · fundamento
//
// geraICMS:
//   true   → operação normalmente tributada
//   false  → operação sem incidência / não geradora de ICMS
//   null   → indefinido (exige revisão manual, ex.: 5949/6949)
//
// AVISO: lista técnica inicial. Fundamentos e códigos devem ser
// revisados conforme particularidades da UF (RICMS/BA).
// ============================================================

function digs(s) { return String(s ?? "").replace(/\D/g, ""); }

const SEM_ICMS = ["ICMS_PROPRIO", "ICMS_ST", "DIFAL", "ANTECIPACAO"];

// --- CFOPs "título" (cabeçalho de faixa na EFD) ---------------
export const CFOPS_TITULO = [
  "1000","1100","1150","1200","1250","1300","1350","1400","1450","1500","1550","1600","1900",
  "2000","2100","2150","2200","2250","2300","2350","2400","2500","2550","2600","2900",
  "3000","3100","3200","3250","3300","3350","3500","3550","3650","3900",
  "5000","5100","5150","5200","5250","5300","5350","5400","5450","5500","5550","5600","5650","5900",
  "6000","6100","6150","6200","6250","6300","6350","6400","6500","6550","6600","6650","6900",
  "7000","7100","7200","7250","7300","7350","7500","7550","7650","7900",
];

function bloco(codigos, nome, fundamento, opts = {}) {
  const out = {};
  codigos.forEach((c) => {
    out[c] = {
      codigo: c,
      nome,
      geraICMS: opts.geraICMS === undefined ? false : opts.geraICMS,
      calculosProibidos: opts.calculosProibidos || SEM_ICMS,
      fundamento,
      ...(opts.extra || {}),
    };
  });
  return out;
}

// --- MATRIZ OFICIAL DE CFOP -----------------------------------
export const MATRIZ_CFOP = {
  // Ativo imobilizado
  ...bloco(["5551","6551","1551","2551","5552","6552","1552","2552","5553","6553","1553","2553"],
    "Operação com bem do ativo imobilizado",
    "Ativo imobilizado — não configura circulação de mercadoria tributável (LC 87/96, art. 12 c/c RICMS/BA). DIFAL de ativo imobilizado, quando devido, exige regra específica."),

  // Amostra grátis
  ...bloco(["5911","6911","1911","2911"],
    "Remessa/entrada de amostra grátis",
    "Amostra grátis — isenção prevista no Convênio ICMS 29/90 c/c RICMS/BA, Anexo I."),

  // Bonificação, doação, brinde — REMESSA/ENTRADA (5xxx/6xxx) calcula normalmente
  ...bloco(["5910","6910"],
    "Bonificação, doação ou brinde",
    "Remessa em bonificação/doação/brinde — calculado normalmente conforme CST/NCM da operação.",
    { geraICMS: true, calculosProibidos: [] }),

  // Bonificação, doação, brinde — entrada/saída própria (1xxx/2xxx) mantém tratamento específico
  ...bloco(["1910","2910"],
    "Bonificação, doação ou brinde",
    "Bonificação/doação/brinde em operação própria — tratamento específico conforme legislação aplicável."),

  // Demonstração e retorno de demonstração
  ...bloco(["5912","6912","5913","6913","1912","2912","1913","2913"],
    "Remessa/retorno de mercadoria para demonstração",
    "Demonstração — suspensão do ICMS (Ajuste SINIEF 02/18 c/c RICMS/BA)."),

  // Comodato / locação e retornos
  ...bloco(["5908","6908","5909","6909","1908","2908","1909","2909"],
    "Remessa/retorno de bem por conta de contrato de comodato ou locação",
    "Comodato/locação — não incidência do ICMS (LC 87/96, art. 3º; Súmula 573/STF)."),

  // Conserto ou reparo
  ...bloco(["5915","6915","5916","6916","1915","2915","1916","2916"],
    "Remessa/retorno de mercadoria para conserto ou reparo",
    "Conserto/reparo — suspensão do ICMS (Convênio AE 15/74 c/c RICMS/BA)."),

  // Industrialização por encomenda (remessa/retorno)
  ...bloco(["5901","6901","5902","6902","1901","2901","1902","2902"],
    "Remessa/retorno de industrialização por encomenda",
    "Industrialização por encomenda — suspensão do ICMS (Convênio AE 15/74 c/c RICMS/BA)."),

  // Exportação (7xxx)
  ...bloco(["7101","7102","7105","7106","7127","7501","7551","7949","7201","7202","7210","7211","7551"],
    "Operação de exportação / saída para o exterior",
    "Exportação — imunidade do ICMS (CF/88, art. 155, §2º, X, 'a' c/c LC 87/96, art. 3º, II)."),

  // Outras saídas não especificadas — INDEFINIDO
  ...bloco(["5949","6949"],
    "Outra saída de mercadoria ou prestação de serviço não especificado",
    "CFOP genérico — a incidência depende da natureza real da operação e da legislação da UF. Revisão manual obrigatória.",
    { geraICMS: null, calculosProibidos: [], extra: { revisaoManual: true } }),

  // Operações com ICMS já pago integralmente por substituição tributária —
  // BLOQUEIO TOTAL de cálculo (ICMS próprio, ST, DIFAL e antecipação).
  ...bloco(
    ["5401","5402","5403","5405","5414","5415",
     "6401","6402","6403","6404","6414","6415"],
    "Operação com mercadoria sujeita a ST — ICMS já recolhido integralmente por substituição tributária",
    "ICMS integralmente recolhido por substituição tributária em etapa anterior — vedado novo cálculo (Convênio ICMS 142/18 c/c RICMS/BA).",
    { geraICMS: false, calculosProibidos: SEM_ICMS, extra: { stJaRecolhida: true } }),

  // Demais operações com ICMS já retido por ST (substituído)
  ...bloco(
    ["1403","1404","1408","1409","1410","1411","1414","1415",
     "2403","2404","2408","2409","2410","2411","2414","2415",
     "5409","5410","5411","5412","5413",
     "6409","6410","6411","6412","6413"],
    "Operação com mercadoria sujeita a ST na condição de contribuinte substituído",
    "ICMS-ST recolhido anteriormente pelo substituto — vedado novo cálculo de ST (Convênio ICMS 142/18 c/c RICMS/BA).",
    { geraICMS: false, calculosProibidos: ["ICMS_ST", "ICMS_ST_NOVO"], extra: { stJaRecolhida: true } }),

  // Operações do substituto tributário (ST devida nesta operação)
  ...bloco(["5408","6408","1401","1402","2401","2402"],
    "Operação com mercadoria sujeita a ST na condição de substituto tributário",
    "ICMS-ST devido nesta operação pelo substituto tributário (Convênio ICMS 142/18).",
    { geraICMS: true, calculosProibidos: [] }),
};

/**
 * Interpreta o CFOP e devolve as permissões da operação,
 * no mesmo formato de interpretarCST.
 */
export function interpretarCFOP(cfop) {
  const cod = digs(cfop).slice(0, 4);

  if (!cod || cod.length < 4) {
    return {
      codigo: cod, codigo_informado: String(cfop ?? ""),
      nome: "CFOP não informado", geraICMS: null,
      calculosProibidos: [], fundamento: "CFOP não informado no documento fiscal.",
      titulo: false, revisaoManual: true, stJaRecolhida: false, exportacao: false,
      log: ["[AVISO] CFOP não informado — verificação de incidência por CFOP não realizada."],
    };
  }

  if (CFOPS_TITULO.includes(cod)) {
    return {
      codigo: cod, codigo_informado: cod,
      nome: "CFOP título (cabeçalho de faixa na EFD)",
      geraICMS: false,
      calculosProibidos: SEM_ICMS,
      fundamento: "CFOP de título/cabeçalho de faixa (Ajuste SINIEF 07/01). Nunca deve ser usado em lançamento real — indica erro de digitação.",
      titulo: true, revisaoManual: true, stJaRecolhida: false, exportacao: false,
      log: [`[ERRO] CFOP ${cod} é código-título da EFD e não pode ser utilizado em lançamento real. Cálculos bloqueados.`],
    };
  }

  const base = MATRIZ_CFOP[cod];
  if (base) {
    return {
      ...base,
      codigo_informado: cod,
      titulo: false,
      revisaoManual: !!base.revisaoManual || base.geraICMS === null,
      stJaRecolhida: !!base.stJaRecolhida,
      exportacao: cod.startsWith("7"),
      log: [
        base.geraICMS === null
          ? `[AVISO] CFOP ${cod} — ${base.nome}. Incidência indefinida: revisão manual necessária.`
          : base.geraICMS
            ? `[OK] CFOP ${cod} — ${base.nome}. Operação com incidência de ICMS.`
            : `[AÇÃO] CFOP ${cod} — ${base.nome}. Operação sem incidência: cálculos incompatíveis bloqueados.`,
      ],
    };
  }

  // Exportação genérica (7xxx não mapeado)
  if (cod.startsWith("7")) {
    return {
      codigo: cod, codigo_informado: cod,
      nome: "Saída para o exterior (exportação)",
      geraICMS: false, calculosProibidos: SEM_ICMS,
      fundamento: "Exportação — imunidade do ICMS (CF/88, art. 155, §2º, X, 'a').",
      titulo: false, revisaoManual: false, stJaRecolhida: false, exportacao: true,
      log: [`[AÇÃO] CFOP ${cod} — exportação. Cálculo de ICMS bloqueado por imunidade constitucional.`],
    };
  }

  return {
    codigo: cod, codigo_informado: cod,
    nome: "CFOP não mapeado — tratado como operação tributada",
    geraICMS: true, calculosProibidos: [],
    fundamento: "CFOP sem regra específica cadastrada. Cálculo segue a classificação por CST/NCM.",
    titulo: false, revisaoManual: false, stJaRecolhida: false, exportacao: false,
    log: [`[OK] CFOP ${cod} sem regra específica — segue tributação normal conforme CST/classificação.`],
  };
}

/** Descrição textual curta para a UI. */
export function descreverCFOP(perm) {
  if (!perm) return "—";
  if (perm.titulo) return "CFOP título (inválido em lançamento real)";
  if (perm.geraICMS === null) return "Incidência indefinida — revisão manual";
  return perm.geraICMS ? "Operação com incidência de ICMS" : "Operação sem incidência de ICMS";
}
