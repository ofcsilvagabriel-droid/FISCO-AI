// Bootstrap da plataforma — registra todos os módulos no Integration
// Core e expõe as portas de leitura para a IA. Idempotente.
import { IntegrationCore } from "@/core/integration";
import { AIContextGateway } from "@/core/ai";
import { RastreabilidadeModule, RastreabilidadeAIProvider } from "@/modules/rastreabilidade";
import { ExecucaoTributariaModule, ExecucaoAIProviders } from "@/modules/fiscal/execucao";
import { IndicadoresModule } from "@/modules/indicadores";
import { ProcessosModule } from "@/modules/processos";

let iniciado = false;

export function inicializarPlataforma(): void {
  if (iniciado) return;
  iniciado = true;

  [RastreabilidadeModule, ExecucaoTributariaModule, IndicadoresModule, ProcessosModule]
    .forEach((m) => IntegrationCore.registrarModulo(m));

  [RastreabilidadeAIProvider, ...ExecucaoAIProviders]
    .forEach((p) => AIContextGateway.registrarProvider(p));
}

export function plataformaIniciada(): boolean { return iniciado; }
