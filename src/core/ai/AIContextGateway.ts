// Gateway de leitura para IA. Reúne providers registrados pelos
// módulos e monta o dossiê. Não implementa IA — apenas a porta.
import { IntegrationCore } from "@/core/integration";
import { Versioning } from "@/core/versioning";
import type { AIAgentPort, AIReadProvider, DossieIA, EscopoConsultaIA } from "./contracts";

const providers = new Map<string, AIReadProvider>();
let agente: AIAgentPort | null = null;

async function coletar(nome: AIReadProvider["nome"], escopo: EscopoConsultaIA): Promise<unknown[]> {
  const p = providers.get(nome);
  if (!p) return [];
  return await p.consultar(escopo);
}

export const AIContextGateway = {
  registrarProvider(provider: AIReadProvider): void { providers.set(provider.nome, provider); },
  providers(): string[] { return [...providers.keys()]; },
  registrarAgente(port: AIAgentPort): void { agente = port; },
  agente(): AIAgentPort | null { return agente; },

  async dossie(escopo: EscopoConsultaIA): Promise<DossieIA> {
    const eventos = escopo.execucaoId
      ? IntegrationCore.eventosPorContexto("execucaoId", escopo.execucaoId)
      : escopo.empresaId
        ? IntegrationCore.eventosPorContexto("empresaId", escopo.empresaId)
        : IntegrationCore.eventos();

    const [contextoTributario, classificacao, beneficios, memoria, historico, rastreabilidade] =
      await Promise.all([
        coletar("CONTEXTO_TRIBUTARIO", escopo),
        coletar("CLASSIFICACAO", escopo),
        coletar("BENEFICIOS", escopo),
        coletar("MEMORIA_CALCULO", escopo),
        coletar("HISTORICO", escopo),
        coletar("RASTREABILIDADE", escopo),
      ]);

    return {
      escopo,
      geradoEm: new Date().toISOString(),
      versoes: Versioning.selo(),
      contextoTributario,
      classificacao,
      beneficios,
      memoria,
      historico,
      rastreabilidade,
      eventos: eventos.slice(-(escopo.limite ?? 200)),
    };
  },
};
