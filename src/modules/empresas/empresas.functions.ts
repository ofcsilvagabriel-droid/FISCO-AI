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
  situacao: z.enum(["ATIVA", "INATIVA", "SUSPENSA", "BAIXADA"]).default("ATIVA"),
  tipo_estabelecimento: z.enum(["MATRIZ", "FILIAL"]).default("MATRIZ"),
  matriz_empresa_id: z.string().uuid().optional().nullable(),
  codigo_interno: z.string().trim().max(40).optional().nullable(),
  responsavel_nome: z.string().trim().max(180).optional().nullable(),
  cnae_principal: z.string().trim().max(16).optional().nullable(),
  email: z.string().trim().email().max(240).optional().nullable().or(z.literal("")),
  telefone: z.string().trim().max(32).optional().nullable(),
  cep: z.string().trim().max(9).optional().nullable(),
  municipio: z.string().trim().max(120).optional().nullable(),
  bairro: z.string().trim().max(120).optional().nullable(),
  logradouro: z.string().trim().max(240).optional().nullable(),
  numero: z.string().trim().max(32).optional().nullable(),
  complemento: z.string().trim().max(120).optional().nullable(),
  ativa: z.boolean().default(true),
  busca_xml_automatica: z.boolean().default(false),
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
const integracaoInput = z.object({
  cnpj: CNPJ,
  habilitada: z.boolean(),
});

export const listarEmpresasFisco = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const [{ data: empresas, error }, { data: certificados, error: certificadoErro }, { data: acessos, error: acessoErro }] = await Promise.all([
      db.from("fiscoai_empresas").select("empresa_id,cnpj,razao_social,nome_fantasia,uf,inscricao_estadual,regime,situacao,tipo_estabelecimento,matriz_empresa_id,codigo_interno,responsavel_nome,cnae_principal,email,telefone,cep,municipio,bairro,logradouro,numero,complemento,ativa,busca_xml_automatica,criado_em,atualizado_em")
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
    if (data.tipo_estabelecimento === "FILIAL" && !data.matriz_empresa_id) {
      throw new Error("Selecione a matriz à qual esta filial pertence.");
    }
    if (data.matriz_empresa_id) {
      const { data: matriz, error: matrizErro } = await db.from("fiscoai_empresas")
        .select("empresa_id,cnpj,tipo_estabelecimento")
        .eq("user_id", context.userId).eq("empresa_id", data.matriz_empresa_id).maybeSingle();
      if (matrizErro || !matriz || matriz.tipo_estabelecimento !== "MATRIZ" || matriz.cnpj === data.cnpj) {
        throw new Error("A matriz selecionada não é válida para esta conta.");
      }
    }
    const { data: empresa, error } = await db.from("fiscoai_empresas").upsert({
      user_id: context.userId,
      ...data,
      uf: data.uf?.toUpperCase() || null,
      nome_fantasia: data.nome_fantasia || null,
      inscricao_estadual: data.inscricao_estadual || null,
      matriz_empresa_id: data.tipo_estabelecimento === "FILIAL" ? data.matriz_empresa_id : null,
      codigo_interno: data.codigo_interno || null,
      responsavel_nome: data.responsavel_nome || null,
      cnae_principal: data.cnae_principal || null,
      email: data.email || null,
      telefone: data.telefone || null,
      cep: data.cep || null,
      municipio: data.municipio || null,
      bairro: data.bairro || null,
      logradouro: data.logradouro || null,
      numero: data.numero || null,
      complemento: data.complemento || null,
      busca_xml_automatica: false,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "user_id,cnpj" })
      .select("empresa_id,cnpj,razao_social,nome_fantasia,uf,inscricao_estadual,regime,situacao,tipo_estabelecimento,matriz_empresa_id,codigo_interno,responsavel_nome,cnae_principal,email,telefone,cep,municipio,bairro,logradouro,numero,complemento,ativa,busca_xml_automatica,criado_em,atualizado_em")
      .single();
    if (error) throw new Error(error.message);
    await db.from("fiscoai_empresa_integracoes").upsert({
      user_id: context.userId,
      empresa_id: empresa.empresa_id,
      empresa_cnpj: empresa.cnpj,
      tipo: "RECUPERACAO_XML",
    }, { onConflict: "user_id,empresa_id,tipo", ignoreDuplicates: true });
    await db.from("fiscoai_empresa_usuarios").upsert({
      user_id: context.userId,
      empresa_id: empresa.empresa_id,
      membro_user_id: context.userId,
      papel: "PROPRIETARIO",
    }, { onConflict: "user_id,empresa_id,membro_user_id", ignoreDuplicates: true });
    await db.from("fiscoai_xml_auditoria").insert({
      user_id: context.userId,
      empresa_id: empresa.empresa_id,
      empresa_cnpj: empresa.cnpj,
      operacao: "SALVAR_EMPRESA",
      status: "SUCESSO",
      mensagem: "Cadastro empresarial atualizado.",
    });
    return empresa;
  });

export const obterPainelEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => cnpjInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: empresa, error: empresaErro } = await db.from("fiscoai_empresas")
      .select("empresa_id,cnpj").eq("user_id", context.userId).eq("cnpj", data.cnpj).maybeSingle();
    if (empresaErro || !empresa) throw new Error("Empresa não encontrada nesta conta.");
    const [documentos, fila, auditoria, integracao, membros, filiais] = await Promise.all([
      db.from("fiscoai_dfe_documentos")
        .select("id,chave_acesso,numero_nfe,emitente_nome,data_emissao,valor_total_xml,processamento_status,origem,recebido_em")
        .eq("user_id", context.userId).eq("cnpj", data.cnpj).eq("tipo_conteudo", "XML_COMPLETO")
        .order("data_emissao", { ascending: false, nullsFirst: false }).limit(20),
      db.from("fiscoai_xml_itens").select("status").eq("user_id", context.userId).eq("empresa_id", empresa.empresa_id),
      db.from("fiscoai_xml_auditoria")
        .select("id,operacao,status,codigo_retorno,mensagem,detalhes,criado_em,finalizado_em")
        .eq("user_id", context.userId).eq("empresa_id", empresa.empresa_id)
        .order("criado_em", { ascending: false }).limit(30),
      db.from("fiscoai_empresa_integracoes")
        .select("tipo,provedor,status,ultima_execucao_em,ultimo_sucesso_em,ultimo_erro,atualizado_em")
        .eq("user_id", context.userId).eq("empresa_id", empresa.empresa_id).maybeSingle(),
      db.from("fiscoai_empresa_usuarios")
        .select("membro_user_id,papel,ativo,criado_em,atualizado_em")
        .eq("user_id", context.userId).eq("empresa_id", empresa.empresa_id).order("criado_em"),
      db.from("fiscoai_empresas")
        .select("empresa_id,cnpj,razao_social,nome_fantasia,situacao")
        .eq("user_id", context.userId).eq("matriz_empresa_id", empresa.empresa_id).order("razao_social"),
    ]);
    const falha = [documentos, fila, auditoria, integracao, membros, filiais].find(item => item.error)?.error;
    if (falha) throw new Error(falha.message);
    const itens = fila.data || [];
    const docs = documentos.data || [];
    const membrosDetalhados = await Promise.all((membros.data || []).map(async (membro: any) => {
      const { data: usuario } = await supabaseAdmin.auth.admin.getUserById(membro.membro_user_id);
      return { ...membro, email: usuario?.user?.email || null };
    }));
    return {
      documentos: docs,
      auditoria: auditoria.data || [],
      integracao: integracao.data || null,
      membros: membrosDetalhados,
      filiais: filiais.data || [],
      indicadores: {
        documentos: docs.length,
        importadas: docs.filter((item: any) => item.processamento_status === "importada").length,
        internas: docs.filter((item: any) => item.processamento_status === "interna").length,
        pendentes: itens.filter((item: any) => ["NA_FILA", "CONSULTANDO", "PROVEDOR_INDISPONIVEL", "BLOQUEADA"].includes(item.status)).length,
        falhas: itens.filter((item: any) => item.status === "FALHA_DEFINITIVA").length,
      },
    };
  });

export const configurarIntegracaoXmlEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => integracaoInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    const { data: empresa, error: empresaErro } = await db.from("fiscoai_empresas")
      .select("empresa_id,cnpj").eq("user_id", context.userId).eq("cnpj", data.cnpj).maybeSingle();
    if (empresaErro || !empresa) throw new Error("Empresa não encontrada nesta conta.");
    const status = data.habilitada ? "AGUARDANDO_CONFIGURACAO" : "DESATIVADA";
    const { error } = await db.from("fiscoai_empresa_integracoes").upsert({
      user_id: context.userId,
      empresa_id: empresa.empresa_id,
      empresa_cnpj: empresa.cnpj,
      tipo: "RECUPERACAO_XML",
      provedor: "WORKER_AUTORIZADO",
      status,
      ultimo_erro: null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: "user_id,empresa_id,tipo" });
    if (error) throw new Error(error.message);
    await db.from("fiscoai_xml_auditoria").insert({
      user_id: context.userId,
      empresa_id: empresa.empresa_id,
      empresa_cnpj: empresa.cnpj,
      operacao: data.habilitada ? "HABILITAR_INTEGRACAO_XML" : "DESATIVAR_INTEGRACAO_XML",
      status: "SUCESSO",
      mensagem: data.habilitada ? "Integração aguardando worker autorizado." : "Integração desativada pelo usuário.",
    });
    return { status };
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
        busca_xml_automatica: false,
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

export const revelarAcessoSefazEmpresa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((entrada: unknown) => cnpjInput.parse(entrada))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { descriptografarSegredoEmpresa } = await import("./segredoEmpresa.server");
    const { data: acesso, error } = await (supabaseAdmin as any).from("fiscoai_acessos_sefaz")
      .select("segredo_criptografado").eq("user_id", context.userId).eq("empresa_cnpj", data.cnpj).maybeSingle();
    if (error) throw new Error(error.message);
    if (!acesso?.segredo_criptografado) throw new Error("Não há credenciais cadastradas para esta empresa.");
    const credenciais = JSON.parse(descriptografarSegredoEmpresa(acesso.segredo_criptografado));
    return { usuario: String(credenciais.usuario || ""), senha: String(credenciais.senha || "") };
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
