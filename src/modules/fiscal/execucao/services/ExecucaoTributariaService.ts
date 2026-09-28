// Service da Execução Tributária — orquestra a persistência do
// resultado de um cálculo já concluído e dispara os eventos da
// plataforma. NÃO calcula nada: recebe resultados prontos do
// Motor de Cálculo (que permanece intocado).
import { IntegrationCore } from "@/core/integration";
import { Versioning } from "@/core/versioning";
import { TaxCache } from "@/core/cache";
import { ExecucaoRepository } from "../repositories/ExecucaoRepository";
import { resolverIcmsProprio as resolverIcmsProprioFiscal } from "@/modules/fiscal/domain/engines/IcmsProprioEngine";
import { CalculoService } from "@/modules/fiscal/domain/services/CalculoService";
import {
  ExecucaoTributariaSchema,
  type ExecucaoTributaria,
  type StatusExecucao,
} from "../entities/ExecucaoTributaria";

export interface EntradaExecucao {
  processoId?: string | null;
  tarefaId?: string | null;
  empresaId?: string | null;
  competencia?: string | null;
  produtoId?: string | null;
  usuarioId?: string | null;
  notaId?: string | null;
  classificacao?: Record<string, unknown> | null;
  beneficios?: Array<Record<string, unknown>>;
  calculo?: Record<string, unknown> | null;
  memoria?: Array<Record<string, unknown>>;
  score?: number | null;
  confianca?: number | null;
  fundamentos?: string[];
  relatorioId?: string | null;
  ncm?: string | null;
  segmento?: string | null;
}

function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `exe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function montar(entrada: EntradaExecucao, id: string, criadoEm: string, status: StatusExecucao) {
  return ExecucaoTributariaSchema.parse({
    id,
    criadoEm,
    atualizadoEm: new Date().toISOString(),
    status,
    processoId: entrada.processoId ?? null,
    tarefaId: entrada.tarefaId ?? null,
    empresaId: entrada.empresaId ?? null,
    competencia: entrada.competencia ?? null,
    produtoId: entrada.produtoId ?? null,
    usuarioId: entrada.usuarioId ?? null,
    notaId: entrada.notaId ?? null,
    classificacao: entrada.classificacao ?? null,
    beneficios: entrada.beneficios ?? [],
    calculo: entrada.calculo ?? null,
    memoria: entrada.memoria ?? [],
    score: entrada.score ?? null,
    confianca: entrada.confianca ?? null,
    fundamentos: entrada.fundamentos ?? [],
    relatorioId: entrada.relatorioId ?? null,
    versoes: Versioning.selo() as unknown as Record<string, string>,
  });
}

function contextoDe(e: ExecucaoTributaria) {
  return {
    usuarioId: e.usuarioId,
    empresaId: e.empresaId,
    competencia: e.competencia,
    processoId: e.processoId,
    tarefaId: e.tarefaId,
    execucaoId: e.id,
    produtoId: e.produtoId,
  };
}

function publicarFluxo(e: ExecucaoTributaria, entrada: EntradaExecucao, recalculo: boolean) {
  const contexto = contextoDe(e);
  const objeto = { tipo: "EXECUCAO_TRIBUTARIA", id: e.id };
  const fundamento = e.fundamentos[0] ?? null;

  if (e.classificacao) {
    IntegrationCore.publicar({
      tipo: "CLASSIFICACAO_CONCLUIDA",
      origem: "MOTOR_TRIBUTARIO",
      destino: ["RASTREABILIDADE", "INDICADORES", "GESTAO_PROCESSOS"],
      objeto,
      contexto,
      payload: { score: e.score, confianca: e.confianca, fundamento, ncm: entrada.ncm ?? null, segmento: entrada.segmento ?? null },
    });
  }

  e.beneficios.forEach((b) =>
    IntegrationCore.publicar({
      tipo: "BENEFICIO_IDENTIFICADO",
      origem: "MOTOR_BENEFICIOS",
      destino: ["RASTREABILIDADE", "INDICADORES"],
      objeto,
      contexto,
      payload: b,
    }));

  IntegrationCore.publicar({
    tipo: recalculo ? "CALCULO_RECALCULADO" : "CALCULO_EXECUTADO",
    origem: "MOTOR_CALCULO",
    destino: ["RASTREABILIDADE", "INDICADORES", "RELATORIOS", "DASHBOARD"],
    objeto,
    contexto,
    payload: { calculo: e.calculo, fundamento, versoes: e.versoes },
  });

  if (e.memoria.length) {
    IntegrationCore.publicar({
      tipo: "MEMORIA_GERADA",
      origem: "EXECUCAO_TRIBUTARIA",
      destino: ["RASTREABILIDADE", "RELATORIOS"],
      objeto,
      contexto,
      payload: { linhas: e.memoria.length },
    });
  }

  IntegrationCore.publicar({
    tipo: "EXECUCAO_TRIBUTARIA_REGISTRADA",
    origem: "EXECUCAO_TRIBUTARIA",
    destino: ["INDICADORES", "DASHBOARD", "GESTAO_PROCESSOS"],
    objeto,
    contexto,
    payload: { status: e.status },
  });

  if (e.tarefaId) {
    IntegrationCore.publicar({
      tipo: "TAREFA_CONCLUIDA",
      origem: "EXECUCAO_TRIBUTARIA",
      destino: ["GESTAO_PROCESSOS"],
      objeto: { tipo: "TAREFA", id: e.tarefaId },
      contexto,
      payload: { execucaoId: e.id },
    });
  }
}

function invalidarCache(e: ExecucaoTributaria, entrada: EntradaExecucao) {
  if (entrada.ncm) TaxCache.invalidar("ncm", entrada.ncm);
  if (entrada.segmento) TaxCache.invalidar("segmento", entrada.segmento);
  if (e.produtoId) TaxCache.invalidar("produto", e.produtoId);
  if (e.empresaId) TaxCache.invalidar("empresa", e.empresaId);
  if (e.competencia) TaxCache.invalidar("competencia", e.competencia);
}


// ------------------------------------------------------------
// Recálculo interno — mesma lógica usada por recalcular():
// aplica o gate CST/CSOSN × CFOP antes de qualquer fórmula e
// devolve calculo + memória + fundamentos já prontos.
// ------------------------------------------------------------
export function calcularComGate(classificacao: Record<string, unknown> | null | undefined) {
  const c = (classificacao ?? {}) as Record<string, any>;

  // ETAPA 1 — CONSOLIDAÇÃO: alíquota do XML → alíquota presumida →
  // nenhuma. O ICMS próprio resultante (destacado OU calculado por
  // alíquota presumida) é usado em TODOS os cálculos dependentes.
  const logsIcms: string[] = [];
  const valorTotalItem =
    Number(c.valor_total) || Number(c.valor_produto) || Number(c.valor_nf) || 0;
  const icmsDestacado = Number(c.valor_icms) || 0;
  const icmsFoiDestacado = icmsDestacado > 0;

  let aliquotaPresumida = 0;
  try {
    aliquotaPresumida = Number(
      CalculoService.aliquotaInterestadual(
        c.uf_origem ?? c.ufOrigem ?? c.uf_emitente,
        c.uf_destino ?? c.ufDestino ?? c.uf_destinatario,
      ),
    ) || 0;
  } catch {
    aliquotaPresumida = 0;
  }

  const resIcms = resolverIcmsProprioFiscal({
    valorIcmsXml: icmsDestacado,
    baseIcmsXml: Number(c.base_icms) || 0,
    aliquotaXml: Number(c.aliquota_icms) || 0,
    valorTotal: valorTotalItem,
    aliquotaPresumida,
    situacao: "TRIBUTADA",
  });
  resIcms.logs.forEach((l: string) => logsIcms.push(l));

  const icmsFinal = resIcms.icms_proprio_calculado;
  const aplicouPresuncao = resIcms.presumido;
  const baseIcmsPresumida = resIcms.base_calculo_icms;
  const presuncao = {
    aliquotaUsada: resIcms.aliquota_icms_utilizada,
    motivo: aplicouPresuncao
      ? `[PRESUNCAO] ICMS calculado por alíquota presumida ${resIcms.aliquota_icms_utilizada}% × base R$ ${baseIcmsPresumida.toFixed(2)} = R$ ${icmsFinal.toFixed(2)}`
      : "",
  };


  const avaliacao = CalculoService.avaliarLiberacao({
    cst: c.cst ?? c.csosn,
    cfop: c.cfop,
    ncm: c.ncm,
    cest: c.cest,
    valor_icms_st_ret: c.valor_icms_st_ret ?? 0,
    valor_icms_st_xml: c.valor_icms_st ?? 0,
    valor_icms: icmsFinal,
    sujeitoST: !!c.sujeitoST,
  });

  const bloqueioICMS = avaliacao.bloqueios.find((b: any) => b.tributo === "ICMS_PROPRIO");
  const bloqueioST = avaliacao.bloqueios.find((b: any) => b.tributo === "ICMS_ST");
  // "BLOQUEADO" reflete o ICMS da operação; o bloqueio de ST isolado
  // (ex.: CST 00, que nunca gera ST nova) é sinalizado à parte.
  const bloqueado = !avaliacao.liberado.ICMS_PROPRIO;
  const stBloqueado = !avaliacao.liberado.ICMS_ST;

  // ICMS próprio = valor consolidado (destacado OU presumido), tratado igual.
  const valorICMSProprio = icmsFinal;

  const calculo: Record<string, unknown> = {
    status: bloqueado ? "BLOQUEADO" : "CALCULADO",
    bloqueado,
    st_bloqueado: stBloqueado,
    motivo_st: bloqueioST?.motivo ?? null,
    tributos_bloqueados: avaliacao.bloqueios.map((b: any) => b.tributo),
    valor_icms_proprio: avaliacao.liberado.ICMS_PROPRIO ? valorICMSProprio : 0,
    valor_icms_st: avaliacao.liberado.ICMS_ST ? (Number(c.valor_icms_st_calculado) || 0) : 0,
    base_calc: avaliacao.liberado.ICMS_PROPRIO
      ? (Number(c.base_icms) || valorTotalItem || 0)
      : 0,
    valor_total: valorTotalItem,
    valor_icms: avaliacao.liberado.ICMS_PROPRIO ? valorICMSProprio : 0,
    icms_destacado_nf: icmsFoiDestacado,
    icms_foi_presumido: !icmsFoiDestacado,
    icms_presumido: aplicouPresuncao,
    icms_proprio_presumido: aplicouPresuncao,
    presuncao_credito: aplicouPresuncao,
    presuncao_credito_aliq: aplicouPresuncao ? presuncao.aliquotaUsada : null,
    aliquota_presumida: aplicouPresuncao ? presuncao.aliquotaUsada : null,
    base_icms_presumida: aplicouPresuncao ? baseIcmsPresumida : 0,
    fundamento: aplicouPresuncao
      ? `${c.fundamento || ""} — ${presuncao.motivo}`.trim()
      : (c.fundamento ?? null),
    cfop: c.cfop ?? null,
    cst: c.cst ?? c.csosn ?? null,
    ncm: c.ncm ?? null,
    cest: c.cest ?? null,
    bloqueios: avaliacao.bloqueios,
    advertencias: avaliacao.advertencias,
    conflito_cst_cfop: avaliacao.conflito,
    revisao_manual: avaliacao.revisaoManual,
    motivo: bloqueioICMS?.motivo ?? null,
    processado_em: avaliacao.processado_em,
  };

  const memoria = (avaliacao.memoria as string[]).map((linha) => ({ linha }));
  logsIcms.forEach((linha) => memoria.push({ linha }));
  if (aplicouPresuncao) memoria.push({ linha: presuncao.motivo });
  CalculoService.validarPresuncao(calculo).avisos.forEach((a) => memoria.push({ linha: a }));

  const fundamentos = [
    avaliacao.permCST?.fundamento,
    avaliacao.permCFOP?.fundamento,
    ...avaliacao.bloqueios.map((b: any) => b.fundamento),
    aplicouPresuncao ? presuncao.motivo : null,
  ].filter(Boolean) as string[];

  return { calculo, memoria, fundamentos, avaliacao };
}

export const ExecucaoTributariaService = {
  /** Registra uma execução concluída e dispara todo o fluxo automático. */
  registrar(entrada: EntradaExecucao): ExecucaoTributaria {
    const execucao = ExecucaoRepository.salvar(
      montar(entrada, novoId(), new Date().toISOString(), "CONCLUIDA"),
    );
    publicarFluxo(execucao, entrada, false);
    return execucao;
  },

  /** Recalcula/atualiza uma execução existente preservando o histórico. */
  recalcular(id: string, entrada: EntradaExecucao): ExecucaoTributaria {
    const atual = ExecucaoRepository.buscar(id);
    if (!atual) return ExecucaoTributariaService.registrar(entrada);
    const atualizada = ExecucaoRepository.salvar(
      montar({ ...atual, ...entrada } as EntradaExecucao, atual.id, atual.criadoEm, "RECALCULADA"),
    );
    invalidarCache(atualizada, entrada);
    publicarFluxo(atualizada, entrada, true);
    return atualizada;
  },

  /** Confirmação do usuário (encerra a revisão do item). */
  confirmar(id: string, usuarioId?: string | null): ExecucaoTributaria | undefined {
    const atual = ExecucaoRepository.buscar(id);
    if (!atual) return undefined;
    const confirmada = ExecucaoRepository.salvar({
      ...atual,
      status: "CONFIRMADA",
      usuarioId: usuarioId ?? atual.usuarioId,
      atualizadoEm: new Date().toISOString(),
    });
    IntegrationCore.publicar({
      tipo: "CALCULO_CONFIRMADO",
      origem: "EXECUCAO_TRIBUTARIA",
      destino: ["RASTREABILIDADE", "INDICADORES", "GESTAO_PROCESSOS"],
      objeto: { tipo: "EXECUCAO_TRIBUTARIA", id: confirmada.id },
      contexto: contextoDe(confirmada),
      payload: { status: confirmada.status },
    });
    return confirmada;
  },

  /**
   * Reclassificação manual pelo usuário.
   * Após persistir a nova classificação, dispara automaticamente o
   * recálculo (mesmo motor usado por recalcular()), respeitando os
   * bloqueios de CST/CSOSN × CFOP, grava calculo/memória/fundamentos
   * e só então invalida o cache.
   */
  reclassificar(id: string, classificacao: Record<string, unknown>, usuarioId?: string | null) {
    const atual = ExecucaoRepository.buscar(id);
    if (!atual) return undefined;

    // 1) persiste a nova classificação
    const comClassificacao = ExecucaoRepository.salvar({
      ...atual,
      classificacao,
      usuarioId: usuarioId ?? atual.usuarioId,
      atualizadoEm: new Date().toISOString(),
    });

    IntegrationCore.publicar({
      tipo: "USUARIO_ALTEROU_CLASSIFICACAO",
      origem: "UI",
      destino: ["RASTREABILIDADE", "INDICADORES"],
      objeto: { tipo: "EXECUCAO_TRIBUTARIA", id: comClassificacao.id },
      contexto: contextoDe(comClassificacao),
      payload: { classificacao },
    });

    // 2) recalcula com a nova classificação (gate CST × CFOP)
    const { calculo, memoria, fundamentos } = calcularComGate(classificacao);

    const nova = ExecucaoRepository.salvar(
      montar(
        {
          ...comClassificacao,
          classificacao,
          calculo,
          memoria,
          fundamentos,
        } as unknown as EntradaExecucao,
        comClassificacao.id,
        comClassificacao.criadoEm,
        "RECALCULADA",
      ),
    );

    // 3) invalida cache DEPOIS de gravar o novo cálculo
    const c = classificacao as Record<string, any>;
    invalidarCache(nova, { ncm: c?.ncm ?? null, segmento: c?.segmento ?? null });
    if (nova.produtoId) TaxCache.invalidar("classificacao", nova.produtoId);

    // 4) publica o fluxo de recálculo (inclui CALCULO_RECALCULADO)
    publicarFluxo(nova, { ncm: c?.ncm ?? null, segmento: c?.segmento ?? null }, true);

    return nova;
  },

  buscar: ExecucaoRepository.buscar,
  listar: ExecucaoRepository.listar,
  porEmpresa: ExecucaoRepository.porEmpresa,
  porCompetencia: ExecucaoRepository.porCompetencia,
  porProduto: ExecucaoRepository.porProduto,
  porProcesso: ExecucaoRepository.porProcesso,
};
