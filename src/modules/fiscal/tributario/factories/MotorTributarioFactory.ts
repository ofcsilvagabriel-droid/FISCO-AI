// Factory do Motor Tributário — monta o pipeline das 3 camadas
// com as strategies desejadas (permite composições alternativas).
import { EvidenceEngine } from "../engines/EvidenceEngine";
import { LegalEngine } from "../engines/LegalEngine";
import { TaxConsolidator } from "../engines/TaxConsolidator";
import { STRATEGIES_PADRAO } from "../strategies/regimes";
import type {
  ContextoTributario,
  EntradaProduto,
  NormaTributaria,
  RegimeStrategy,
} from "../types";

export interface MotorTributario {
  classificar(entrada: EntradaProduto): ContextoTributario;
}

export interface OpcoesMotor {
  strategies?: RegimeStrategy[];
  baseLegal?: NormaTributaria[];
}

export const MotorTributarioFactory = {
  criar(opcoes: OpcoesMotor = {}): MotorTributario {
    const strategies = opcoes.strategies ?? STRATEGIES_PADRAO;
    return {
      classificar(entrada: EntradaProduto): ContextoTributario {
        const perfil = EvidenceEngine.perfilar(entrada);              // camada 1
        const juridico = LegalEngine.consultar(perfil, opcoes.baseLegal); // camada 2
        return TaxConsolidator.consolidar(perfil, juridico, strategies, { // camada 3
          aliquotaDestacada: entrada.aliquotaDestacada ?? null,
          origemImportada: ["1", "2", "3", "6", "7", "8"].includes(String(entrada["orig"] ?? "")),
        });
      },
    };
  },
};
