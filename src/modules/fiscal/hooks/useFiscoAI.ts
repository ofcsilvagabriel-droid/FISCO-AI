// Hook: superfície única do domínio fiscal para componentes.
// Componentes chamam este hook; ele delega para Services que, por sua vez,
// consomem Engines. Nenhuma regra de negócio vive aqui — apenas ligação.
import { useCallback } from "react";
import {
  ClassificacaoService,
  CalculoService,
  LegislacaoService,
  ArquivoFiscalService,
} from "../domain/services";

export function useFiscoAI() {
  const classificar = useCallback(
    (produto: Parameters<typeof ClassificacaoService.classificar>[0]) =>
      ClassificacaoService.classificar(produto),
    [],
  );

  const sugerirRegra = useCallback(
    (produto: Parameters<typeof ClassificacaoService.sugerirRegra>[0]) =>
      ClassificacaoService.sugerirRegra(produto),
    [],
  );

  const consultarLegislacaoPorNCM = useCallback(
    (ncm: string) => LegislacaoService.porNCM(ncm),
    [],
  );

  const consultarLegislacaoPorCEST = useCallback(
    (cest: string) => LegislacaoService.porCEST(cest),
    [],
  );

  return {
    classificar,
    sugerirRegra,
    consultarLegislacaoPorNCM,
    consultarLegislacaoPorCEST,
    calculo: CalculoService,
    arquivo: ArquivoFiscalService,
  };
}

export type UseFiscoAI = ReturnType<typeof useFiscoAI>;
