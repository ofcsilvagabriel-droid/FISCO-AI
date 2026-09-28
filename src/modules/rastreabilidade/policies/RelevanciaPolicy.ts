// Policy de relevância — traduz eventos de plataforma em ações
// rastreáveis de negócio. Eventos técnicos são descartados aqui.
import type { DomainEvent, TipoEvento } from "@/core/integration";
import type { AcaoRastreavel } from "../entities/TrilhaEvento";

const MAPA: Partial<Record<TipoEvento, AcaoRastreavel>> = {
  CLASSIFICACAO_CONCLUIDA: "PRODUTO_CLASSIFICADO",
  USUARIO_ALTEROU_CLASSIFICACAO: "PRODUTO_RECLASSIFICADO",
  BENEFICIO_IDENTIFICADO: "BENEFICIO_IDENTIFICADO",
  BENEFICIO_REMOVIDO: "BENEFICIO_REMOVIDO",
  CALCULO_EXECUTADO: "CALCULO_EXECUTADO",
  CALCULO_RECALCULADO: "CALCULO_RECALCULADO",
  CALCULO_CONFIRMADO: "CALCULO_CONFIRMADO",
  LEGISLACAO_ATUALIZADA: "BASE_ALTERADA",
  UPLOAD_REALIZADO: "UPLOAD_REALIZADO",
  BASE_IMPORTADA: "IMPORTACAO",
  PARAMETRO_ALTERADO: "PARAMETRO_ALTERADO",
  EXCLUSAO_REALIZADA: "EXCLUSAO",
  PROCESSO_CONCLUIDO: "PROCESSO_CONCLUIDO",
  RELATORIO_PUBLICADO: "RELATORIO_PUBLICADO",
};

export const RelevanciaPolicy = {
  /** Retorna a ação rastreável, ou null quando o evento é irrelevante. */
  acaoDe(evento: DomainEvent): AcaoRastreavel | null {
    return MAPA[evento.tipo] ?? null;
  },
  relevante(evento: DomainEvent): boolean {
    return RelevanciaPolicy.acaoDe(evento) !== null;
  },
};
