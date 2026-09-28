// Service: persistência local do "Arquivo Fiscal" por empresa/mês.
// Centraliza acesso ao localStorage — nenhum componente lê/grava direto.
const ARQUIVO_KEY = "fiscoai:arquivo:v1";

export type ArquivoFiscal = Record<string, unknown>;

export const ArquivoFiscalService = {
  load(): ArquivoFiscal {
    try {
      const raw = localStorage.getItem(ARQUIVO_KEY);
      return raw ? (JSON.parse(raw) as ArquivoFiscal) : {};
    } catch {
      return {};
    }
  },
  save(data: ArquivoFiscal): void {
    try {
      localStorage.setItem(ARQUIVO_KEY, JSON.stringify(data));
    } catch {
      /* ignore quota */
    }
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
