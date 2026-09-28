// Factory: geração de regra sugerida a partir de um produto.
// Fachada sobre motorST.gerarRegraSugerida (motor único, sem duplicação).
import { gerarRegraSugerida } from "../../engines/motorST";
import type { ProdutoNF, RegraTributaria } from "../entities/types";

export const RegraFactory = {
  sugerir(produto: ProdutoNF): RegraTributaria | null {
    return gerarRegraSugerida(produto) as RegraTributaria | null;
  },
};
