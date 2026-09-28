// Validator: interpretação e validação cruzada de CST/CSOSN.
// Fachada tipada sobre engines/motorCST.js — não altera regras.
import {
  interpretarCST,
  validarCST,
  validarReducaoBase,
  descreverCST,
} from "../../engines/motorCST";

export const CSTValidator = {
  interpretar: (cstOrCsosn: string) => interpretarCST(cstOrCsosn),
  validar: (input: Parameters<typeof validarCST>[0]) => validarCST(input),
  validarReducao: (input: Parameters<typeof validarReducaoBase>[0]) =>
    validarReducaoBase(input),
  descrever: (perm: Parameters<typeof descreverCST>[0]) => descreverCST(perm),
};
