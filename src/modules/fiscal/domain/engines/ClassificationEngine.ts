// Engine de Classificação — responsabilidade única: decidir se e como
// um produto se enquadra em ICMS-ST segundo o RICMS/BA (Anexo 1 2026)
// e sinalizar necessidade de revisão manual. Fachada sobre
// motorClassificacaoST + motorST (identificação heurística legada).
//
// Camadas adicionais (não alteram o motor):
//   1. decisões validadas manualmente — respondem antes do motor;
//   2. expansão de abreviações por IA — apenas alimenta a comparação
//      textual já existente, nunca decide status.
import { classificarProduto } from "../../engines/motorClassificacaoST";
import { identificarST } from "../../engines/motorST";
import { DecisoesValidadasService } from "../services/DecisoesValidadasService";
import { DescricaoIAService } from "../services/DescricaoIAService";
import type {
  ProdutoNF,
  ResultadoClassificacao,
} from "../entities/types";

export const ClassificationEngine = {
  classificar(produto: ProdutoNF & {
    ufOrigem?: string;
    ufDestino?: string;
    valor?: number;
  }): ResultadoClassificacao {
    // 1) decisão validada manualmente para o mesmo padrão NCM + descrição
    const decisao = DecisoesValidadasService.buscar(produto.ncm, produto.descricao);
    if (decisao) {
      const base = classificarProduto({
        ...produto,
        descricao: DescricaoIAService.expandida(produto.descricao),
      }) as ResultadoClassificacao;
      const dataBR = new Date(decisao.validado_em).toLocaleDateString("pt-BR");
      return {
        ...base,
        status: decisao.status_confirmado,
        fundamento: `Validação manual anterior (${dataBR})${decisao.regra_id ? ` — regra ${decisao.regra_id}` : ""}.`,
        origem_decisao: "DECISAO_VALIDADA",
        decisao_validada: decisao,
        evidencias_positivas: [
          `Classificação definida por validação manual anterior em ${dataBR} (NCM ${decisao.ncm_prefixo}).`,
          ...(base.evidencias_positivas ?? []),
        ],
      } as ResultadoClassificacao;
    }

    // 2) fluxo normal do motor (descrição expandida quando disponível)
    return classificarProduto({
      ...produto,
      descricao: DescricaoIAService.expandida(produto.descricao),
    }) as ResultadoClassificacao;
  },

  identificarHeuristica(produto: ProdutoNF) {
    return identificarST(produto);
  },
};
