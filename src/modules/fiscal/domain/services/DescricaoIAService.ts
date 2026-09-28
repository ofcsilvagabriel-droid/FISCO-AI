// Cache client-side das descrições expandidas pela IA.
// Etapa auxiliar: se não houver expansão disponível, o motor usa a
// descrição original — o comportamento padrão nunca muda.
import { expandirDescricoes } from "@/lib/normalizarDescricao.functions";

const cache = new Map<string, string>();
let ativo = true;

const chave = (d: unknown) => String(d ?? "").trim().toLowerCase();

export const DescricaoIAService = {
  ativo: () => ativo,
  setAtivo(v: boolean) { ativo = v; },

  /** Síncrono: usado dentro do motor. Sem cache → descrição original. */
  expandida(descricao: unknown): string {
    const k = chave(descricao);
    if (!ativo || !k) return String(descricao ?? "");
    return cache.get(k) ?? String(descricao ?? "");
  },

  /** Pré-carrega expansões em lote (chamado antes da análise). */
  async preparar(descricoes: unknown[]): Promise<void> {
    if (!ativo) return;
    const pendentes = [...new Set(
      descricoes.map(chave).filter((d) => d && !cache.has(d)),
    )];
    if (!pendentes.length) return;
    for (let i = 0; i < pendentes.length; i += 40) {
      const lote = pendentes.slice(i, i + 40);
      try {
        const r = await expandirDescricoes({ data: { descricoes: lote } });
        lote.forEach((orig, idx) => cache.set(orig, r.descricoes[idx] ?? orig));
      } catch {
        lote.forEach((orig) => cache.set(orig, orig));
      }
    }
  },
};
