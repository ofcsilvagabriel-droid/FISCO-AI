// Ambient shims para os motores/dados fiscais em JavaScript.
// Permitem que a camada Domain (TS) importe as fachadas sem erro
// implicit-any. As assinaturas reais permanecem no arquivo .js.
declare module "*/engines/motorST" {
  export const normalizarTexto: (s: unknown) => string;
  export const SEGMENTOS_ST: unknown[];
  export const CST_ST_FORTE: Set<string>;
  export const CST_ST_FRACO: Set<string>;
  export function scoreCSTMatriz(cstRaw: unknown): number;
  export function classificarMatrizST(input: {
    scoreNcm?: number;
    scoreDesc?: number;
    scoreCst?: number;
    cestExato?: boolean;
  }): unknown;
  export function identificarST(produto: unknown): unknown;
  export function calcularSTporPauta(input: unknown): unknown;
  export function calcularSTcomBeneficio(input: unknown): unknown;
  export function gerarRegraSugerida(produto: unknown): unknown;
}

declare module "*/engines/motorCST" {
  export function interpretarCST(cstOrCsosn: unknown): unknown;
  export function validarCST(input: unknown): unknown;
  export function validarReducaoBase(input: unknown): unknown;
  export function descreverCST(perm: unknown): unknown;
  export function validarCFOPxCST(input: unknown): { ok: boolean; advertencias: Array<{ tipo: string; mensagem: string; fundamento?: string }> };
}

declare module "*/engines/motorCFOP" {
  export const MATRIZ_CFOP: Record<string, unknown>;
  export const CFOPS_TITULO: string[];
  export function interpretarCFOP(cfop: unknown): any;
  export function descreverCFOP(perm: unknown): string;
}

declare module "*/engines/gateTributario" {
  export const TRIBUTOS: string[];
  export function avaliarLiberacaoCalculo(entrada?: any): any;
  export function calculoLiberado(avaliacao: unknown, tributo: string): boolean;
}

declare module "*/engines/motorConvenio" {
  export function isRegraConvenio(regra: unknown): boolean;
  export function matchConvenioEstrito(produto: unknown, regra: unknown): unknown;
}

declare module "*/engines/motorClassificacaoST" {
  export function normalizarNCM(v: unknown): string;
  export function normalizarTexto(s: unknown): string;
  export function calcularScoreNCM(ncmProduto: unknown, ncmRegra: unknown): unknown;
  export function calcularScoreDescricao(descProduto: unknown, regra: unknown): unknown;
  export function registroRegras(): unknown[];
  export function registrarRegrasExtras(regras: unknown[]): void;
  export function _resetRegistroParaTeste(regras?: unknown[]): void;
  export function classificarProduto(input: unknown): unknown;
  export function mvaAjustadaPor(regra: unknown, aliqDestacada: unknown): unknown;
}

declare module "*/data/ricmsBaAnexo1" {
  export const RICMS_BA_ANEXO1: unknown[];
}

declare module "*/data/conv5291" {
  export const CONV_52_91_INDUSTRIAL: unknown[];
  export const CONV_52_91_AGRICOLA: unknown[];
  export function identificarConv5291(ncm: unknown): unknown;
  export function cargaEfetivaConv5291(tipo: unknown, ufOrigem: unknown, ufDestino: unknown): unknown;
  export function beneficio5291(
    ncm: unknown,
    ufOrigem: unknown,
    ufDestino: unknown,
    aliquotaInterna: unknown,
  ): unknown;
}

declare module "*/data/aliquotasUF" {
  export const ALIQ_INTERNA_UF: Record<string, number>;
  export function buscarAliquotaInterestadual(
    ufOrigem: unknown,
    ufDestino: unknown,
    importado?: boolean,
  ): number;
  export function buscarAliquotaInterna(uf: unknown): number;
  export function isImportadoPorCSTOrig(origCode: unknown): boolean;
  export function calcularDIFAL(nota: unknown): unknown;
}

declare module "*/engines/motorPauta" {
  export const FONTES_PAUTA: Record<string, { fonte: string; carregada: boolean; registros: number; atualizado_em: string | null }>;
  export function resolverPauta(input: unknown): {
    metodo: "PMC" | "PMPF" | "MVA";
    valorUnitario: number;
    fonte: string | null;
    fundamento: string | null;
    avisos: Array<{ tipo: string; mensagem: string; fundamento?: string }>;
    pautaEsperada: boolean;
  };
}

declare module "*/data/pmpf" {
  export const PMPF_TABELA: unknown[];
  export const PMPF_METADADOS: { fonte: string; carregada: boolean; registros: number; atualizado_em: string | null };
  export function buscarPMPF(input: unknown): unknown;
}

declare module "*/data/atoCotepe" {
  export const ATO_COTEPE_PMPF: unknown[];
  export const ATO_COTEPE_METADADOS: { fonte: string; carregada: boolean; registros: number; atualizado_em: string | null };
  export function ehCombustivel(ncm: unknown): boolean;
  export function buscarPMPFCotepe(input: unknown): unknown;
}

declare module "*/data/listasMedicamentos" {
  export const LISTA_MEDICAMENTOS: unknown[];
  export const LISTA_MEDICAMENTOS_METADADOS: { fonte: string; carregada: boolean; registros: number; atualizado_em: string | null };
  export function ehMedicamento(ncm: unknown): boolean;
  export function buscarPMCMedicamento(input: unknown): unknown;
}

declare module "*/data/conv142_18" {
  export const CONV_142_18: {
    numero: string;
    signatarios: string[];
    mva_padrao_interno_ba: number;
    mva_padrao_aquisicoes: number;
    ncm_cobertos: Record<string, string>;
    isAutopeca(ncm: unknown): boolean;
    isSignataria(uf: unknown): boolean;
    temExclusao(uf: unknown, ncm: unknown): boolean;
    obterMVA(operacao?: string): number;
  };
  const _default: typeof CONV_142_18;
  export default _default;
}

declare module "*/engines/motorCestaBasicaBA" {
  export const MATRIZ_CESTA_BASICA_BA: unknown[];
  export function normalizarNCMCesta(ncm: unknown): string;
  export function identificarProdutoCesta(input?: unknown): any;
  export function avaliarCestaBasicaBA(entrada?: unknown): any;
}
