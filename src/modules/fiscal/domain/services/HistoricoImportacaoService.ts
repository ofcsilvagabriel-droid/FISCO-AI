import { carregarFiscal, salvarFiscal } from "./PersistenciaFiscalLocal";

const HISTORICO_KEY = "fiscoai:historico-importacao:v1";

export const HistoricoImportacaoService = {
  async load(): Promise<unknown[]> {
    const dados = await carregarFiscal<unknown[]>("historico-importacao", HISTORICO_KEY, []);
    if (!Array.isArray(dados)) throw new Error("Histórico de importações salvo é inválido.");
    return dados;
  },
  save(dados: unknown[]): Promise<void> {
    return salvarFiscal("historico-importacao", HISTORICO_KEY, dados);
  },
};
