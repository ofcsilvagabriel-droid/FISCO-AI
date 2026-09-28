// Contrato do módulo Execução Tributária no Integration Core.
import type { ModuleContract } from "@/core/integration";
import type { AIReadProvider } from "@/core/ai";
import { ExecucaoTributariaService } from "./services/ExecucaoTributariaService";
import { ExecucaoRepository } from "./repositories/ExecucaoRepository";

export const ExecucaoTributariaModule: ModuleContract = {
  nome: "EXECUCAO_TRIBUTARIA",
  versao: "1.0.0",
  capacidades: {
    registrar: ((e: never) => ExecucaoTributariaService.registrar(e)) as never,
    buscar: ((id: string) => ExecucaoTributariaService.buscar(id)) as never,
    porEmpresa: ((id: string) => ExecucaoTributariaService.porEmpresa(id)) as never,
  },
};

function filtrar(escopo: { execucaoId?: string | null; produtoId?: string | null; empresaId?: string | null; competencia?: string | null }) {
  if (escopo.execucaoId) { const e = ExecucaoRepository.buscar(escopo.execucaoId); return e ? [e] : []; }
  if (escopo.produtoId) return ExecucaoRepository.porProduto(escopo.produtoId);
  if (escopo.empresaId) return ExecucaoRepository.porEmpresa(escopo.empresaId);
  if (escopo.competencia) return ExecucaoRepository.porCompetencia(escopo.competencia);
  return ExecucaoRepository.listar();
}

export const ExecucaoAIProviders: AIReadProvider[] = [
  { nome: "CLASSIFICACAO", consultar: (e) => filtrar(e).map((x) => x.classificacao).filter(Boolean) },
  { nome: "BENEFICIOS", consultar: (e) => filtrar(e).flatMap((x) => x.beneficios) },
  { nome: "MEMORIA_CALCULO", consultar: (e) => filtrar(e).flatMap((x) => x.memoria) },
  { nome: "HISTORICO", consultar: (e) => filtrar(e) },
];

export { ExecucaoTributariaService } from "./services/ExecucaoTributariaService";
export { ExecucaoRepository } from "./repositories/ExecucaoRepository";
export { ExecucaoTributariaSchema } from "./entities/ExecucaoTributaria";
export type { ExecucaoTributaria, StatusExecucao } from "./entities/ExecucaoTributaria";
export type { EntradaExecucao } from "./services/ExecucaoTributariaService";
