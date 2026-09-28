import { UsuarioRepository } from "../repositories/UsuarioRepository";
import type { Usuario } from "../entities/usuario";
export const UsuarioService = {
  list: () => UsuarioRepository.getAll(),
  atual: (): Usuario | undefined => UsuarioRepository.getAll()[0],
  save: (u: Usuario) => UsuarioRepository.upsert({ ...u, id: u.id || crypto.randomUUID() }),
};
