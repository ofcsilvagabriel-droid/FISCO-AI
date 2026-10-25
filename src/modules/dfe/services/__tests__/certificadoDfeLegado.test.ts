import { describe, expect, it, vi } from "vitest";
import forge from "node-forge";

vi.mock("node:tls", async importOriginal => {
  const original = await importOriginal<typeof import("node:tls")>();
  return {
    ...original,
    createSecureContext: (opcoes: Parameters<typeof original.createSecureContext>[0]) => {
      if (opcoes?.pfx) throw new Error("Unsupported PKCS12 PFX data");
      return original.createSecureContext(opcoes);
    },
  };
});

import { prepararCertificado } from "../certificadoDfe.server";

describe("A1 com proteção PKCS#12 legada", () => {
  it("extrai certificado e chave para mTLS sem depender do provedor legado do OpenSSL", () => {
    const chaves = forge.pki.rsa.generateKeyPair(2048);
    const cert = forge.pki.createCertificate();
    cert.publicKey = chaves.publicKey;
    cert.serialNumber = "01";
    cert.validity.notBefore = new Date(Date.now() - 86400000);
    cert.validity.notAfter = new Date(Date.now() + 86400000);
    cert.setSubject([{ name: "commonName", value: "A1 de teste" }]);
    cert.setIssuer(cert.subject.attributes);
    cert.sign(chaves.privateKey, forge.md.sha256.create());
    const p12 = forge.pkcs12.toPkcs12Asn1(chaves.privateKey, cert, "senha-teste", { algorithm: "3des" });
    const base64 = Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary").toString("base64");
    const resultado = prepararCertificado(base64, "senha-teste");
    expect(resultado.metadados.titular).toBe("A1 de teste");
    expect("cert" in resultado.tls && "key" in resultado.tls).toBe(true);
    expect(() => prepararCertificado(base64, "senha-errada")).toThrow("A senha de exportação");
  });
});
