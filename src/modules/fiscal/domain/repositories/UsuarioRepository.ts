import { STORAGE_KEYS } from "@/core/constants";
import { LocalStorageRepository } from "./LocalStorageRepository";
import { UsuarioSchema, type Usuario } from "../entities/usuario";

export const UsuarioRepository = new LocalStorageRepository<Usuario>(STORAGE_KEYS.USUARIO, UsuarioSchema);
