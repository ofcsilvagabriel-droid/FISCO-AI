// ============================================================
// MOTOR DE ENQUADRAMENTO ESTRITO — CONVÊNIOS ICMS
// ------------------------------------------------------------
// Convênios ICMS (52/91, 101/97, 142/18 quando citado como Convênio)
// NÃO devem ser identificados pelo motor de pontuação genérico
// (NCM/Descrição/CEST com prefixos). Convênios exigem enquadramento
// LITERAL: NCM 8 dígitos idênticos + descrição compatível.
// ============================================================
import { normalizarTexto } from "./motorST";
import { calcularScoreNCM, normalizarNCM } from "./motorClassificacaoST";

const STOP = new Set([
  "de","da","do","das","dos","e","em","para","com","sem","a","o","os","as",
  "um","uma","no","na","nos","nas","ao","aos","por","ou","tipo","sob",
  "entre","p","kg","g","ml","l","cm","mm","un","und","pc","pcs"
]);

const SINONIMOS = {
  agua: ["agua","aguas"],
  medicamento: ["medicamento","remedio","farmaco"],
  maquina: ["maquina","maquinas","equipamento","equipamentos"],
  trator: ["trator","tratores"],
  filtro: ["filtro","filtros"],
  motor: ["motor","motores"],
  bomba: ["bomba","bombas"],
  celula: ["celula","celulas"],
  torre: ["torre","torres"],
  pa: ["pa","pas"],
  cabo: ["cabo","cabos"],
  chapa: ["chapa","chapas"],
  aerogerador: ["aerogerador","aerogeradores"],
  painel: ["painel","paineis"],
  gerador: ["gerador","geradores"],
};

function expandirTokens(tokens){
  const out = new Set(tokens);
  for (const t of tokens){
    for (const key in SINONIMOS){
      if (SINONIMOS[key].includes(t)) SINONIMOS[key].forEach(s=>out.add(s));
    }
  }
  return out;
}

function tokenizar(s){
  return normalizarTexto(s).split(" ").filter(t => t.length >= 3 && !STOP.has(t));
}

// NÃO completar com zeros à direita: um NCM legal de posição (4 díg.) ou
// subposição (6 díg.) precisa continuar com os dígitos realmente definidos,
// senão "8433" viraria "84330000" e nunca casaria com o produto "84335129".
function ncmDigitos(n) {
  return normalizarNCM(n).slice(0, 8);
}

/** Uma regra é de "Convênio ICMS" quando seu fundamento/fonte cita "Convênio". */
export function isRegraConvenio(regra){
  const f = `${regra?.fundamento||""} ${regra?._fonte||""} ${regra?.fonte_pdf||""}`;
  return /conv[eê]nio\s*icms/i.test(f) || /\bconv\.\s*icms/i.test(f);
}

/**
 * Enquadramento estrito de Convênio:
 *   - NCM compatível dígito-a-dígito no NÍVEL MÁXIMO definido pela regra
 *     (regra com 8 dígitos exige os 8; regra com 4 exige os 4 primeiros).
 *     Reaproveita calcularScoreNCM do motorClassificacaoST — sem duplicar lógica.
 *   - Pelo menos 1 termo relevante da descrição da regra presente na descrição
 *     do produto (com sinônimos básicos e singular/plural).
 */
export function matchConvenioEstrito(produto, regra){
  const p8 = ncmDigitos(produto?.ncm);
  const r8 = ncmDigitos(regra?.ncm);
  const score = calcularScoreNCM(p8, r8);
  const ncmExato = !!p8 && !!r8 && score.ncm_compativel;

  const tokProd = expandirTokens(tokenizar(produto?.descricao));
  const tokRegr = tokenizar(regra?.descricao);
  const hits = tokRegr.filter(t => tokProd.has(t));
  const descCompativel = tokRegr.length === 0 ? ncmExato : hits.length >= 1;

  const enquadrado = ncmExato && descCompativel;
  let motivo;
  if (!ncmExato){
    motivo = `Convênio exige NCM compatível em todos os ${score.digitos_regra || 8} dígito(s) definidos na regra — produto ${p8||"—"} × regra ${r8||"—"} (não enquadrado).`;
  } else if (!descCompativel){
    motivo = `NCM compatível, mas descrição do produto não contém termos da descrição do Convênio (${tokRegr.slice(0,4).join(", ")||"—"}). Enquadramento NEGADO.`;
  } else {
    motivo = `NCM compatível a nível ${score.nivel_correspondencia} (${score.digitos_regra} díg. definidos: ${r8}) e descrição compatível (${hits.slice(0,3).join(", ")||"—"}). Enquadrado pelo Convênio.`;
  }

  return {
    enquadrado,
    motivo,
    ncmExato,
    descCompativel,
    nivel_correspondencia: score.nivel_correspondencia,
    digitos_regra: score.digitos_regra,
    ncm_produto: p8,
    ncm_regra: r8,
    hits_descricao: hits,
    tokens_regra: tokRegr,
    motor: "convenio_estrito",
  };
}
