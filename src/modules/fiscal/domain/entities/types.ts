// Domain entities — puros, sem lógica. Descrevem o shape dos dados
// que atravessam Services e Engines. Não substituem os objetos JS
// já produzidos pelos motores; servem como contrato tipado.

export interface ProdutoNF {
  ncm?: string;
  descricao?: string;
  cest?: string | null;
  cst?: string | null;
  cfop?: string | null;
  orig?: string | null;
  vProd?: number;
  base_icms?: number;
  aliquota_icms?: number;
  vICMS?: number;
  pmc?: number | null;
  pmpf?: number | null;
  [key: string]: unknown;
}

export interface NotaFiscal {
  chave?: string;
  emit_uf?: string;
  dest_uf?: string;
  emit_cnpj?: string;
  dest_cnpj?: string;
  produtos: ProdutoNF[];
  [key: string]: unknown;
}

export interface RegraTributaria {
  id?: string;
  item_ricms?: string;
  cest?: string | null;
  ncm_patterns?: string[];
  descricao_legal?: string;
  segmento?: string;
  fundamento?: string;
  fonte?: string;
  mva_original?: number | null;
  mva_ajustada_4?: number | null;
  mva_ajustada_7?: number | null;
  mva_ajustada_12?: number | null;
  [key: string]: unknown;
}

export type StatusClassificacao =
  | "ST_CONFIRMADA"
  | "ST_SUGERIDA"
  | "REVISAO_NECESSARIA"
  | "NAO_ENQUADRADO"
  | "SEM_REGRA_POR_NCM"
  | "VALIDACAO_MANUAL";

export interface ResultadoClassificacao {
  status: StatusClassificacao | string;
  regra: RegraTributaria | null;
  score_ncm: number;
  nivel_correspondencia: string;
  evidencias_positivas: string[];
  evidencias_negativas: string[];
  condicoes_pendentes: string[];
  confianca: string;
  log: string[];
  [key: string]: unknown;
}

export interface ResultadoCalculo {
  tipo: string;
  base?: number;
  valor?: number;
  fundamento?: string;
  [key: string]: unknown;
}
