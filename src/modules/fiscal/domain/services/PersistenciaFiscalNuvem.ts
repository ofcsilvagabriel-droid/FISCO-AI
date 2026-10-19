// Cópia por usuário dos dados fiscais. A chave pública do Supabase nunca concede
// acesso aos dados de outro usuário: a tabela exige autenticação e RLS.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

const TABELA = "fiscoai_dados_fiscais";

export function nuvemConfigurada(): boolean {
  return typeof window !== "undefined"
    && !!import.meta.env.VITE_SUPABASE_URL
    && !!import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
}

export async function usuarioFiscal(): Promise<string | null> {
  if (!nuvemConfigurada()) return null;
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session?.user.id || null;
}

export async function carregarDaNuvem(tipo: string): Promise<{ dados: unknown; versao: number } | null> {
  const userId = await usuarioFiscal();
  if (!userId) return null;
  const { data, error } = await (supabase as any).from(TABELA)
    .select("dados,versao").eq("user_id", userId).eq("tipo", tipo).maybeSingle();
  if (error) throw error;
  return data ? { dados: data.dados, versao: Number(data.versao) || 0 } : null;
}

export async function salvarNaNuvem(tipo: string, dados: unknown, versao: number): Promise<void> {
  const userId = await usuarioFiscal();
  if (!userId) return;
  const { error } = await (supabase as any).from(TABELA).upsert({
    user_id: userId, tipo, dados, versao, atualizado_em: new Date().toISOString(),
  }, { onConflict: "user_id,tipo" });
  if (error) throw error;
}
