// Provider padrão para o futuro Motor de Benefícios.
// Não implementa regras: apenas garante o ponto de extensão.
import type { BeneficioProvider, ContextoRegime, ContextoTributario } from "../types";

export const NoopBeneficioProvider: BeneficioProvider = {
  nome: "noop",
  avaliar(_contexto: ContextoTributario): ContextoRegime[] {
    return [];
  },
};

const registrados: BeneficioProvider[] = [];

export const BeneficioProviderRegistry = {
  registrar(provider: BeneficioProvider): void {
    if (!registrados.some((p) => p.nome === provider.nome)) registrados.push(provider);
  },
  listar(): BeneficioProvider[] {
    return [...registrados];
  },
  limpar(): void {
    registrados.length = 0;
  },
};
