// ============================================================
// MOTOR TRIBUTÁRIO — barril público
// Consumir SEMPRE pelo MotorTributarioService.
// ============================================================
export { MotorTributarioService } from "./services/MotorTributarioService";
export { MotorTributarioFactory } from "./factories/MotorTributarioFactory";
export type { MotorTributario, OpcoesMotor } from "./factories/MotorTributarioFactory";

// Camadas (exportadas para testes e extensões)
export { EvidenceEngine } from "./engines/EvidenceEngine";
export { LegalEngine } from "./engines/LegalEngine";
export { TaxConsolidator } from "./engines/TaxConsolidator";

export { LegislacaoIndexRepository } from "./repositories/LegislacaoIndexRepository";
export { ExcecaoPolicy } from "./policies/ExcecaoPolicy";
export { ClassificacaoPolicy } from "./policies/ClassificacaoPolicy";
export { ScoreCalculator } from "./scorers/ScoreCalculator";
export { ConfiancaScorer } from "./scorers/ConfiancaScorer";
export { SegmentoResolver } from "./resolvers/SegmentoResolver";
export { NcmMatcher } from "./matchers/NcmMatcher";
export { DescricaoMatcher } from "./matchers/DescricaoMatcher";
export { TextNormalizer } from "./normalizers/TextNormalizer";
export { NcmNormalizer } from "./normalizers/NcmNormalizer";
export { CestValidator } from "./validators/CestValidator";
export { SEGMENTOS, SEGMENTO_INDEFINIDO } from "./rules/segmentos";
export { STRATEGIES_PADRAO } from "./strategies/regimes";
export { BeneficioProviderRegistry, NoopBeneficioProvider } from "./providers/BeneficioProvider";

export type * from "./types";
