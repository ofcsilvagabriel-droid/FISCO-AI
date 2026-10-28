import { createFileRoute } from "@tanstack/react-router";

const MAX_CNPJS_POR_EXECUCAO = 5;

export const Route = createFileRoute("/api/cron/buscar-nfe")({
  server: {
    handlers: {
      GET: async ({ request }) => {
    const segredo = process.env.CRON_SECRET;
    if (!segredo || request.headers.get("authorization") !== `Bearer ${segredo}`) {
      return Response.json({ erro: "Não autorizado." }, { status: 401 });
    }

    const [{ supabaseAdmin }, { consultarDistribuicaoDfe, processarCienciasPendentes }, { existeLoteDfePendente, INTERVALO_MINIMO_BUSCA_DFE_MS }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/modules/dfe/services/distribuicaoDfe.server"),
      import("@/modules/dfe/services/distribuicaoDfe.shared"),
    ]);

    const db = supabaseAdmin as any;
    const agora = new Date().toISOString();
    const ciencias = await processarCienciasPendentes(db).catch(() => ({ enviadas: 0, falhas: 1 }));
    const [{ data: empresas, error: empresasErro }, { data: certificados, error: certificadosErro }, { data: cursores, error: cursoresErro }] = await Promise.all([
      db.from("fiscoai_empresas").select("user_id,cnpj").eq("ativa", true).eq("busca_xml_automatica", true),
      db.from("fiscoai_certificados_dfe").select("user_id,cnpj,validade_fim"),
      db.from("fiscoai_dfe_cursores").select("user_id,cnpj,ult_nsu,max_nsu,bloqueado_ate,consultado_em"),
    ]);
    if (empresasErro || certificadosErro || cursoresErro) {
      return Response.json({ erro: "Não foi possível carregar a fila de busca." }, { status: 500 });
    }

    const chavesEmpresa = new Set((empresas || []).map((empresa: any) => `${empresa.user_id}:${empresa.cnpj}`));
    const cursorPorChave = new Map<string, any>((cursores || []).map((cursor: any) => [`${cursor.user_id}:${cursor.cnpj}`, cursor]));
    const elegiveis = (certificados || []).filter((certificado: any) => {
      const chave = `${certificado.user_id}:${certificado.cnpj}`;
      const cursor = cursorPorChave.get(chave);
      return chavesEmpresa.has(chave) && !!cursor
        && new Date(certificado.validade_fim).getTime() > Date.now()
        && new Date(cursor.bloqueado_ate).getTime() <= Date.now()
        && (existeLoteDfePendente(cursor) || !cursor.consultado_em
          || Date.now() - new Date(cursor.consultado_em).getTime() >= INTERVALO_MINIMO_BUSCA_DFE_MS);
    }).sort((a: any, b: any) => {
      const cursorA = cursorPorChave.get(`${a.user_id}:${a.cnpj}`);
      const cursorB = cursorPorChave.get(`${b.user_id}:${b.cnpj}`);
      return String(cursorA?.consultado_em || "").localeCompare(String(cursorB?.consultado_em || ""));
    }).slice(0, MAX_CNPJS_POR_EXECUCAO);

    const resultados = await Promise.allSettled(elegiveis.map((certificado: any) =>
      consultarDistribuicaoDfe(db, certificado.user_id, certificado.cnpj)
    ));
    const consultados = resultados.filter(resultado => resultado.status === "fulfilled").length;
    const falhas = resultados.length - consultados;
    return Response.json({ executado_em: agora, consultados, falhas, ciencias, fila_restante: Math.max(0, (empresas?.length || 0) - elegiveis.length) });
      },
    },
  },
});
