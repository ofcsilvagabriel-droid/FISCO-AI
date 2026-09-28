// Service de Rastreabilidade Tributária — porta única de leitura e
// escrita da trilha. Registra apenas ações de negócio relevantes.
import { logger } from "@/core/logger";
import type { DomainEvent } from "@/core/integration";
import { RelevanciaPolicy } from "../policies/RelevanciaPolicy";
import { TrilhaRepository } from "../repositories/TrilhaRepository";
import {
  TrilhaEventoSchema,
  type AcaoRastreavel,
  type ContextoTrilha,
  type TrilhaEvento,
} from "../entities/TrilhaEvento";

function novoId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `trl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function descrever(evento: DomainEvent, acao: AcaoRastreavel): string {
  const alvo = evento.objeto.id ? `${evento.objeto.tipo} ${evento.objeto.id}` : evento.objeto.tipo;
  const legivel = acao.replaceAll("_", " ").toLowerCase();
  return `${alvo}: ${legivel}`;
}

export const RastreabilidadeService = {
  /** Registro direto (uso interno dos handlers e de ações do usuário). */
  registrar(entrada: {
    acao: AcaoRastreavel;
    descricao: string;
    fundamento?: string | null;
    contexto?: Partial<ContextoTrilha>;
    detalhes?: Record<string, unknown>;
    eventoId?: string | null;
  }): TrilhaEvento {
    const registro = TrilhaEventoSchema.parse({
      id: novoId(),
      acao: entrada.acao,
      descricao: entrada.descricao,
      fundamento: entrada.fundamento ?? null,
      data: new Date().toISOString(),
      eventoId: entrada.eventoId ?? null,
      contexto: {
        usuarioId: entrada.contexto?.usuarioId ?? null,
        empresaId: entrada.contexto?.empresaId ?? null,
        competencia: entrada.contexto?.competencia ?? null,
        processoId: entrada.contexto?.processoId ?? null,
        execucaoId: entrada.contexto?.execucaoId ?? null,
        produtoId: entrada.contexto?.produtoId ?? null,
        motor: entrada.contexto?.motor ?? null,
        legislacao: entrada.contexto?.legislacao ?? null,
        relatorioId: entrada.contexto?.relatorioId ?? null,
      },
      detalhes: entrada.detalhes ?? {},
    });
    return TrilhaRepository.registrar(registro);
  },

  /** Converte um evento de plataforma em trilha, se for relevante. */
  registrarDeEvento(evento: DomainEvent): TrilhaEvento | null {
    const acao = RelevanciaPolicy.acaoDe(evento);
    if (!acao) return null;
    const p = evento.payload as Record<string, unknown>;
    logger.debug("rastreabilidade", `registrando ${acao}`);
    return RastreabilidadeService.registrar({
      acao,
      descricao: typeof p["descricao"] === "string" ? (p["descricao"] as string) : descrever(evento, acao),
      fundamento: typeof p["fundamento"] === "string" ? (p["fundamento"] as string) : null,
      eventoId: evento.id,
      contexto: {
        usuarioId: evento.contexto.usuarioId,
        empresaId: evento.contexto.empresaId,
        competencia: evento.contexto.competencia,
        processoId: evento.contexto.processoId,
        execucaoId: evento.contexto.execucaoId,
        produtoId: evento.contexto.produtoId,
        motor: typeof p["motor"] === "string" ? (p["motor"] as string) : null,
        legislacao: typeof p["legislacao"] === "string" ? (p["legislacao"] as string) : null,
        relatorioId: typeof p["relatorioId"] === "string" ? (p["relatorioId"] as string) : null,
      },
      detalhes: p,
    });
  },

  // --- Auditoria contextual (cada tela consulta só o seu contexto)
  porProduto: (id: string) => TrilhaRepository.porContexto("produtoId", id),
  porEmpresa: (id: string) => TrilhaRepository.porContexto("empresaId", id),
  porCompetencia: (c: string) => TrilhaRepository.porContexto("competencia", c),
  porUsuario: (id: string) => TrilhaRepository.porContexto("usuarioId", id),
  porExecucao: (id: string) => TrilhaRepository.porContexto("execucaoId", id),
  porProcesso: (id: string) => TrilhaRepository.porContexto("processoId", id),
  porMotor: (m: string) => TrilhaRepository.porContexto("motor", m),
  porLegislacao: (l: string) => TrilhaRepository.porContexto("legislacao", l),
  porRelatorio: (id: string) => TrilhaRepository.porContexto("relatorioId", id),
  listar: () => TrilhaRepository.listar(),
  limpar: () => TrilhaRepository.limpar(),
};
