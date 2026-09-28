// Camada de decisões validadas manualmente (ICMS-ST).
// Não substitui o motor de classificação: apenas responde antes dele
// quando o mesmo padrão (NCM + assinatura de descrição) já foi validado.
import { TextNormalizer } from "@/modules/fiscal/tributario/normalizers/TextNormalizer";
import { listarDecisoesValidadas, registrarDecisaoValidada } from "@/lib/stDecisoes.functions";

export interface DecisaoValidada {
  id: string;
  ncm_prefixo: string;
  assinatura_descricao: string;
  status_confirmado: "ST_CONFIRMADA" | "NAO_ENQUADRADO";
  regra_id: string | null;
  validado_em: string;
  observacao: string | null;
}

let cache: DecisaoValidada[] = [];
let carregado = false;

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Assinatura estável da descrição: radicais únicos ordenados. */
function assinatura(descricao: unknown): string {
  const rad = [...new Set(TextNormalizer.radicais(descricao))].sort();
  return rad.join(" ");
}

export const DecisoesValidadasService = {
  assinatura,
  digitos,
  carregado: () => carregado,
  cache: () => cache,

  async carregar(): Promise<DecisaoValidada[]> {
    try {
      cache = (await listarDecisoesValidadas()) as DecisaoValidada[];
      carregado = true;
    } catch {
      carregado = false;
    }
    return cache;
  },

  /** Busca síncrona no cache — usada pelo ClassificationEngine. */
  buscar(ncm: unknown, descricao: unknown): DecisaoValidada | null {
    const nd = digitos(ncm);
    const sig = assinatura(descricao);
    if (!nd || !sig) return null;
    let melhor: DecisaoValidada | null = null;
    for (const d of cache) {
      const pref = digitos(d.ncm_prefixo);
      if (!pref || !nd.startsWith(pref)) continue;
      if (d.assinatura_descricao !== sig) continue;
      if (!melhor || pref.length > digitos(melhor.ncm_prefixo).length) melhor = d;
    }
    return melhor;
  },

  async registrar(params: {
    ncm: unknown;
    descricao: unknown;
    status: "ST_CONFIRMADA" | "NAO_ENQUADRADO";
    regraId?: string | null;
    observacao?: string | null;
  }): Promise<DecisaoValidada> {
    const row = (await registrarDecisaoValidada({
      data: {
        ncm_prefixo: digitos(params.ncm),
        assinatura_descricao: assinatura(params.descricao),
        status_confirmado: params.status,
        regra_id: params.regraId ?? null,
        observacao: params.observacao ?? null,
      },
    })) as DecisaoValidada;
    cache = [row, ...cache];
    carregado = true;
    return row;
  },
};
