import { z } from "zod";
export const UsuarioSchema = z.object({
  id: z.string(),
  email: z.string().email().optional(),
  nome: z.string().optional(),
  perfil: z.enum(["admin", "contador", "operador"]).optional(),
});
export type Usuario = z.infer<typeof UsuarioSchema>;
export const validarUsuario = (i: unknown): Usuario => UsuarioSchema.parse(i);
