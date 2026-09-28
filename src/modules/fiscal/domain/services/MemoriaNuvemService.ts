// Service: SINCRONIZAÇÃO DA MEMÓRIA FISCAL EM NUVEM (+ espelho local).
// A fonte de trabalho continua sendo o localStorage (rápido, offline);
// a nuvem guarda a DECISÃO fiscal por empresa::ncm::faixa do usuário logado.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

import { HistoricoApuracaoService } from "./HistoricoApuracaoService";

export type StatusNuvem = {
  autenticado: boolean;
  email: string | null;
  ultima_sincronizacao: string | null;
  registros_nuvem: number;
  registros_locais: number;
};

const KEY_SYNC = "fiscoai:memoria-nuvem:ultima-sync";

const iso = (v: unknown) => String(v || "");

/** Decisão corrente de um histórico local (usada como payload da nuvem). */
function decisaoDoHistorico(h: any) {
  const corrente = h?.versao_corrente || (h?.apuracoes || []).slice(-1)[0] || null;
  const calc = corrente?.calculo_aplicado || {};
  return {
    empresa_id: String(h.empresa_id || ""),
    ncm: String(h.ncm || ""),
    faixa_interestadual: String(h.aliquota_interestadual_faixa || "NA"),
    regime_tributario_aplicado: String(calc.regime_tributario_aplicado || calc.tributacao || "NORMAL"),
    origem_decisao: String(calc.origem_decisao || calc.tipo_calculo || "AUTOMATICO"),
    descricao_ultima: String(h.descricao_ncm_ultima_nota || "").slice(0, 500) || null,
    parametros: calc.parametros || {},
    calculo_aplicado: { historico: h },
    legislacao: calc.legislacao || {},
    fingerprint: String(calc.fingerprint || ""),
    versao: Number(corrente?.versao || h.proxima_versao || 1),
    vezes_aplicada: Number(h.vezes_aplicada || 0),
    congelado: /CONGELADO/i.test(String(calc.tipo_calculo || calc.origem_decisao || "")),
    ativo: h.ativo !== false,
    atualizado_em: h.atualizado_em || new Date().toISOString(),
  };
}

export const MemoriaNuvemService = {
  async usuario() {
    const { data } = await supabase.auth.getUser();
    return data.user ?? null;
  },

  async status(): Promise<StatusNuvem> {
    const user = await MemoriaNuvemService.usuario();
    let registros_nuvem = 0;
    if (user) {
      const { count } = await supabase
        .from("memoria_decisoes")
        .select("id", { count: "exact", head: true });
      registros_nuvem = count || 0;
    }
    return {
      autenticado: !!user,
      email: user?.email ?? null,
      ultima_sincronizacao: localStorage.getItem(KEY_SYNC),
      registros_nuvem,
      registros_locais: HistoricoApuracaoService.listarTudo().length,
    };
  },

  /** Envia os históricos locais para a nuvem (upsert por empresa::ncm::faixa). */
  async enviar(): Promise<{ enviados: number }> {
    const user = await MemoriaNuvemService.usuario();
    if (!user) throw new Error("Faça login para sincronizar a memória na nuvem.");
    const locais = HistoricoApuracaoService.listarTudo().filter((h: any) => h?.empresa_id && h?.ncm);
    if (!locais.length) return { enviados: 0 };

    const linhas = locais.map((h: any) => ({ ...decisaoDoHistorico(h), user_id: user.id }));
    const { error } = await supabase
      .from("memoria_decisoes")
      .upsert(linhas as any, { onConflict: "user_id,empresa_id,ncm,faixa_interestadual" });
    if (error) throw error;

    await supabase.from("memoria_eventos").insert({
      user_id: user.id,
      empresa_id: "_",
      ncm: "_",
      tipo: "SINCRONIZACAO_ENVIO",
      descricao: `Enviou ${linhas.length} decisões para a nuvem`,
    } as any);

    localStorage.setItem(KEY_SYNC, new Date().toISOString());
    return { enviados: linhas.length };
  },

  /** Traz a memória da nuvem e mescla no espelho local (mais recente vence). */
  async receber(): Promise<{ recebidos: number; aplicados: number }> {
    const user = await MemoriaNuvemService.usuario();
    if (!user) throw new Error("Faça login para sincronizar a memória na nuvem.");
    const { data, error } = await supabase.from("memoria_decisoes").select("*");
    if (error) throw error;

    let aplicados = 0;
    (data || []).forEach((row: any) => {
      const historico = row?.calculo_aplicado?.historico;
      if (!historico?.ncm || !historico?.empresa_id) return;
      const local = HistoricoApuracaoService.buscarHistoricoNCM(
        historico.ncm,
        historico.empresa_id,
        historico.aliquota_interestadual_faixa || "NA",
      );
      if (local && iso(local.atualizado_em) >= iso(historico.atualizado_em)) return;
      HistoricoApuracaoService.salvarHistoricoNCM(historico, historico.empresa_id);
      aplicados += 1;
    });

    localStorage.setItem(KEY_SYNC, new Date().toISOString());
    return { recebidos: (data || []).length, aplicados };
  },

  /** Sincronização completa: recebe e depois envia. */
  async sincronizar() {
    const recebido = await MemoriaNuvemService.receber();
    const enviado = await MemoriaNuvemService.enviar();
    return { ...recebido, ...enviado };
  },

  /** Auditoria remota (últimos eventos do usuário). */
  async eventos(limite = 50) {
    const user = await MemoriaNuvemService.usuario();
    if (!user) return [];
    const { data } = await supabase
      .from("memoria_eventos")
      .select("*")
      .order("criado_em", { ascending: false })
      .limit(limite);
    return data || [];
  },
};

export default MemoriaNuvemService;
