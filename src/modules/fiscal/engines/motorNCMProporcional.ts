// ============================================================
// MOTOR DE SCORING NCM PROPORCIONAL (2026)
// ============================================================
// Substitui o scoring rígido de NCM por um sistema proporcional e
// determinístico que respeita a realidade legislativa: nem sempre a
// norma especifica os 8 dígitos da NCM/SH.
//
// Regras:
//   4 dígitos legislados  → basta o produto coincidir nos 4 primeiros
//   5 dígitos legislados  → basta o produto coincidir nos 5 primeiros
//   6 dígitos legislados  → todos os 6 devem coincidir
//   7-8 dígitos legislados→ todos os dígitos legislados devem coincidir
//   produto com menos dígitos do que a norma exige → rejeição
//
// Qualquer conflito em dígito legislado zera o score (rejeição).

export type TipoCompatibilidadeNCM =
  | "PROPORCIONAL_4D"
  | "PROPORCIONAL_5D"
  | "COMPLETO_6D"
  | "COMPLETO_7_8D"
  | "PROPORCIONAL_CURTA"
  | "INSUFICIENTE";

export interface DetalheDigitoNCM {
  posicao: number;
  produto: string | null;
  legislacao: string | null;
  status: "OK" | "CONFLITO" | "NAO_ESPECIFICADO";
  tipo_comparacao: "LEGISLADO" | "EXTRA";
}

export interface ConflitoNCM {
  posicao: number;
  tipo: "LEGISLADO" | "EXTRA";
  produto: string | null;
  legislacao: string;
  gravidade: "CRITICA" | "MODERADA";
}

export interface ResultadoScoreNCMProporcional {
  ncm_produto: string;
  ncm_regra: string;
  digitos_legislados: number;
  digitos_produto: number;
  digitos_coincidentes: number;
  score_ncm: number;
  ncm_compativel: boolean;
  tipo_compatibilidade: TipoCompatibilidadeNCM;
  regra_aplicada: string;
  detalhes_por_digito: DetalheDigitoNCM[];
  conflitos: ConflitoNCM[];
  motivo: string;
  avisos: string[];
}

export function normalizarNCM(valor: unknown): string {
  return String(valor ?? "").replace(/\D/g, "").slice(0, 8);
}

function gerarMotivoNCM(
  tipo: TipoCompatibilidadeNCM,
  coincidentes: number,
  obrigatorios: number,
  compativel: boolean,
): string {
  if (!compativel) {
    return `Apenas ${coincidentes} de ${obrigatorios} dígitos obrigatórios encontrados (${Math.round(
      (coincidentes / Math.max(obrigatorios, 1)) * 100,
    )}%)`;
  }
  const mensagens: Record<string, string> = {
    PROPORCIONAL_4D: "4 dígitos legislados, 4 encontrados no produto → Enquadramento automático",
    PROPORCIONAL_5D: "5 dígitos legislados, 5+ encontrados no produto → Enquadramento automático",
    COMPLETO_6D: "6 dígitos legislados, todos os 6 encontrados no produto → Enquadramento completo",
    COMPLETO_7_8D: `${obrigatorios} dígitos legislados, todos encontrados no produto → Enquadramento completo`,
    PROPORCIONAL_CURTA: `${obrigatorios} dígito(s) legislado(s), todos encontrados no produto → Enquadramento proporcional`,
  };
  return mensagens[tipo] ?? "NCM compatível com a legislação";
}

function gerarAvisosNCM(digitosProd: number, digitosLeg: number, tipo: string): string[] {
  const avisos: string[] = [];
  if (digitosProd > digitosLeg) {
    avisos.push(`Produto possui ${digitosProd} dígitos, legislação apenas ${digitosLeg}`);
  }
  if (tipo.includes("PROPORCIONAL")) {
    avisos.push("Regra aplicada com compatibilidade proporcional (não requer todos os dígitos)");
  }
  return avisos;
}

export function calcularScoreNCMProporcional(
  ncmProduto: unknown,
  ncmRegra: unknown,
): ResultadoScoreNCMProporcional {
  const ncmProd = normalizarNCM(ncmProduto);
  const ncmLeg = normalizarNCM(ncmRegra);

  if (!ncmLeg) {
    return {
      ncm_produto: ncmProd,
      ncm_regra: ncmLeg,
      digitos_legislados: 0,
      digitos_produto: ncmProd.length,
      digitos_coincidentes: 0,
      score_ncm: 0,
      ncm_compativel: false,
      tipo_compatibilidade: "INSUFICIENTE",
      regra_aplicada: "NENHUMA",
      detalhes_por_digito: [],
      conflitos: [],
      motivo: "Legislação sem NCM definido",
      avisos: [],
    };
  }

  const nDigitosLeg = ncmLeg.length;
  let tipo: TipoCompatibilidadeNCM;
  let requerMatchExtras = false;

  if (nDigitosLeg <= 3) tipo = "PROPORCIONAL_CURTA";
  else if (nDigitosLeg === 4) tipo = "PROPORCIONAL_4D";
  else if (nDigitosLeg === 5) tipo = "PROPORCIONAL_5D";
  else if (nDigitosLeg === 6) tipo = "COMPLETO_6D";
  else {
    tipo = "COMPLETO_7_8D";
    requerMatchExtras = true;
  }
  const nDigitosObrigatorios = nDigitosLeg;

  if (ncmProd.length < nDigitosObrigatorios) {
    return {
      ncm_produto: ncmProd,
      ncm_regra: ncmLeg,
      digitos_legislados: nDigitosLeg,
      digitos_produto: ncmProd.length,
      digitos_coincidentes: 0,
      score_ncm: 0,
      ncm_compativel: false,
      tipo_compatibilidade: "INSUFICIENTE",
      regra_aplicada: "INSUFICIENTE",
      detalhes_por_digito: [],
      conflitos: [],
      motivo: `Produto com ${ncmProd.length} dígitos, legislação exige ${nDigitosObrigatorios}`,
      avisos: ["Produto não possui dígitos suficientes para compatibilidade"],
    };
  }

  const detalhes: DetalheDigitoNCM[] = [];
  const conflitos: ConflitoNCM[] = [];
  let digitosCoincidentes = 0;

  for (let i = 0; i < Math.max(ncmProd.length, ncmLeg.length); i++) {
    const digitoProd = ncmProd[i] ?? null;
    const digitoLeg = ncmLeg[i] ?? null;
    const tipoComparacao: "LEGISLADO" | "EXTRA" = i < nDigitosObrigatorios ? "LEGISLADO" : "EXTRA";
    let status: DetalheDigitoNCM["status"] = "OK";

    if (digitoLeg === null) {
      status = "NAO_ESPECIFICADO";
    } else if (digitoProd === null) {
      status = "CONFLITO";
      conflitos.push({
        posicao: i + 1,
        tipo: tipoComparacao,
        produto: null,
        legislacao: digitoLeg,
        gravidade: tipoComparacao === "LEGISLADO" ? "CRITICA" : "MODERADA",
      });
    } else if (digitoProd === digitoLeg) {
      digitosCoincidentes++;
    } else {
      status = "CONFLITO";
      conflitos.push({
        posicao: i + 1,
        tipo: tipoComparacao,
        produto: digitoProd,
        legislacao: digitoLeg,
        gravidade: tipoComparacao === "LEGISLADO" ? "CRITICA" : "MODERADA",
      });
    }

    detalhes.push({
      posicao: i + 1,
      produto: digitoProd,
      legislacao: digitoLeg,
      status,
      tipo_comparacao: tipoComparacao,
    });
  }

  const conflitosCriticos = conflitos.filter((c) => c.gravidade === "CRITICA");
  if (conflitosCriticos.length > 0) {
    return {
      ncm_produto: ncmProd,
      ncm_regra: ncmLeg,
      digitos_legislados: nDigitosLeg,
      digitos_produto: ncmProd.length,
      digitos_coincidentes: digitosCoincidentes,
      score_ncm: 0,
      ncm_compativel: false,
      tipo_compatibilidade: tipo,
      regra_aplicada: "CONFLITO_CRITICO",
      detalhes_por_digito: detalhes,
      conflitos,
      motivo: `Conflito em dígito(s) legislado(s): posição ${conflitosCriticos[0]!.posicao}`,
      avisos: ["Incompatibilidade nos dígitos obrigatórios"],
    };
  }

  if (requerMatchExtras) {
    const conflitosExtras = conflitos.filter((c) => c.tipo === "EXTRA");
    if (conflitosExtras.length > 0) {
      return {
        ncm_produto: ncmProd,
        ncm_regra: ncmLeg,
        digitos_legislados: nDigitosLeg,
        digitos_produto: ncmProd.length,
        digitos_coincidentes: digitosCoincidentes,
        score_ncm: 0,
        ncm_compativel: false,
        tipo_compatibilidade: tipo,
        regra_aplicada: "CONFLITO_EXTRA",
        detalhes_por_digito: detalhes,
        conflitos,
        motivo: `Conflito em dígitos adicionais (além dos ${nDigitosObrigatorios} obrigatórios)`,
        avisos: ["Produto não atende aos dígitos estendidos da legislação"],
      };
    }
  }

  let score = 100;
  let ncmCompativel = true;
  if (digitosCoincidentes < nDigitosObrigatorios) {
    score = Math.round((digitosCoincidentes / nDigitosObrigatorios) * 100);
    ncmCompativel = false;
  }

  return {
    ncm_produto: ncmProd,
    ncm_regra: ncmLeg,
    digitos_legislados: nDigitosLeg,
    digitos_produto: ncmProd.length,
    digitos_coincidentes: digitosCoincidentes,
    score_ncm: score,
    ncm_compativel: ncmCompativel,
    tipo_compatibilidade: tipo,
    regra_aplicada: tipo,
    detalhes_por_digito: detalhes,
    conflitos,
    motivo: gerarMotivoNCM(tipo, digitosCoincidentes, nDigitosObrigatorios, ncmCompativel),
    avisos: gerarAvisosNCM(ncmProd.length, nDigitosLeg, tipo),
  };
}

/** Melhor aderência entre alternativas de NCM declaradas por uma norma. */
export function melhorScoreNCMProporcional(
  ncmProduto: unknown,
  alternativas: unknown[],
): ResultadoScoreNCMProporcional {
  let melhor: ResultadoScoreNCMProporcional | null = null;
  for (const alt of alternativas.length ? alternativas : [""]) {
    const r = calcularScoreNCMProporcional(ncmProduto, alt);
    if (!melhor) melhor = r;
    else if (
      (r.ncm_compativel && !melhor.ncm_compativel) ||
      (r.ncm_compativel === melhor.ncm_compativel &&
        r.digitos_legislados > melhor.digitos_legislados)
    ) {
      melhor = r;
    }
  }
  return melhor!;
}
