// Service: consultas por NCM/CEST em todas as fontes oficiais.
import { LegislationEngine } from "../engines/LegislationEngine";

export const LegislacaoService = {
  porNCM: (ncm: string) => LegislationEngine.consultarPorNCM(ncm),
  porCEST: (cest: string) => LegislationEngine.consultarPorCEST(cest),
};
