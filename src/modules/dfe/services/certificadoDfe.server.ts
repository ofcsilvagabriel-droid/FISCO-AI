import { createCipheriv, createDecipheriv, createPrivateKey, randomBytes, X509Certificate } from "node:crypto";
import { createSecureContext } from "node:tls";
import forge from "node-forge";

type SegredoCertificado = { pfx: string; senha: string };

function chaveCriptografia(): Buffer {
  const chave = Buffer.from(process.env.FISCOAI_CERTIFICATE_ENCRYPTION_KEY || "", "base64");
  if (chave.length !== 32) throw new Error("Chave de proteção dos certificados não configurada no servidor.");
  return chave;
}

export function criptografarCertificado(segredo: SegredoCertificado): string {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveCriptografia(), iv);
  const conteudo = Buffer.concat([cifra.update(JSON.stringify(segredo), "utf8"), cifra.final()]);
  return [iv, cifra.getAuthTag(), conteudo].map(parte => parte.toString("base64")).join(".");
}

export function descriptografarCertificado(valor: string): SegredoCertificado {
  const partes = valor.split(".");
  if (partes.length !== 3) throw new Error("Certificado armazenado inválido.");
  const [iv, tag, conteudo] = partes.map(parte => Buffer.from(parte, "base64"));
  const cifra = createDecipheriv("aes-256-gcm", chaveCriptografia(), iv);
  cifra.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cifra.update(conteudo), cifra.final()]).toString("utf8"));
}

export function extrairMaterialAssinatura(pfxBase64: string, senha: string) {
  const bytes = Buffer.from(pfxBase64, "base64");
  const asn1 = forge.asn1.fromDer(bytes.toString("binary"));
  const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
  const keyBags = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
  ];
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
  if (!keyBags[0]?.key) throw new Error("A chave privada do certificado não está disponível para assinar a Ciência da Emissão.");
  const chave = createPrivateKey(forge.pki.privateKeyToPem(keyBags[0].key));
  const certificado = certBags.find(bag => bag.cert && new X509Certificate(forge.pki.certificateToPem(bag.cert)).checkPrivateKey(chave))?.cert;
  if (!certificado) throw new Error("O certificado A1 não corresponde à chave privada.");
  return { privateKey: forge.pki.privateKeyToPem(keyBags[0].key), certificate: forge.pki.certificateToPem(certificado) };
}

export function criptografarXml(bytes: Buffer): Buffer {
  const iv = randomBytes(12);
  const cifra = createCipheriv("aes-256-gcm", chaveCriptografia(), iv);
  return Buffer.concat([iv, cifra.update(bytes), cifra.final(), cifra.getAuthTag()]);
}

export function descriptografarXml(bytes: Buffer): Buffer {
  if (bytes.length < 29) throw new Error("Arquivo XML protegido inválido.");
  const cifra = createDecipheriv("aes-256-gcm", chaveCriptografia(), bytes.subarray(0, 12));
  cifra.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([cifra.update(bytes.subarray(12, -16)), cifra.final()]);
}

export function prepararCertificado(pfxBase64: string, senha: string) {
  const bytes = Buffer.from(pfxBase64, "base64");
  if (!bytes.length || bytes.length > 65536) throw new Error("Certificado A1 inválido ou maior que 64 KB.");
  let certificado: X509Certificate;
  let tls: { pfx: Buffer; passphrase: string } | { cert: string; key: string };
  try {
    const contexto = createSecureContext({ pfx: bytes, passphrase: senha });
    const der = contexto.context.getCertificate();
    if (!der) throw new Error("Certificado ausente");
    certificado = new X509Certificate(der);
    tls = { pfx: bytes, passphrase: senha };
  } catch (erro) {
    if (!(erro instanceof Error) || !/unsupported pkcs12 pfx data/i.test(erro.message))
      throw new Error("Não foi possível abrir o certificado A1. Verifique o arquivo PFX/P12 e a senha.");
    try {
      const asn1 = forge.asn1.fromDer(bytes.toString("binary"));
      const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha);
      const keyBags = [
        ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] || []),
        ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] || []),
      ];
      const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
      if (keyBags.length !== 1 || !keyBags[0].key || !certBags.length) throw new Error("Chave ou certificado ausente");
      const key = forge.pki.privateKeyToPem(keyBags[0].key);
      const chave = createPrivateKey(key);
      const certificados = certBags.filter(bag => !!bag.cert).map(bag => forge.pki.certificateToPem(bag.cert!));
      const indice = certificados.findIndex(pem => new X509Certificate(pem).checkPrivateKey(chave));
      if (indice < 0) throw new Error("Certificado não corresponde à chave privada");
      certificado = new X509Certificate(certificados[indice]);
      tls = { cert: [certificados[indice], ...certificados.filter((_, i) => i !== indice)].join(""), key };
      createSecureContext(tls);
    } catch (erroLegado) {
      if (erroLegado instanceof Error && /MAC could not be verified|invalid password|mac verify failure/i.test(erroLegado.message))
        throw new Error("A senha de exportação do arquivo PFX/P12 está incorreta.");
      throw new Error("Não foi possível abrir o certificado A1. Verifique o arquivo PFX/P12 e a senha.");
    }
  }
  const inicio = new Date(certificado.validFrom);
  const fim = new Date(certificado.validTo);
  if (inicio > new Date() || fim <= new Date()) throw new Error("O certificado ainda não está válido ou já venceu.");
  return { tls, metadados: {
    titular: certificado.subject.match(/(?:^|\n)CN\s*=\s*([^\n]+)/)?.[1] || "Titular não identificado",
    validade_inicio: inicio.toISOString(),
    validade_fim: fim.toISOString(),
    fingerprint_sha256: certificado.fingerprint256.replace(/:/g, "").toLowerCase(),
  } };
}

export function inspecionarCertificado(pfxBase64: string, senha: string) {
  return prepararCertificado(pfxBase64, senha).metadados;
}
