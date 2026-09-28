// Engine de Cálculo — orquestra o cômputo tributário (ST por pauta,
// ST com benefício, DIFAL). Não interpreta regras; recebe os
// parâmetros já resolvidos por Services superiores.
//
// Camada de GATE: antes de executar qualquer fórmula, cruza
// CST/CSOSN × CFOP (gateTributario) e bloqueia o cálculo quando
// a operação não admite o tributo, registrando o motivo.
import {
  calcularSTporPauta,
  calcularSTcomBeneficio,
} from "../../engines/motorST";
import { avaliarLiberacaoCalculo } from "../../engines/gateTributario";
import { AliquotasRepository } from "../repositories/AliquotasRepository";

type Entrada = Record<string, any>;

function temContextoFiscal(input: Entrada | undefined) {
  return !!(input && (input.cfop || input.cst || input.csosn || input.permCFOP || input.permCST));
}

export function avaliarLiberacao(input: Entrada = {}) {
  return avaliarLiberacaoCalculo({
    cst: input.cst ?? input.csosn,
    cfop: input.cfop,
    ncm: input.ncm,
    cest: input.cest,
    permCST: input.permCST,
    permCFOP: input.permCFOP,
    valorIcmsStXml: input.valor_icms_st_xml ?? input.vICMSST ?? 0,
    valorIcmsStRetido: input.valor_icms_st_ret ?? input.vICMSSTRet ?? 0,
    valorIcmsXml: input.valor_icms ?? input.vICMS ?? 0,
    sujeitoST: input.sujeitoST ?? false,
  });
}

function resultadoBloqueado(tributo: string, avaliacao: any) {
  const b = avaliacao.bloqueios.find((x: any) => x.tributo === tributo) || null;
  return {
    status: "BLOQUEADO",
    bloqueado: true,
    tributo_bloqueado: tributo,
    valor: 0,
    valor_icms_st: 0,
    valor_icms_proprio: 0,
    base: 0,
    motivo: b?.motivo ?? `Cálculo de ${tributo} bloqueado.`,
    fundamento: b?.fundamento ?? null,
    bloqueio: b,
    bloqueios: avaliacao.bloqueios,
    advertencias: avaliacao.advertencias,
    gate: avaliacao,
    memoria: avaliacao.memoria,
    log: avaliacao.log,
  };
}

/** Executa `exec` somente se o tributo estiver liberado pelo gate. */
function comGate<T>(tributo: string, input: Entrada, exec: () => T): any {
  if (!temContextoFiscal(input)) return exec();
  const avaliacao = avaliarLiberacao(input);
  if (!avaliacao.liberado[tributo]) return resultadoBloqueado(tributo, avaliacao);
  const resultado = exec() as any;
  return {
    ...resultado,
    status: "CALCULADO",
    bloqueado: false,
    gate: avaliacao,
    advertencias: [...(resultado?.advertencias || []), ...avaliacao.advertencias],
    memoria: [...(avaliacao.memoria || []), ...(resultado?.memoria || [])],
  };
}

export const CalculationEngine = {
  avaliarLiberacao,
  stPorPauta: (input: Parameters<typeof calcularSTporPauta>[0]) =>
    comGate("ICMS_ST", input as Entrada, () => calcularSTporPauta(input)),
  stComBeneficio: (input: Parameters<typeof calcularSTcomBeneficio>[0]) =>
    comGate("ICMS_ST", input as Entrada, () => calcularSTcomBeneficio(input)),
  difal: (nota: unknown) =>
    comGate("DIFAL", nota as Entrada, () => AliquotasRepository.difal(nota)),
  aliquotaInterna: (uf: string) => AliquotasRepository.interna(uf),
  aliquotaInterestadual: (
    ufOrigem: string,
    ufDestino: string,
    importado = false,
  ) => AliquotasRepository.interestadual(ufOrigem, ufDestino, importado),
};
