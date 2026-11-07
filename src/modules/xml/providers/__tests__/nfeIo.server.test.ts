import { describe, expect, it, vi } from "vitest";
import { calcularDigitoVerificadorChaveNfe } from "@/modules/xml/domain/chaveNfe";
import {
  carregarConfiguracaoNfeIo,
  ErroNfeIo,
  ProvedorNfeIo,
  type ConfiguracaoNfeIo,
} from "../nfeIo.server";
import { executarConsultaSombraNfeIo } from "@/modules/xml/services/consultaNfeShadow.server";

const base = "2926119876543200010055001000000001100000001";
const chave = `${base}${calcularDigitoVerificadorChaveNfe(base)}`;
const xml = Buffer.from(
  `<nfeProc versao="4.00"><NFe><infNFe Id="NFe${chave}" versao="4.00"><ide><mod>55</mod></ide></infNFe></NFe><protNFe><infProt><chNFe>${chave}</chNFe><cStat>100</cStat></infProt></protNFe></nfeProc>`,
);
const configuracao = (parcial: Partial<ConfiguracaoNfeIo> = {}): ConfiguracaoNfeIo => ({
  enabled: true,
  apiKey: "segredo-teste",
  baseUrl: "https://nfe.api.nfe.io",
  timeoutMs: 1_000,
  clientTimeoutSeconds: 20,
  maxConcurrency: 2,
  ...parcial,
});

describe("ProvedorNfeIo", () => {
  it("fica desativado por padrão e não exige segredo durante o import", () => {
    expect(carregarConfiguracaoNfeIo({})).toMatchObject({
      enabled: false,
      apiKey: "",
      baseUrl: "https://nfe.api.nfe.io",
    });
  });

  it("consulta o XML cru V3 com credencial somente no header", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } }),
      );
    const resultado = await new ProvedorNfeIo(configuracao(), fetcher).consultarXml(chave);

    expect(resultado).toMatchObject({ chave, provedor: "NFE_IO", oficial: true });
    expect(resultado.xml).toEqual(xml);
    const [url, opcoes] = fetcher.mock.calls[0];
    expect(url).toBe(`https://nfe.api.nfe.io/v3/productinvoices/serpro/${chave}.xml`);
    expect(opcoes.headers.Authorization).toBe("segredo-teste");
    expect(url).not.toContain("segredo-teste");
  });

  it("consulta DANFE V2 e eventos SEFAZ sem persistir respostas", async () => {
    const pdf = Buffer.from("%PDF-1.7\nconteudo");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(pdf, { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            events: [
              {
                type: "Cancelamento",
                sequence: 1,
                protocol: "123",
                statusCode: 101,
              },
            ],
          }),
          { status: 200 },
        ),
      );
    const provedor = new ProvedorNfeIo(configuracao(), fetcher);

    expect((await provedor.consultarDanfe(chave)).danfe).toEqual(pdf);
    await expect(provedor.consultarEventos(chave)).resolves.toEqual([
      expect.objectContaining({
        tipo: "Cancelamento",
        sequencia: 1,
        protocolo: "123",
        codigoStatus: "101",
      }),
    ]);
    expect(fetcher.mock.calls[1][0]).toBe(
      `https://nfe.api.nfe.io/v2/productinvoices/events/${chave}`,
    );
  });

  it("classifica 429 como repetível e respeita Retry-After", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Limite atingido" }), {
        status: 429,
        headers: { "Retry-After": "12" },
      }),
    );
    const erro = await new ProvedorNfeIo(configuracao(), fetcher)
      .consultarXml(chave)
      .catch((falha) => falha);
    expect(erro).toBeInstanceOf(ErroNfeIo);
    expect(erro).toMatchObject({ codigo: "HTTP_429", repetivel: true, retryAfterMs: 12_000 });
  });

  it("não expõe a credencial em erros do provedor", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "Chave segredo-teste inválida" }), { status: 401 }),
      );
    const erro = await new ProvedorNfeIo(configuracao(), fetcher)
      .consultarXml(chave)
      .catch((falha) => falha);
    expect(String(erro.message)).not.toContain("segredo-teste");
    expect(erro).toMatchObject({ codigo: "HTTP_401", repetivel: false });
  });

  it("produz somente métricas e hashes no modo sombra", async () => {
    const provedor = {
      consultarXml: vi.fn().mockResolvedValue({
        chave,
        xml,
        provedor: "NFE_IO",
        oficial: true,
        duracaoMs: 25,
      }),
    };
    const resultado = await executarConsultaSombraNfeIo({ chave, xmlReferencia: xml }, provedor);
    expect(resultado).toMatchObject({
      chave,
      provedor: "NFE_IO",
      oficial: true,
      duracaoMs: 25,
      tamanhoBytes: xml.length,
      igualReferencia: true,
    });
    expect(resultado).not.toHaveProperty("xml");
  });
});
