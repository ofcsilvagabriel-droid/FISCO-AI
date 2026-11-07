export type ProvedorNfeId = "CONSULTA_DANFE" | "NFE_IO";

export type SituacaoNfe = "AUTORIZADA" | "CANCELADA" | "DESCONHECIDA";

export type EventoNfe = {
  tipo: string;
  sequencia?: number | null;
  protocolo?: string | null;
  dataEvento?: string | null;
  codigoStatus?: string | null;
  descricao?: string | null;
  xml?: Buffer;
  metadados?: Record<string, unknown>;
};

export type ResultadoConsultaNfe = {
  chave: string;
  xml?: Buffer;
  danfe?: Buffer;
  situacao?: SituacaoNfe;
  eventos?: EventoNfe[];
  provedor: ProvedorNfeId;
  oficial: boolean;
  duracaoMs: number;
};

export interface ProvedorNfe {
  consultarXml(chave: string, signal?: AbortSignal): Promise<ResultadoConsultaNfe>;
  consultarDanfe?(chave: string, signal?: AbortSignal): Promise<ResultadoConsultaNfe>;
  consultarEventos?(chave: string, signal?: AbortSignal): Promise<EventoNfe[]>;
}
