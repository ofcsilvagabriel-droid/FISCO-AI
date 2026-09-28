// Faixas de classificação — política única do Motor Tributário.
import type { FaixaClassificacao } from "../types";

export const ClassificacaoPolicy = {
  faixa(indiceOuScore: number): FaixaClassificacao {
    if (indiceOuScore >= 95) return "AUTOMATICA";
    if (indiceOuScore >= 85) return "ALTA_CONFIANCA";
    if (indiceOuScore >= 70) return "COM_ALERTA";
    if (indiceOuScore >= 50) return "REVISAO_OBRIGATORIA";
    return "NAO_CLASSIFICAR";
  },

  /** o valor decisório combina score e coerência (a menor governa) */
  valorDecisorio(score: number, confianca: number): number {
    return Math.round(Math.min(score, confianca));
  },

  classificavel(faixa: FaixaClassificacao): boolean {
    return faixa === "AUTOMATICA" || faixa === "ALTA_CONFIANCA";
  },

  descrever(faixa: FaixaClassificacao): string {
    return {
      AUTOMATICA: "Classificação automática (95-100).",
      ALTA_CONFIANCA: "Alta confiança (85-94).",
      COM_ALERTA: "Classificação com alerta (70-84) — conferência recomendada.",
      REVISAO_OBRIGATORIA: "Revisão obrigatória (50-69).",
      NAO_CLASSIFICAR: "Abaixo de 50 — não classificar automaticamente.",
    }[faixa];
  },
};
