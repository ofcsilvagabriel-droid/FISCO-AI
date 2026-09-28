// =====================================================================
// MOTOR DE PAUTA (Bloco 2)
// ---------------------------------------------------------------------
// Resolve a base de cálculo da ST na ordem legal de prioridade:
//   1) PMC informado na NF-e / descrição (tag vPMC)
//   2) PMC de medicamento — lista CMED (Convênio ICMS 234/17)
//   3) PMPF de combustível — Ato COTEPE/PMPF (CONFAZ)
//   4) PMPF estadual — pauta SEFAZ/BA (Conv. 142/18, cl. décima)
//   5) MVA — fallback, SEMPRE com aviso visível quando a pauta esperada
//      não pôde ser obtida por ausência/desatualização da base.
// =====================================================================
import { buscarPMPF, PMPF_METADADOS } from "../data/pmpf";
import { buscarPMPFCotepe, ehCombustivel, ATO_COTEPE_METADADOS } from "../data/atoCotepe";
import {
  buscarPMCMedicamento,
  ehMedicamento,
  LISTA_MEDICAMENTOS_METADADOS,
} from "../data/listasMedicamentos";

export const FONTES_PAUTA = {
  pmpf: PMPF_METADADOS,
  atoCotepe: ATO_COTEPE_METADADOS,
  medicamentos: LISTA_MEDICAMENTOS_METADADOS,
};

/**
 * @returns {{
 *   metodo: "PMC"|"PMPF"|"MVA",
 *   valorUnitario: number,
 *   fonte: string|null,
 *   fundamento: string|null,
 *   avisos: Array<{tipo:string, mensagem:string, fundamento?:string}>,
 *   pautaEsperada: boolean,
 * }}
 */
export function resolverPauta({
  ncm = null,
  cest = null,
  ean = null,
  uf = "BA",
  data = null,
  vPMC = 0,
  pmpf = 0,
} = {}) {
  const avisos = [];

  // 1) PMC informado no próprio documento fiscal
  if (Number(vPMC) > 0) {
    return {
      metodo: "PMC",
      valorUnitario: Number(vPMC),
      fonte: "NF",
      fundamento: "PMC informado na NF-e (tag vPMC / infAdProd) — Convênio ICMS 142/18",
      avisos,
      pautaEsperada: true,
    };
  }

  // 2) Medicamentos — lista CMED
  const medicamento = ehMedicamento(ncm);
  if (medicamento) {
    const hit = buscarPMCMedicamento({ ean, ncm, uf, data });
    if (hit && hit.valor > 0) {
      return {
        metodo: "PMC",
        valorUnitario: hit.valor,
        fonte: hit.fonte,
        fundamento: hit.fundamento,
        avisos,
        pautaEsperada: true,
      };
    }
    avisos.push({
      tipo: "PAUTA_INDISPONIVEL",
      mensagem: LISTA_MEDICAMENTOS_METADADOS.carregada
        ? "Medicamento sem PMC correspondente na lista CMED. Cálculo efetuado por MVA — revisar."
        : "Lista CMED (PMC de medicamentos) não carregada no sistema. Cálculo efetuado por MVA — revisar.",
      fundamento: LISTA_MEDICAMENTOS_METADADOS.fonte,
    });
  }

  // 3) PMPF informado externamente (parâmetro direto)
  if (Number(pmpf) > 0) {
    return {
      metodo: "PMPF",
      valorUnitario: Number(pmpf),
      fonte: "NF",
      fundamento: "PMPF informado no documento fiscal — Convênio ICMS 142/18",
      avisos,
      pautaEsperada: true,
    };
  }

  // 4) Combustíveis — Ato COTEPE/PMPF
  const combustivel = ehCombustivel(ncm);
  if (combustivel) {
    const hit = buscarPMPFCotepe({ ncm, uf, data });
    if (hit && hit.valor > 0) {
      return {
        metodo: "PMPF",
        valorUnitario: hit.valor,
        fonte: hit.fonte,
        fundamento: hit.fundamento,
        avisos,
        pautaEsperada: true,
      };
    }
    avisos.push({
      tipo: "PAUTA_INDISPONIVEL",
      mensagem: ATO_COTEPE_METADADOS.carregada
        ? "Combustível sem PMPF vigente no Ato COTEPE para a UF/data. Cálculo efetuado por MVA — revisar."
        : "Tabela do Ato COTEPE/PMPF (combustíveis) não carregada no sistema. Cálculo efetuado por MVA — revisar.",
      fundamento: ATO_COTEPE_METADADOS.fonte,
    });
  }

  // 5) PMPF estadual
  const estadual = buscarPMPF({ ncm, uf, cest, data });
  if (estadual && estadual.valor > 0) {
    return {
      metodo: "PMPF",
      valorUnitario: estadual.valor,
      fonte: estadual.fonte,
      fundamento: estadual.fundamento,
      avisos,
      pautaEsperada: true,
    };
  }
  if (!PMPF_METADADOS.carregada && !medicamento && !combustivel) {
    // Sem base estadual carregada: só alerta se o produto pediria pauta.
    // Produtos genéricos seguem por MVA sem ruído.
  }

  return {
    metodo: "MVA",
    valorUnitario: 0,
    fonte: null,
    fundamento: "Convênio ICMS 142/18 — MVA ajustada (pauta indisponível)",
    avisos,
    pautaEsperada: medicamento || combustivel,
  };
}
