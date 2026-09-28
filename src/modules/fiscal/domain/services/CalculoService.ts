// Service: cálculo tributário. Orquestra CalculationEngine (ST/DIFAL) e
// BenefitEngine (Convênio 52/91) sem duplicar regras.
import { CalculationEngine } from "../engines/CalculationEngine";
import { BenefitEngine } from "../engines/BenefitEngine";
import { ValidationEngine } from "../engines/ValidationEngine";
import {
  avaliarPresuncao,
  aplicarPresuncaoAoCalculo,
  validarPresuncao,
} from "../engines/PresuncaoEngine";

export const CalculoService = {
  stPorPauta: CalculationEngine.stPorPauta,
  stComBeneficio: CalculationEngine.stComBeneficio,
  difal: CalculationEngine.difal,
  aliquotaInterna: CalculationEngine.aliquotaInterna,
  aliquotaInterestadual: CalculationEngine.aliquotaInterestadual,

  beneficioConv5291: BenefitEngine.conv5291.beneficio,
  isConvenio: BenefitEngine.isConvenio,
  matchConvenio: BenefitEngine.matchConvenio,

  // Gate obrigatório: CST/CSOSN × CFOP antes de qualquer fórmula.
  avaliarLiberacao: CalculationEngine.avaliarLiberacao,
  interpretarCFOP: ValidationEngine.cfop.interpretar,
  descreverCFOP: ValidationEngine.cfop.descrever,
  validarCFOPxCST: ValidationEngine.cfop.validarCruzado,

  interpretarCST: ValidationEngine.cst.interpretar,
  validarCST: ValidationEngine.cst.validar,
  validarReducaoBase: ValidationEngine.cst.validarReducao,
  descreverCST: ValidationEngine.cst.descrever,

  // Presunção de ICMS próprio quando não há destaque na NF.
  avaliarPresuncao,
  aplicarPresuncaoAoCalculo,
  validarPresuncao,
};
