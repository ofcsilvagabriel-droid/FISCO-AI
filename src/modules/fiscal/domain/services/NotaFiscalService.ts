import { NotaFiscalRepository } from "../repositories/NotaFiscalRepository";
import type { NotaFiscal } from "../entities/notaFiscal";

export const NotaFiscalService = {
  list(): NotaFiscal[] { return NotaFiscalRepository.getAll(); },
  get(id: string) { return NotaFiscalRepository.findById(id); },
  porEmpresa(cnpj: string): NotaFiscal[] {
    const c = (cnpj || "").replace(/\D/g, "");
    return NotaFiscalRepository.query(
      (n) => (n.emit_cnpj || "").replace(/\D/g, "") === c ||
             (n.dest_cnpj || "").replace(/\D/g, "") === c,
    );
  },
  save(nota: NotaFiscal): NotaFiscal {
    return NotaFiscalRepository.upsert({ ...nota, id: nota.id || nota.chave || crypto.randomUUID() });
  },
  remove(id: string) { NotaFiscalRepository.remove(id); },
};
