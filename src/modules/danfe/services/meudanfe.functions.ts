import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * MeuDanfe API v2 — https://meudanfe.com.br/documentacao
 *
 * Regras de cobrança:
 *  - POST /fd/convert/xml-to-da   → GRÁTIS (converte XML em PDF)
 *  - PUT  /fd/add/xml             → GRÁTIS (envia XML e adiciona à Área do Cliente)
 *  - GET  /fd/get/da/{chave}      → GRÁTIS (baixa DANFE em PDF de nota já na conta)
 *  - GET  /fd/get/xml/{chave}     → GRÁTIS (baixa XML de nota já na conta)
 *  - PUT  /fd/add/{chave}         → PAGO R$ 0,03 (busca direto na SEFAZ)
 *
 * Autenticação: header "Api-Key: <sua-api-key>"
 * Body do XML: text/plain com o conteúdo do XML.
 */

const inputSchema = z
  .object({
    chave: z
      .string()
      .regex(/^\d{44}$/, "A chave de acesso deve ter exatamente 44 dígitos numéricos.")
      .optional(),
    xml: z.string().min(50, "Conteúdo XML inválido.").optional(),
    formato: z.enum(["pdf", "xml"]).optional().default("pdf"),
  })
  .refine((d) => d.xml || d.chave, {
    message: "Envie o XML ou a chave de acesso.",
  });

export type ConsultaDanfeInput = z.infer<typeof inputSchema>;

export interface ConsultaDanfeResult {
  chave: string;
  contentType: string;
  format: "pdf" | "xml" | "other";
  base64: string;
  filename: string;
  bytes: number;
  gratuita: boolean;
}

const BASE_URL = "https://api.meudanfe.com.br/v2";

function detectFormat(contentType: string, buffer: Uint8Array): "pdf" | "xml" | "other" {
  const ct = contentType.toLowerCase();
  if (ct.includes("pdf")) return "pdf";
  if (ct.includes("xml")) return "xml";
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46
  ) {
    return "pdf";
  }
  const head = new TextDecoder().decode(buffer.slice(0, Math.min(200, buffer.length))).trim();
  if (head.startsWith("<?xml") || head.startsWith("<nfeProc") || head.startsWith("<NFe")) return "xml";
  return "other";
}

function bufferToBase64(buf: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) {
    binary += String.fromCharCode(...buf.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64FromString(s: string): string {
  const idx = s.indexOf("base64,");
  return idx >= 0 ? s.slice(idx + 7) : s;
}

function base64ToBytes(b64: string): Uint8Array {
  // remove eventuais whitespaces/quebras de linha
  const clean = b64.replace(/\s+/g, "");
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function extrairChaveDeXml(xml: string): string | null {
  const idMatch = xml.match(/Id\s*=\s*"NFe(\d{44})"/i);
  if (idMatch) return idMatch[1];
  const ch = xml.match(/<chNFe>\s*(\d{44})\s*<\/chNFe>/i);
  if (ch) return ch[1];
  const any = xml.match(/(\d{44})/);
  return any ? any[1] : null;
}

function humanizeStatus(status: number, body: string): string {
  if (status === 400) return "XML/chave inválidos ou requisição malformada (HTTP 400). " + body;
  if (status === 401) return "Api-Key não informada ou inválida (HTTP 401).";
  if (status === 403) return "Api-Key foi substituída ou revogada (HTTP 403). Gere uma nova na Área do Cliente.";
  if (status === 402) return "Saldo insuficiente na conta MeuDanfe (HTTP 402).";
  if (status === 404) return "Nota não encontrada (HTTP 404).";
  if (status === 429) return "Muitas requisições — aguarde antes de tentar novamente (HTTP 429).";
  if (status >= 500) return "Erro na SEFAZ / servidor MeuDanfe (HTTP " + status + "). " + body;
  return `Erro HTTP ${status} ao consultar MeuDanfe. ${body}`;
}

async function readBodyForError(response: Response): Promise<string> {
  const t = await response.text().catch(() => "");
  return t.slice(0, 400);
}

function extractBase64FromJson(json: unknown): string | null {
  if (!json || typeof json !== "object") return null;
  const rec = json as Record<string, unknown>;
  for (const k of ["data", "base64", "pdf", "xml", "content", "file"]) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 20) return base64FromString(v);
  }
  return null;
}

export const consultarDanfe = createServerFn({ method: "POST" })
  .inputValidator((raw) => inputSchema.parse(raw))
  .handler(async ({ data }): Promise<ConsultaDanfeResult> => {
    const apiKey = process.env.MEUDANFE_API_KEY;
    if (!apiKey) {
      throw new Error("MEUDANFE_API_KEY não está configurada no servidor.");
    }

    // ================= CAMINHO GRATUITO: XML → PDF =================
    if (data.xml) {
      const chave = extrairChaveDeXml(data.xml) ?? data.chave ?? "sem-chave";

      let resp: Response;
      try {
        resp = await fetch(`${BASE_URL}/fd/convert/xml-to-da`, {
          method: "POST",
          headers: {
            "Api-Key": apiKey,
            "Content-Type": "text/plain",
            Accept: "application/json",
          },
          body: data.xml,
        });
      } catch (err) {
        throw new Error(`Falha de comunicação com o MeuDanfe: ${(err as Error).message}`);
      }
      if (!resp.ok) {
        const body = await readBodyForError(resp);
        throw new Error(humanizeStatus(resp.status, body));
      }

      const ct = resp.headers.get("content-type") ?? "application/json";
      let bytes: Uint8Array;
      let outCt = "application/pdf";
      if (ct.toLowerCase().includes("json")) {
        const json = await resp.json().catch(() => null);
        const b64 = extractBase64FromJson(json);
        if (!b64) {
          throw new Error(
            "Resposta inesperada do MeuDanfe (JSON sem base64): " +
              JSON.stringify(json).slice(0, 200),
          );
        }
        bytes = base64ToBytes(b64);
      } else {
        const ab = await resp.arrayBuffer();
        bytes = new Uint8Array(ab);
        outCt = ct;
      }
      const format = detectFormat(outCt, bytes);
      return {
        chave,
        contentType: outCt,
        format,
        base64: bufferToBase64(bytes),
        filename: `DANFE_${chave}.${format === "pdf" ? "pdf" : "bin"}`,
        bytes: bytes.byteLength,
        gratuita: true,
      };
    }

    // ================= CAMINHO PAGO BLOQUEADO =================
    // A busca via chave na SEFAZ é cobrada (R$ 0,03/consulta).
    // Por política do sistema, apenas o fluxo GRATUITO (XML → DANFE) é permitido.
    throw new Error(
      "🚫 Consulta bloqueada: a busca pela chave de acesso na SEFAZ é PAGA (R$ 0,03). " +
        "Envie o arquivo XML da NF-e para gerar o DANFE gratuitamente.",
    );
  });

