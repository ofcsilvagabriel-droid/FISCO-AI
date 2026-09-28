// Constantes fiscais compartilhadas — sem regras de negócio,
// apenas rótulos, thresholds e listagens de UF usadas por
// múltiplas camadas.

export const UFS = [
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG",
  "PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
] as const;

export type UF = (typeof UFS)[number];

export const STATUS_CLASSIFICACAO = {
  ST_CONFIRMADA: "ST_CONFIRMADA",
  ST_SUGERIDA: "ST_SUGERIDA",
  REVISAO_NECESSARIA: "REVISAO_NECESSARIA",
  NAO_ENQUADRADO: "NAO_ENQUADRADO",
  SEM_REGRA_POR_NCM: "SEM_REGRA_POR_NCM",
  VALIDACAO_MANUAL: "VALIDACAO_MANUAL",
} as const;

export const STORAGE_KEYS = {
  ARQUIVO: "fiscoai:arquivo:v1",
  EMPRESAS: "fiscoai:empresas:v1",
  NOTAS: "fiscoai:notas:v1",
  APURACAO: "fiscoai:apuracao:v1",
  RELATORIOS: "fiscoai:relatorios:v1",
  USUARIO: "fiscoai:usuario:v1",
  COMPETENCIA: "fiscoai:competencia:v1",
} as const;
