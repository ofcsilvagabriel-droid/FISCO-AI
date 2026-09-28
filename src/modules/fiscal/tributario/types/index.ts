// ============================================================
// MOTOR TRIBUTÁRIO — Contratos públicos (Types / Interfaces)
// ------------------------------------------------------------
// Esta camada é puramente declarativa. Nenhuma regra aqui.
// Todo o restante do Motor Tributário depende SOMENTE destes
// contratos, o que permite trocar implementações (strategies,
// providers, repositories) sem refatoração estrutural.
// ============================================================

// ---------- Domínio de regimes tributários ---------------------------
// Novos regimes entram aqui e são automaticamente suportados pelo
// consolidador (o objeto tributário é indexado por regime).
export type RegimeTributario =
  | "ICMS_ST"
  | "ANTECIPACAO"
  | "DIFAL"
  | "MONOFASICO"
  | "BENEFICIO"
  | "CREDITO_PRESUMIDO"
  | "REDUCAO_BC"
  | "SUSPENSAO"
  | "ISENCAO"
  | "DIFERIMENTO"
  | "FCP"
  | "FCP_ST";

export type NivelNCM = "NENHUM" | "CAPITULO" | "POSICAO" | "SUBPOSICAO" | "ITEM";

export type FaixaClassificacao =
  | "AUTOMATICA"        // 95-100
  | "ALTA_CONFIANCA"    // 85-94
  | "COM_ALERTA"        // 70-84
  | "REVISAO_OBRIGATORIA" // 50-69
  | "NAO_CLASSIFICAR";  // < 50

// ---------- Camada 1 — Evidências ------------------------------------

export type TipoEvidencia =
  | "NCM"
  | "DESCRICAO"
  | "PALAVRA_CHAVE"
  | "FAMILIA"
  | "SEGMENTO"
  | "SUBSEGMENTO"
  | "CEST"
  | "MARCA"
  | "FABRICANTE"
  | "GTIN"
  | "UNIDADE"
  | "ORIGEM"
  | "DESTINO";

export interface Evidencia {
  tipo: TipoEvidencia;
  valor: string;
  /** Peso relativo da evidência (0-1) dentro do seu tipo. */
  peso: number;
  fonte: string;
  detalhe?: string;
}

export interface EntradaProduto {
  ncm?: string | null;
  descricao?: string | null;
  cest?: string | null;
  cst?: string | null;
  cfop?: string | null;
  marca?: string | null;
  fabricante?: string | null;
  gtin?: string | null;
  unidade?: string | null;
  ufOrigem?: string | null;
  ufDestino?: string | null;
  valor?: number | null;
  aliquotaDestacada?: number | null;
  [k: string]: unknown;
}

export interface PerfilProduto {
  ncm: string;
  ncmNivel: NivelNCM;
  familiaNCM: string;          // capítulo + posição (4 díg.)
  descricaoOriginal: string;
  descricaoNormalizada: string;
  palavrasChave: string[];
  segmento: string;
  subsegmento: string;
  segmentosCandidatos: Array<{ segmento: string; score: number }>;
  cest: string | null;
  marca: string | null;
  fabricante: string | null;
  gtin: string | null;
  unidade: string | null;
  ufOrigem: string | null;
  ufDestino: string | null;
  evidencias: Evidencia[];
}

// ---------- Camada 2 — Jurídico --------------------------------------

export interface NormaTributaria {
  id: string;
  regime: RegimeTributario;
  fonte: string;             // "RICMS/BA Anexo 1", "Convênio ICMS 52/91"...
  fundamento: string;
  item?: string;
  cest?: string | null;
  ncms: string[];            // NCMs declarados (dígitos, tamanho variável)
  descricaoLegal: string;
  segmento?: string;
  acordo?: string;
  protocolos: string[];
  convenios: string[];
  ufsSignatarias: { modo: "TODOS" | "TODOS_EXCETO" | "APENAS"; ufs: string[] };
  notas: string[];
  observacoes: string[];
  excecoes: string[];
  mvaOriginal: number | null;
  mvaAjustada4: number | null;
  mvaAjustada7: number | null;
  mvaAjustada12: number | null;
  reducoes: Array<{ tipo: string; cargaEfetiva: number | null; descricao: string }>;
  beneficios: string[];
  bruto?: unknown;           // registro original da base
}

export interface CandidatoJuridico {
  norma: NormaTributaria;
  ncmNivel: NivelNCM;
  digitosCoincidentes: number;
  aderenciaDescricao: number;   // 0-1
  aderenciaSegmento: number;    // 0-1
  cestConfere: boolean | null;  // null = não avaliável
}

export interface ResultadoJuridico {
  candidatos: CandidatoJuridico[];
  descartados: Array<{ norma: NormaTributaria; motivo: string }>;
  regimesEncontrados: RegimeTributario[];
}

// ---------- Exceções -------------------------------------------------

export type TipoExcecao =
  | "PRODUTO_EXCLUIDO"
  | "EXCECAO_LEGAL"
  | "NOTA_CONVENIO"
  | "NOTA_RICMS"
  | "EXCECAO_PROTOCOLO"
  | "DESCRICAO_INCOMPATIVEL"
  | "FINALIDADE_INCOMPATIVEL"
  | "UF_NAO_SIGNATARIA";

export interface Excecao {
  tipo: TipoExcecao;
  impeditiva: boolean;
  descricao: string;
  fundamento: string;
  normaId?: string;
}

// ---------- Score / Confiança ----------------------------------------

export interface DetalheScore {
  componente: "NCM" | "DESCRICAO" | "SEGMENTO" | "EXCECOES";
  maximo: number;
  obtido: number;
  motivo: string;
}

export interface ResultadoScore {
  total: number;              // 0-100
  detalhes: DetalheScore[];
}

export interface ResultadoConfianca {
  indice: number;             // 0-100
  coerencias: string[];
  incoerencias: string[];
}

// ---------- Camada 3 — Contexto Tributário ---------------------------

export interface ContextoRegime {
  regime: RegimeTributario;
  aplicavel: boolean;
  normaId: string | null;
  fundamento: string;
  detalhes: Record<string, unknown>;
}

export interface ContextoTributario {
  // Identificação
  ncm: string;
  segmento: string;
  subsegmento: string;
  descricaoNormalizada: string;
  palavrasChave: string[];
  cest: string | null;

  // Avaliação
  score: number;
  scoreDetalhes: DetalheScore[];
  confianca: number;
  confiancaDetalhes: ResultadoConfianca;
  faixa: FaixaClassificacao;
  classificavelAutomaticamente: boolean;

  // Regimes
  possuiST: boolean;
  possuiAntecipacao: boolean;
  regimes: ContextoRegime[];

  // Jurídico
  normaPrincipal: NormaTributaria | null;
  normasSecundarias: NormaTributaria[];
  protocolos: string[];
  convenios: string[];
  fundamentos: string[];
  beneficios: string[];
  observacoes: string[];
  excecoes: Excecao[];

  // Parâmetros para o Motor de Cálculo (somente dados, sem cálculo)
  aliquotas: { interna: number | null; interestadual: number | null; destacada: number | null };
  mvas: { original: number | null; ajustada4: number | null; ajustada7: number | null; ajustada12: number | null };
  reducoes: Array<{ tipo: string; cargaEfetiva: number | null; descricao: string }>;
  situacaoTributaria: string;

  // Auditoria
  evidencias: Evidencia[];
  trilha: string[];
}

// ---------- Providers / extensões futuras ----------------------------

/**
 * Contrato do futuro Motor de Benefícios. Ele NÃO compartilha critérios
 * com o Motor de Classificação: recebe apenas o Contexto Tributário.
 */
export interface BeneficioProvider {
  readonly nome: string;
  avaliar(contexto: ContextoTributario): Promise<ContextoRegime[]> | ContextoRegime[];
}

/** Estratégia de detecção de um regime a partir do jurídico + perfil. */
export interface RegimeStrategy {
  readonly regime: RegimeTributario;
  detectar(perfil: PerfilProduto, juridico: ResultadoJuridico): ContextoRegime | null;
}
