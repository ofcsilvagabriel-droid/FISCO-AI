// Gateway do Sistema de Gestão de Processos — integração 100% por API.
// Os dois sistemas permanecem independentes; a comunicação é feita
// por eventos de saída (webhooks) e por chamadas REST autenticadas.
import { IntegrationCore, type ModuleContract, type TipoEvento } from "@/core/integration";

export interface ConfiguracaoGestao {
  baseUrl: string;
  /** Token estático ou provedor assíncrono (permite refresh do JWT). */
  token?: string | null;
  tokenProvider?: () => string | null | Promise<string | null>;
  eventos?: TipoEvento[];
  caminho?: string;
}

const EVENTOS_PADRAO: TipoEvento[] = [
  "CLASSIFICACAO_CONCLUIDA",
  "CALCULO_EXECUTADO",
  "CALCULO_CONFIRMADO",
  "EXECUCAO_TRIBUTARIA_REGISTRADA",
  "TAREFA_CONCLUIDA",
  "RELATORIO_PUBLICADO",
];

export const ProcessosGatewayService = {
  /** Conecta o sistema de gestão externo ao barramento de eventos. */
  conectar(cfg: ConfiguracaoGestao) {
    IntegrationCore.conectarSistemaExterno({
      nome: "GESTAO_PROCESSOS",
      baseUrl: cfg.baseUrl,
      caminho: cfg.caminho ?? "/webhooks/tributario",
      token: cfg.tokenProvider ?? (cfg.token ? () => cfg.token ?? null : undefined),
      tipos: cfg.eventos ?? EVENTOS_PADRAO,
    });
  },

  desconectar() { IntegrationCore.desconectarSistemaExterno("GESTAO_PROCESSOS"); },
  conectado() { return IntegrationCore.integracoes().some((i) => i.nome === "GESTAO_PROCESSOS"); },

  /** Entrada: o sistema de gestão informa que uma tarefa foi aberta. */
  receberTarefa(tarefa: { processoId: string; tarefaId: string; empresaId?: string; competencia?: string }) {
    IntegrationCore.publicar({
      tipo: "PARAMETRO_ALTERADO",
      origem: "GESTAO_PROCESSOS",
      destino: ["EXECUCAO_TRIBUTARIA"],
      objeto: { tipo: "TAREFA", id: tarefa.tarefaId },
      contexto: {
        processoId: tarefa.processoId,
        tarefaId: tarefa.tarefaId,
        empresaId: tarefa.empresaId ?? null,
        competencia: tarefa.competencia ?? null,
      },
      payload: { descricao: `Tarefa ${tarefa.tarefaId} recebida do sistema de gestão.` },
    });
  },
};

export const ProcessosModule: ModuleContract = {
  nome: "GESTAO_PROCESSOS",
  versao: "1.0.0",
  capacidades: {
    conectar: ((cfg: never) => ProcessosGatewayService.conectar(cfg)) as never,
    receberTarefa: ((t: never) => ProcessosGatewayService.receberTarefa(t)) as never,
  },
};
