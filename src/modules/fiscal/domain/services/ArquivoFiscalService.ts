// Service: persistência local do "Arquivo Fiscal" por empresa/mês.
import { carregarFiscal, salvarFiscal } from "./PersistenciaFiscalLocal";
const ARQUIVO_KEY = "fiscoai:arquivo:v1";

export type ArquivoFiscal = Record<string, unknown>;

export const ArquivoFiscalService = {
  async load(): Promise<ArquivoFiscal> {
    const dados = await carregarFiscal<ArquivoFiscal>("arquivo", ARQUIVO_KEY, {});
    if (!dados || typeof dados !== "object" || Array.isArray(dados)) throw new Error("Arquivo Fiscal salvo é inválido.");
    return dados;
  },
  save(data: ArquivoFiscal): Promise<void> {
    return salvarFiscal("arquivo", ARQUIVO_KEY, data);
  },
  mesAno(s: string | undefined | null): string {
    if (!s) return "0000-00";
    const m = String(s).match(/^(\d{4})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}` : "0000-00";
  },
  chaveEmpresa(cnpj: string | undefined | null, nome: string | undefined | null): string {
    const c = (cnpj || "").replace(/\D/g, "");
    return c || (nome || "SEM_DESTINATARIO").toUpperCase();
  },
};
