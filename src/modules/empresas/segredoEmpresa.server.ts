import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function chave(): Buffer {
  const valor = Buffer.from(process.env.FISCOAI_CERTIFICATE_ENCRYPTION_KEY || "", "base64");
  if (valor.length !== 32) throw new Error("A proteção de credenciais não está configurada no servidor.");
  return valor;
}

export function criptografarSegredoEmpresa(valor: string): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chave(), iv);
  const conteudo = Buffer.concat([cifra.update(valor, "utf8"), cifra.final()]);
  return ["v1", iv.toString("base64"), cifra.getAuthTag().toString("base64"), conteudo.toString("base64")].join(".");
}

export function descriptografarSegredoEmpresa(valor: string): string {
  const [versao, iv, tag, conteudo] = String(valor || "").split(".");
  if (versao !== "v1" || !iv || !tag || !conteudo) throw new Error("A credencial protegida está inválida.");
  const cifra = createDecipheriv("aes-256-gcm", chave(), Buffer.from(iv, "base64"));
  cifra.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([cifra.update(Buffer.from(conteudo, "base64")), cifra.final()]).toString("utf8");
}
