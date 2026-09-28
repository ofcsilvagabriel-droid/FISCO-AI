// Repositório: única porta de acesso ao Anexo 1 do RICMS/BA.
// Encapsula o dataset bruto (data/ricmsBaAnexo1.js) para que Services
// e Engines não importem dados diretamente.
import { RICMS_BA_ANEXO1 } from "../../data/ricmsBaAnexo1";
import type { RegraTributaria } from "../entities/types";

const digs = (s: unknown) => String(s ?? "").replace(/\D/g, "");

export const RicmsBaRepository = {
  all(): RegraTributaria[] {
    return RICMS_BA_ANEXO1 as RegraTributaria[];
  },
  st(): RegraTributaria[] {
    return (RICMS_BA_ANEXO1 as RegraTributaria[]).filter(
      (r) => String((r as { tipo?: string }).tipo || "").toUpperCase() === "ICMS_ST",
    );
  },
  buscarPorNCM(ncm: string): RegraTributaria[] {
    const n = digs(ncm);
    if (!n) return [];
    return (RICMS_BA_ANEXO1 as RegraTributaria[]).filter((r) => {
      const rn = digs((r as { ncm?: string }).ncm);
      return rn && (n.startsWith(rn) || rn.startsWith(n.slice(0, Math.min(rn.length, n.length))));
    });
  },
  buscarPorCEST(cest: string): RegraTributaria[] {
    const c = digs(cest);
    if (!c) return [];
    return (RICMS_BA_ANEXO1 as RegraTributaria[]).filter(
      (r) => digs((r as { cest?: string }).cest) === c,
    );
  },
};
