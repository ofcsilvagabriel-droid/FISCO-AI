import { LocalStorageRepository } from "@/modules/fiscal/domain/repositories/LocalStorageRepository";
import { ExecucaoTributariaSchema, type ExecucaoTributaria } from "../entities/ExecucaoTributaria";

const base = new LocalStorageRepository<ExecucaoTributaria>(
  "plataforma:execucoes-tributarias",
  ExecucaoTributariaSchema,
);

export const ExecucaoRepository = {
  salvar: (e: ExecucaoTributaria) => base.upsert(e),
  buscar: (id: string) => base.findById(id),
  listar: () => base.getAll(),
  porEmpresa: (empresaId: string) => base.query((e) => e.empresaId === empresaId),
  porCompetencia: (competencia: string) => base.query((e) => e.competencia === competencia),
  porProduto: (produtoId: string) => base.query((e) => e.produtoId === produtoId),
  porProcesso: (processoId: string) => base.query((e) => e.processoId === processoId),
  remover: (id: string) => base.remove(id),
  limpar: () => base.clear(),
};
