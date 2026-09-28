// Validator: interpretação do CFOP e validação cruzada CST × CFOP.
// Fachada tipada sobre engines/motorCFOP.js e gateTributario.js.
import { interpretarCFOP, descreverCFOP } from "../../engines/motorCFOP";
import { validarCFOPxCST } from "../../engines/motorCST";
import { avaliarLiberacaoCalculo, calculoLiberado } from "../../engines/gateTributario";

export const CFOPValidator = {
  interpretar: (cfop: string) => interpretarCFOP(cfop),
  descrever: (perm: unknown) => descreverCFOP(perm),
  validarCruzado: (input: Parameters<typeof validarCFOPxCST>[0]) => validarCFOPxCST(input),
  avaliarLiberacao: (input: Parameters<typeof avaliarLiberacaoCalculo>[0]) =>
    avaliarLiberacaoCalculo(input),
  liberado: (avaliacao: unknown, tributo: string) => calculoLiberado(avaliacao, tributo),
};
