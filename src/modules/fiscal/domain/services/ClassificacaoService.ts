// Service: classificação fiscal de um produto para ICMS-ST.
// Encapsula chamadas ao ClassificationEngine e à Factory de regra.
import { ClassificationEngine } from "../engines/ClassificationEngine";
import { RegraFactory } from "../factories/RegraFactory";
import type {
  ProdutoNF,
  ResultadoClassificacao,
  RegraTributaria,
} from "../entities/types";

export const ClassificacaoService = {
  classificar(
    produto: ProdutoNF & { ufOrigem?: string; ufDestino?: string; valor?: number },
  ): ResultadoClassificacao {
    return ClassificationEngine.classificar(produto);
  },
  identificarHeuristica(produto: ProdutoNF) {
    return ClassificationEngine.identificarHeuristica(produto);
  },
  sugerirRegra(produto: ProdutoNF): RegraTributaria | null {
    return RegraFactory.sugerir(produto);
  },
};
