// Indicadores da plataforma — derivados das execuções tributárias.
// Recalculados sob demanda e reagindo a eventos (sem cálculo fiscal).
import { IntegrationCore, type ModuleContract } from "@/core/integration";
import { TaxCache } from "@/core/cache";
import { ExecucaoRepository } from "@/modules/fiscal/execucao";

export interface Indicadores {
  totalExecucoes: number;
  classificacoesAutomaticas: number;
  emRevisao: number;
  confirmadas: number;
  comBeneficio: number;
  scoreMedio: number;
  confiancaMedia: number;
  porCompetencia: Record<string, number>;
}

function media(valores: number[]): number {
  if (!valores.length) return 0;
  return Math.round((valores.reduce((a, b) => a + b, 0) / valores.length) * 10) / 10;
}

export const IndicadoresService = {
  calcular(filtro?: { empresaId?: string; competencia?: string }): Indicadores {
    return TaxCache.wrap<Indicadores>(
      { empresa: filtro?.empresaId ?? "todas", competencia: filtro?.competencia ?? "todas" },
      () => {
        let execucoes = ExecucaoRepository.listar();
        if (filtro?.empresaId) execucoes = execucoes.filter((e) => e.empresaId === filtro.empresaId);
        if (filtro?.competencia) execucoes = execucoes.filter((e) => e.competencia === filtro.competencia);

        const porCompetencia: Record<string, number> = {};
        execucoes.forEach((e) => {
          const c = e.competencia ?? "sem-competencia";
          porCompetencia[c] = (porCompetencia[c] ?? 0) + 1;
        });

        return {
          totalExecucoes: execucoes.length,
          classificacoesAutomaticas: execucoes.filter((e) => (e.score ?? 0) >= 85).length,
          emRevisao: execucoes.filter((e) => (e.score ?? 0) < 85 && e.status !== "CONFIRMADA").length,
          confirmadas: execucoes.filter((e) => e.status === "CONFIRMADA").length,
          comBeneficio: execucoes.filter((e) => e.beneficios.length > 0).length,
          scoreMedio: media(execucoes.map((e) => e.score ?? 0)),
          confiancaMedia: media(execucoes.map((e) => e.confianca ?? 0)),
          porCompetencia,
        };
      },
      30 * 1000,
    );
  },
};

export const IndicadoresModule: ModuleContract = {
  nome: "INDICADORES",
  versao: "1.0.0",
  assinaturas: [
    {
      nome: "indicadores-recalculo",
      tipos: ["EXECUCAO_TRIBUTARIA_REGISTRADA", "CALCULO_RECALCULADO", "CALCULO_CONFIRMADO"],
      handle: (evento) => {
        if (evento.contexto.empresaId) TaxCache.invalidar("empresa", evento.contexto.empresaId);
        if (evento.contexto.competencia) TaxCache.invalidar("competencia", evento.contexto.competencia);
        TaxCache.invalidar("empresa", "todas");
        TaxCache.invalidar("competencia", "todas");
        IntegrationCore.publicar({
          tipo: "INDICADORES_ATUALIZADOS",
          origem: "INDICADORES",
          destino: ["DASHBOARD"],
          objeto: { tipo: "INDICADORES", id: evento.contexto.empresaId ?? null },
          contexto: evento.contexto,
          payload: { motivo: evento.tipo },
        });
      },
    },
  ],
  capacidades: {
    calcular: ((f: never) => IndicadoresService.calcular(f)) as never,
  },
};
