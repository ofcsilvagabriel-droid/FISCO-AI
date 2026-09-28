// Etapa auxiliar (NÃO decisória): expande abreviações comerciais da
// descrição do produto. A IA nunca classifica, nunca decide ST —
// devolve apenas o texto expandido para alimentar a comparação
// textual já existente no motor.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({ descricoes: z.array(z.string().min(1)).min(1).max(50) });

const SISTEMA = [
  "Você expande abreviações comerciais em descrições de mercadorias de nota fiscal.",
  "Regras: expanda apenas abreviações e siglas comerciais evidentes (REFRIG -> refrigerante, EMB -> embalagem, PC -> peça, UND -> unidade).",
  "NUNCA infira categoria fiscal, NCM, CEST, ST, tributação ou finalidade.",
  "Não adicione palavras que não estejam implícitas na abreviação. Mantenha números, medidas e marcas.",
  "Responda apenas com JSON no formato {\"descricoes\":[\"...\"]} na mesma ordem e mesma quantidade de itens recebidos.",
].join(" ");

export const expandirDescricoes = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }) => {
    const key = process.env["LOVABLE_API_KEY"];
    if (!key) return { descricoes: data.descricoes };

    try {
      const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Lovable-API-Key": key,
          "X-Lovable-AIG-SDK": "fetch",
        },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [
            { role: "system", content: SISTEMA },
            { role: "user", content: JSON.stringify({ descricoes: data.descricoes }) },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!res.ok) return { descricoes: data.descricoes };
      const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const conteudo = json.choices?.[0]?.message?.content ?? "";
      const parsed = JSON.parse(conteudo) as { descricoes?: unknown };
      const saida = Array.isArray(parsed.descricoes) ? parsed.descricoes : [];
      return {
        descricoes: data.descricoes.map((original, i) => {
          const v = saida[i];
          return typeof v === "string" && v.trim() ? v.trim() : original;
        }),
      };
    } catch {
      return { descricoes: data.descricoes };
    }
  });
