// Engine Orquestrador — composição dos demais Engines.
// Serve como raiz única do domínio fiscal para Services e Hooks.
import { ClassificationEngine } from "./ClassificationEngine";
import { CalculationEngine } from "./CalculationEngine";
import { BenefitEngine } from "./BenefitEngine";
import { LegislationEngine } from "./LegislationEngine";
import { ValidationEngine } from "./ValidationEngine";

export const FiscalEngine = {
  classification: ClassificationEngine,
  calculation: CalculationEngine,
  benefit: BenefitEngine,
  legislation: LegislationEngine,
  validation: ValidationEngine,
};

export type FiscalEngineType = typeof FiscalEngine;
