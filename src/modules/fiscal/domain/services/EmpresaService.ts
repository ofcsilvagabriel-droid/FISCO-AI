// Service: gestão de empresas persistidas. Nenhuma tela lê o
// repository diretamente — sempre pelo service.
import { EmpresaRepository } from "../repositories/EmpresaRepository";
import type { Empresa } from "../entities/empresa";
import { validarEmpresa } from "../entities/empresa";

const digs = (s: string) => (s || "").replace(/\D/g, "");

export const EmpresaService = {
  list(): Empresa[] { return EmpresaRepository.getAll(); },
  get(id: string): Empresa | undefined { return EmpresaRepository.findById(id); },
  porCNPJ(cnpj: string): Empresa | undefined {
    const c = digs(cnpj);
    return EmpresaRepository.query((e) => digs(e.cnpj) === c)[0];
  },
  upsert(input: Partial<Empresa> & { cnpj: string }): Empresa {
    const id = digs(input.cnpj) || input.id || crypto.randomUUID();
    const now = new Date().toISOString();
    const existente = EmpresaRepository.findById(id);
    const empresa = validarEmpresa({
      ...(existente ?? {}),
      ...input,
      id,
      razaoSocial: input.razaoSocial ?? existente?.razaoSocial ?? "",
      criadoEm: existente?.criadoEm ?? now,
      atualizadoEm: now,
    });
    return EmpresaRepository.upsert(empresa);
  },
  remove(id: string): void { EmpresaRepository.remove(id); },
};
