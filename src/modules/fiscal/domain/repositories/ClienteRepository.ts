import { LocalStorageRepository } from "./LocalStorageRepository";
import { ClienteSchema, type Cliente } from "../entities/cliente";

export const ClienteRepository = new LocalStorageRepository<Cliente>("fiscoai:clientes:v1", ClienteSchema);
