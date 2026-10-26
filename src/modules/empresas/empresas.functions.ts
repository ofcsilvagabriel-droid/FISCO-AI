import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const CNPJ = z.string().regex(/^[0-9]{14}$/);
const cnpjInput = z.object({ cnpj: CNPJ });
const empresaInput = z.object({
  cnpj: CNPJ,
  razao_social: z.string().trim().min(1).max(180),
  nome_fantasia: z.string().trim().max(180).optional().nullable(),
  uf: z.string().regex(/^[A-Za-z]{2}$/).optional().nullable(),
  inscricao_estadual: z.string().trim().max(32).optional().nullable(),
  regime: z.enum(["SN", "LP", "LR", "MEI", "OUTRO"]).optional().nullable(),
  ativa: z.boolean().default(true),
  busca_xml_automatica: z.boolean().default(true),
});
const acessoInput = z.object({
  cnpj: CNPJ,
  sistema: z.string().trim().min(1).max(120),
  endereco_portal: z.string().trim().max(500).optional().nullable(),
  usuario: z.string().max(240).optional().default(""),
  senha: z.string().max(512).optional().default(""),
  observacoes: z.string().max(2000).optional().nullable(),
});
const empresaImportInput = z.object({
  ...empresaInput.shape,
  sistema: z.string().trim().min(1).max(120).optional().default("Portal SEFAZ"),
  endereco_portal: z.string().trim().max(500).optional().nullable(),
  usuario: z.string().max(240).optional().default(""),
  senha: z.string().max(512).optional().default(""),
  observacoes_acesso: z.string().max(2000).optional().nullable(),
}).superRefine((empresa, contexto) => {
  if (Boolean(empresa.usuario) !== Boolean(empresa.senha)) {
    contexto.addIssue({ code: "custom", message: "Usuário e senha precisam ser informados juntos." });
  }
});
const importarEmpresasInput = z.object({ empresas: z.array(empresaImportInput).min(1).max(100) });

export const listarEmpresasFisco = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [{ data: empresas, error }, { data: certificados, error: certificadoErro }, { data: acessos, error: acessoErro }] = await Promise.all([
      db.from("fiscoai_empresas").select("cnpj,razao_social,nome_fantasia,uf,inscricao_estadual,regime,ativa,busca_xml_automatica,criado_em,atualizado_em")
        .eq("user_id", context.userId).order("razao_social"),
      db.from("fiscoai_certificados_dfe").select("cnpj,nome,titular,validade_inicio,validade_fim,fingerprint_sha256,atualizado_em")
        .eq("user_id", context.userId),
      db.from("fiscoai_acessos_sefaz").select("empresa_cnpj,sistema,endereco_portal,observacoes,atualizado_em")
        .eq("user_id", context.userId),
    ]);
    if (error || certificadoErro || acessoErro) throw new Error(error?.message || certificadoErro?.message || acessoErro?.message);
    const porCnpjCertificado = new Map((certificados || []).map((cert: any) => [cert.cnpj, cert]));
    const porCnpjAcesso = new Map((acessos || []).map((acesso: any) => [acesso.empresa_cnpj, { ...acesso, tem_acesso: true }]));
    return (empresas || []).map((empresa: any) => ({
      ...empresa,
      certificado: porCnpjCertificado.get(empresa.cnpj) || null,
      acesso_sefaz: porCnpjAcesso.get(empresa.cnpj) || null,
    }));
  });

export const salvarEmpresaFisco = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => empresaInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: empresa, error } = await db.from("fiscoai_empresas").upsert({
      user_id: context.userId,
      ...data,
      uf: data.uf?.toUpperCase() || null,
      nome_fantasia: data.nome_fantasia || null,
      inscricao_estadual: data.inscricao_estadual || null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "user_id,cnpj" })
      .select("cnpj,razao_social,nome_fantasia,uf,inscricao_estadual,regime,ativa,busca_xml_automatica,criado_em,atualizado_em")
      .single();
    if (error) throw new Error(error.message);
    return empresa;
  });

export const importarEmpresasFisco = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => importarEmpresasInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { criptografarSegredoEmpresa } = await import("./segredoEmpresa.server");
    const db = supabaseAdmin as any;
    let empresasSalvas = 0;
    let acessosSalvos = 0;
    const erros: Array<{ cnpj: string; mensagem: string }> = [];

    for (const item of data.empresas) {
      const { sistema, endereco_portal, usuario, senha, observacoes_acesso, ...empresa } = item;
      const agora = new Date().toISOString();
      const { error: empresaErro } = await db.from("fiscoai_empresas").upsert({
        user_id: context.userId,
        ...empresa,
        uf: empresa.uf?.toUpperCase() || null,
        nome_fantasia: empresa.nome_fantasia || null,
        inscricao_estadual: empresa.inscricao_estadual || null,
        atualizado_em: agora,
      }, { onConflict: "user_id,cnpj" });

      if (empresaErro) {
        erros.push({ cnpj: empresa.cnpj, mensagem: empresaErro.message });
        continue;
      }
      empresasSalvas += 1;

      if (usuario && senha) {
        const segredo = criptografarSegredoEmpresa(JSON.stringify({ usuario, senha }));
        const { error: acessoErro } = await db.from("fiscoai_acessos_sefaz").upsert({
          user_id: context.userId,
          empresa_cnpj: empresa.cnpj,
          sistema,
          endereco_portal: endereco_portal || null,
          segredo_criptografado: segredo,
          observacoes: observacoes_acesso || null,
          atualizado_em: agora,
        }, { onConflict: "user_id,empresa_cnpj" });
        if (acessoErro) erros.push({ cnpj: empresa.cnpj, mensagem: acessoErro.message });
        else acessosSalvos += 1;
      }
    }

    return {
      total: data.empresas.length,
      empresas_salvas: empresasSalvas,
      acessos_salvos: acessosSalvos,
      sem_acesso: data.empresas.length - acessosSalvos,
      erros,
    };
  });

export const salvarAcessoSefazEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => acessoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: atual, error: consultaErro } = await db.from("fiscoai_acessos_sefaz")
      .select("segredo_criptografado").eq("user_id", context.userId).eq("empresa_cnpj", data.cnpj).maybeSingle();
    if (consultaErro) throw new Error(consultaErro.message);
    let segredo = atual?.segredo_criptografado;
    if (data.usuario || data.senha) {
      if (!data.usuario || !data.senha) throw new Error("Informe o usuário e a senha juntos para cadastrar ou atualizar o acesso.");
      const { criptografarSegredoEmpresa } = await import("./segredoEmpresa.server");
      segredo = criptografarSegredoEmpresa(JSON.stringify({ usuario: data.usuario, senha: data.senha }));
    }
    if (!segredo) throw new Error("Informe o usuário e a senha para cadastrar o primeiro acesso.");
    const { error } = await db.from("fiscoai_acessos_sefaz").upsert({
      user_id: context.userId,
      empresa_cnpj: data.cnpj,
      sistema: data.sistema,
      endereco_portal: data.endereco_portal || null,
      segredo_criptografado: segredo,
      observacoes: data.observacoes || null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "user_id,empresa_cnpj" });
    if (error) throw new Error(error.message);
    return { cnpj: data.cnpj, tem_acesso: true, atualizado_em: new Date().toISOString() };
  });

export const removerAcessoSefazEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => cnpjInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await (supabaseAdmin as any).from("fiscoai_acessos_sefaz").delete()
      .eq("user_id", context.userId).eq("empresa_cnpj", data.cnpj);
    if (error) throw new Error(error.message);
    return { removido: true };
  });
