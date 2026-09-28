// Engine de Validação — reúne validators (CST, CFOP, redução de base)
// em uma superfície única consumida pelos Services.
import { CSTValidator } from "../validators/CSTValidator";
import { CFOPValidator } from "../validators/CFOPValidator";

export const ValidationEngine = {
  cst: CSTValidator,
  cfop: CFOPValidator,
};
