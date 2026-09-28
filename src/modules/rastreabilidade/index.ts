// Contrato do módulo Rastreabilidade junto ao Integration Core.
import type { ModuleContract } from "@/core/integration";
import type { AIReadProvider } from "@/core/ai";
import { RastreabilidadeService } from "./services/RastreabilidadeService";

export const RastreabilidadeModule: ModuleContract = {
  nome: "RASTREABILIDADE",
  versao: "1.0.0",
  assinaturas: [
    {
      nome: "rastreabilidade-trilha",
      tipos: "*",
      handle: (evento) => { RastreabilidadeService.registrarDeEvento(evento); },
    },
  ],
  capacidades: {
    porProduto: ((id: string) => RastreabilidadeService.porProduto(id)) as never,
    porEmpresa: ((id: string) => RastreabilidadeService.porEmpresa(id)) as never,
    porExecucao: ((id: string) => RastreabilidadeService.porExecucao(id)) as never,
  },
};

export const RastreabilidadeAIProvider: AIReadProvider = {
  nome: "RASTREABILIDADE",
  consultar(escopo) {
    if (escopo.execucaoId) return RastreabilidadeService.porExecucao(escopo.execucaoId);
    if (escopo.produtoId) return RastreabilidadeService.porProduto(escopo.produtoId);
    if (escopo.empresaId) return RastreabilidadeService.porEmpresa(escopo.empresaId);
    return RastreabilidadeService.listar().slice(0, escopo.limite ?? 200);
  },
};

export { RastreabilidadeService } from "./services/RastreabilidadeService";
export { TrilhaRepository } from "./repositories/TrilhaRepository";
export { RelevanciaPolicy } from "./policies/RelevanciaPolicy";
export { ACOES_RASTREAVEIS } from "./entities/TrilhaEvento";
export type { AcaoRastreavel, ContextoTrilha, TrilhaEvento } from "./entities/TrilhaEvento";
