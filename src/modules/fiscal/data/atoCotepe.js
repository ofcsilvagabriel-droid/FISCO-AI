// =====================================================================
// ATO COTEPE/ICMS — PMPF de combustíveis e lubrificantes
// ---------------------------------------------------------------------
// STUB DE DADOS (Bloco 2). Os preços médios ponderados a consumidor
// final de combustíveis são divulgados quinzenalmente pelo CONFAZ via
// Ato COTEPE/PMPF. Enquanto a tabela não for carregada, o array abaixo
// permanece VAZIO e o motor de pauta cai em MVA emitindo aviso visível.
//
// Formato esperado de cada registro:
// {
//   uf: "BA",
//   produto: "GASOLINA C",
//   ncm: "27101259",
//   valor: 6.29,             // R$ por litro
//   unidade: "L",
//   vigencia_inicio: "2026-08-01",
//   vigencia_fim: "2026-08-15",
//   ato: "Ato COTEPE/PMPF nº XX/2026",
// }
// =====================================================================

export const ATO_COTEPE_PMPF = [];

export const ATO_COTEPE_METADADOS = {
  fonte: "CONFAZ — Ato COTEPE/PMPF (combustíveis e lubrificantes)",
  atualizado_em: null,
  registros: ATO_COTEPE_PMPF.length,
  carregada: ATO_COTEPE_PMPF.length > 0,
};

const digs = (v) => String(v ?? "").replace(/\D/g, "");

function vigente(reg, dataRef) {
  const d = dataRef ? new Date(dataRef) : new Date();
  if (Number.isNaN(d.getTime())) return true;
  const ini = reg.vigencia_inicio ? new Date(reg.vigencia_inicio) : null;
  const fim = reg.vigencia_fim ? new Date(reg.vigencia_fim) : null;
  if (ini && d < ini) return false;
  if (fim && d > fim) return false;
  return true;
}

/** NCMs típicos de combustíveis sujeitos a PMPF por Ato COTEPE. */
export function ehCombustivel(ncm) {
  const n = digs(ncm);
  return n.startsWith("2710") || n.startsWith("2711") || n.startsWith("2207");
}

/**
 * Busca PMPF de combustível vigente no Ato COTEPE.
 * Retorna null quando a base está vazia ou não há correspondência.
 */
export function buscarPMPFCotepe({ ncm, uf = "BA", data = null } = {}) {
  if (!ATO_COTEPE_PMPF.length) return null;
  const n = digs(ncm);
  const u = String(uf || "").toUpperCase();
  const candidatos = ATO_COTEPE_PMPF.filter(
    (r) =>
      (!r.uf || String(r.uf).toUpperCase() === u) &&
      vigente(r, data) &&
      !!digs(r.ncm) &&
      !!n &&
      n.startsWith(digs(r.ncm)),
  );
  if (!candidatos.length) return null;
  candidatos.sort((a, b) => digs(b.ncm).length - digs(a.ncm).length);
  const r = candidatos[0];
  return {
    valor: Number(r.valor) || 0,
    unidade: r.unidade || "L",
    fonte: "PMPF_COTEPE",
    fundamento: r.ato || ATO_COTEPE_METADADOS.fonte,
    registro: r,
  };
}
