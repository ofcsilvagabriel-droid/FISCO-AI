import { describe, expect, it, vi } from "vitest";

import type { ProvedorNfe } from "@/modules/xml/providers/types";
import {
  consultarXmlNfeOrquestrado,
  ErroConsultaNfeOrquestrada,
} from "../consultaNfeOrchestrator.server";

const chave = "1".repeat(44);
const xml = Buffer.from(
  `<?xml version="1.0"?><nfeProc><NFe><infNFe Id="NFe${chave}"></infNFe></NFe></nfeProc>`,
);

const dbSemCache = () => ({
  from: (tabela: string) => {
    if (tabela === "fiscoai_dfe_consultas") {
      return { insert: vi.fn().mockResolvedValue({ error: null }) };
    }
    const consulta = {
      select: () => consulta,
      eq: () => consulta,
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    return consulta;
  },
  storage: {
    from: () => ({ download: vi.fn() }),
  },
});

const provedor = (
  id: "CONSULTA_DANFE" | "NFE_IO",
  comportamento: () => Promise<Buffer>,
): ProvedorNfe => ({
  consultarXml: vi.fn(async () => ({
    chave,
    xml: await comportamento(),
    provedor: id,
    oficial: id === "NFE_IO",
    duracaoMs: 1,
  })),
});

describe("consultarXmlNfeOrquestrado", () => {
  it("não consome provedores quando o XML já está no acervo", async () => {
    const consultaDanfe = provedor("CONSULTA_DANFE", async () => xml);
    const nfeIo = provedor("NFE_IO", async () => xml);

    const resultado = await consultarXmlNfeOrquestrado(
      dbSemCache(),
      { userId: "usuario", chave, politica: "OFICIAL" },
      { consultaDanfe, nfeIo, consultarCache: async () => xml },
    );

    expect(resultado.cacheHit).toBe(true);
    expect(resultado.provedoresConsultados).toEqual([]);
    expect(consultaDanfe.consultarXml).not.toHaveBeenCalled();
    expect(nfeIo.consultarXml).not.toHaveBeenCalled();
  });

  it("usa ConsultaDANFE sem acionar NFE.io na política ECONOMIA", async () => {
    const consultaDanfe = provedor("CONSULTA_DANFE", async () => xml);
    const nfeIo = provedor("NFE_IO", async () => xml);

    const resultado = await consultarXmlNfeOrquestrado(
      dbSemCache(),
      { userId: "usuario", chave, politica: "ECONOMIA" },
      { consultaDanfe, nfeIo },
    );

    expect(resultado.provedor).toBe("CONSULTA_DANFE");
    expect(resultado.provedoresConsultados).toEqual(["CONSULTA_DANFE"]);
    expect(nfeIo.consultarXml).not.toHaveBeenCalled();
  });

  it("aciona NFE.io após falha do provedor primário", async () => {
    const consultaDanfe = provedor("CONSULTA_DANFE", async () => {
      throw Object.assign(new Error("indisponível"), {
        codigo: "HTTP_503",
        repetivel: true,
      });
    });
    const nfeIo = provedor("NFE_IO", async () => xml);

    const resultado = await consultarXmlNfeOrquestrado(
      dbSemCache(),
      { userId: "usuario", chave, politica: "ECONOMIA" },
      { consultaDanfe, nfeIo },
    );

    expect(resultado.provedor).toBe("NFE_IO");
    expect(resultado.provedoresConsultados).toEqual(["CONSULTA_DANFE", "NFE_IO"]);
  });

  it("prefere NFE.io na política OFICIAL", async () => {
    const consultaDanfe = provedor("CONSULTA_DANFE", async () => xml);
    const nfeIo = provedor("NFE_IO", async () => xml);

    const resultado = await consultarXmlNfeOrquestrado(
      dbSemCache(),
      { userId: "usuario", chave, politica: "OFICIAL" },
      { consultaDanfe, nfeIo },
    );

    expect(resultado.provedor).toBe("NFE_IO");
    expect(consultaDanfe.consultarXml).not.toHaveBeenCalled();
  });

  it("normaliza a falha quando nenhum provedor devolve XML", async () => {
    const consultaDanfe = provedor("CONSULTA_DANFE", async () => {
      throw Object.assign(new Error("temporário"), { codigo: "TIMEOUT", repetivel: true });
    });
    const nfeIo = provedor("NFE_IO", async () => {
      throw Object.assign(new Error("sem credencial"), {
        codigo: "CREDENCIAL_AUSENTE",
        repetivel: false,
      });
    });

    const erro = await consultarXmlNfeOrquestrado(
      dbSemCache(),
      { userId: "usuario", chave, politica: "ECONOMIA" },
      { consultaDanfe, nfeIo },
    ).catch((valor) => valor);

    expect(erro).toBeInstanceOf(ErroConsultaNfeOrquestrada);
    expect(erro.repetivel).toBe(true);
  });

  it("aciona o segundo provedor após o atraso da política RÁPIDO", async () => {
    vi.useFakeTimers();
    const consultaDanfe = provedor(
      "CONSULTA_DANFE",
      () => new Promise<Buffer>((resolve) => setTimeout(() => resolve(xml), 100)),
    );
    const nfeIo = provedor("NFE_IO", async () => xml);
    const consulta = consultarXmlNfeOrquestrado(
      dbSemCache(),
      { userId: "usuario", chave, politica: "RAPIDO" },
      { consultaDanfe, nfeIo, atrasoHedgeMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(11);
    const resultado = await consulta;
    vi.useRealTimers();

    expect(resultado.provedor).toBe("NFE_IO");
    expect(resultado.provedoresConsultados).toEqual(["CONSULTA_DANFE", "NFE_IO"]);
  });
});
