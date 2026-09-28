// Service — porta única de entrada do Motor Tributário para o
// restante da aplicação. Nenhum componente React deve importar
// engines/matchers/scorers diretamente.
import { MotorTributarioFactory } from "../factories/MotorTributarioFactory";
import { BeneficioProviderRegistry } from "../providers/BeneficioProvider";
import { LegislacaoIndexRepository } from "../repositories/LegislacaoIndexRepository";
import type { ContextoTributario, EntradaProduto, NormaTributaria } from "../types";

const motor = MotorTributarioFactory.criar();

export const MotorTributarioService = {
  /** Classifica um produto e devolve o Contexto Tributário completo. */
  classificar(entrada: EntradaProduto): ContextoTributario {
    return motor.classificar(entrada);
  },

  /** Classificação em lote (itens de uma NF-e, por exemplo). */
  classificarLote(entradas: EntradaProduto[]): ContextoTributario[] {
    return entradas.map((e) => motor.classificar(e));
  },

  /**
   * Enriquece o contexto com os providers de benefício registrados.
   * O Motor de Benefícios é independente: recebe apenas o contexto.
   */
  async aplicarBeneficios(contexto: ContextoTributario): Promise<ContextoTributario> {
    const providers = BeneficioProviderRegistry.listar();
    if (!providers.length) return contexto;
    const extras = (await Promise.all(providers.map((p) => p.avaliar(contexto)))).flat();
    return { ...contexto, regimes: [...contexto.regimes, ...extras] };
  },

  /** Consulta da base legal estruturada (auditoria / aba de legislações). */
  consultarLegislacaoPorNCM(ncm: string): NormaTributaria[] {
    return LegislacaoIndexRepository.candidatasPorNCM(ncm);
  },
  consultarLegislacaoPorCEST(cest: string): NormaTributaria[] {
    return LegislacaoIndexRepository.porCEST(cest);
  },
};
