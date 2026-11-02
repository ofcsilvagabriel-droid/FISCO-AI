-- Evolução ERP da recuperação de XML:
-- 1. a planilha nunca confirma a empresa;
-- 2. falhas permanecem elegíveis com espera controlada;
-- 3. notificações e pendências são segregadas por empresa;
-- 4. o worker é acionado a cada 15 segundos somente quando há trabalho elegível.

ALTER TABLE public.fiscoai_xml_lotes
  ADD COLUMN IF NOT EXISTS arquivo_sha256 text,
  ADD COLUMN IF NOT EXISTS total_linhas integer NOT NULL DEFAULT 0 CHECK (total_linhas >= 0);

CREATE UNIQUE INDEX IF NOT EXISTS fiscoai_xml_lotes_arquivo_unico_idx
  ON public.fiscoai_xml_lotes (user_id, arquivo_sha256)
  WHERE arquivo_sha256 IS NOT NULL;

ALTER TABLE public.fiscoai_xml_itens
  ADD COLUMN IF NOT EXISTS total_tentativas integer NOT NULL DEFAULT 0 CHECK (total_tentativas >= 0),
  ADD COLUMN IF NOT EXISTS ciclo_tentativas integer NOT NULL DEFAULT 0 CHECK (ciclo_tentativas >= 0);

CREATE TABLE IF NOT EXISTS public.fiscoai_xml_notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid,
  empresa_cnpj text,
  item_id uuid REFERENCES public.fiscoai_xml_itens(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  tipo text NOT NULL DEFAULT 'FALHA_RECUPERACAO'
    CHECK (tipo IN ('FALHA_RECUPERACAO', 'DESTINATARIO_NAO_CADASTRADO', 'DIVERGENCIA_EMPRESA', 'XML_RECUPERADO')),
  severidade text NOT NULL DEFAULT 'ATENCAO'
    CHECK (severidade IN ('INFO', 'ATENCAO', 'CRITICA')),
  titulo text NOT NULL,
  mensagem text NOT NULL,
  lida_em timestamptz,
  resolvida_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, empresa_cnpj)
    REFERENCES public.fiscoai_empresas(user_id, cnpj) ON DELETE CASCADE,
  UNIQUE (user_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS fiscoai_xml_notificacoes_abertas_idx
  ON public.fiscoai_xml_notificacoes (user_id, empresa_cnpj, criado_em DESC)
  WHERE resolvida_em IS NULL;

ALTER TABLE public.fiscoai_xml_notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_notificacoes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscoai_xml_notificacoes FROM anon, authenticated;
GRANT ALL ON public.fiscoai_xml_notificacoes TO service_role;

-- Corrige a fila antiga usando apenas o destinatário já confirmado no XML armazenado.
UPDATE public.fiscoai_xml_itens item
SET empresa_id = empresa.empresa_id,
    empresa_cnpj = documento.cnpj,
    destinatario_cnpj_informado = documento.cnpj,
    identificacao_origem = 'XML_CONFIRMADO',
    atualizado_em = now()
FROM public.fiscoai_dfe_documentos documento
JOIN public.fiscoai_empresas empresa
  ON empresa.user_id = documento.user_id
 AND empresa.cnpj = documento.cnpj
WHERE item.documento_id = documento.id
  AND item.user_id = documento.user_id
  AND (
    item.empresa_id IS DISTINCT FROM empresa.empresa_id OR
    item.empresa_cnpj IS DISTINCT FROM documento.cnpj OR
    item.identificacao_origem IS DISTINCT FROM 'XML_CONFIRMADO'
  );

-- Vínculos oriundos apenas de planilha voltam a ser provisórios.
UPDATE public.fiscoai_xml_itens
SET empresa_id = NULL,
    empresa_cnpj = NULL,
    identificacao_origem = 'PENDENTE',
    atualizado_em = now()
WHERE documento_id IS NULL
  AND identificacao_origem = 'PLANILHA';

-- O lote somente mantém empresa quando todos os seus documentos confirmados pertencem a ela.
WITH resumo AS (
  SELECT lote_id,
         min(empresa_id::text)::uuid AS empresa_id,
         min(empresa_cnpj) AS empresa_cnpj,
         count(DISTINCT empresa_cnpj) AS empresas,
         count(*) FILTER (WHERE identificacao_origem <> 'XML_CONFIRMADO') AS nao_confirmados
  FROM public.fiscoai_xml_itens
  GROUP BY lote_id
)
UPDATE public.fiscoai_xml_lotes lote
SET empresa_id = CASE WHEN resumo.empresas = 1 AND resumo.nao_confirmados = 0 THEN resumo.empresa_id ELSE NULL END,
    empresa_cnpj = CASE WHEN resumo.empresas = 1 AND resumo.nao_confirmados = 0 THEN resumo.empresa_cnpj ELSE NULL END,
    atualizado_em = now()
FROM resumo
WHERE lote.id = resumo.lote_id;

CREATE OR REPLACE FUNCTION public.fiscoai_reivindicar_itens_xml(
  p_limite integer,
  p_lock_token uuid
)
RETURNS SETOF public.fiscoai_xml_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidatos AS (
    SELECT item.id
    FROM public.fiscoai_xml_itens item
    WHERE item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA', 'FALHA_DEFINITIVA')
      AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
      AND item.lock_ate <= now()
    ORDER BY coalesce(item.proxima_tentativa_em, item.criado_em), item.criado_em
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limite, 10), 50))
  )
  UPDATE public.fiscoai_xml_itens item
  SET status = 'CONSULTANDO',
      tentativas = item.tentativas + 1,
      total_tentativas = item.total_tentativas + 1,
      ciclo_tentativas = item.ciclo_tentativas + 1,
      lock_token = p_lock_token,
      lock_ate = now() + interval '15 minutes',
      atualizado_em = now()
  FROM candidatos
  WHERE item.id = candidatos.id
  RETURNING item.*;
END;
$$;

CREATE OR REPLACE FUNCTION public.fiscoai_reivindicar_itens_xml_usuario(
  p_limite integer,
  p_lock_token uuid,
  p_user_id uuid
)
RETURNS SETOF public.fiscoai_xml_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidatos AS (
    SELECT item.id
    FROM public.fiscoai_xml_itens item
    WHERE item.user_id = p_user_id
      AND item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA', 'FALHA_DEFINITIVA')
      AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
      AND item.lock_ate <= now()
    ORDER BY coalesce(item.proxima_tentativa_em, item.criado_em), item.criado_em
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limite, 5), 10))
  )
  UPDATE public.fiscoai_xml_itens item
  SET status = 'CONSULTANDO',
      tentativas = item.tentativas + 1,
      total_tentativas = item.total_tentativas + 1,
      ciclo_tentativas = item.ciclo_tentativas + 1,
      lock_token = p_lock_token,
      lock_ate = now() + interval '15 minutes',
      atualizado_em = now()
  FROM candidatos
  WHERE item.id = candidatos.id
  RETURNING item.*;
END;
$$;

REVOKE ALL ON FUNCTION public.fiscoai_reivindicar_itens_xml(integer, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fiscoai_reivindicar_itens_xml_usuario(integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscoai_reivindicar_itens_xml(integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.fiscoai_reivindicar_itens_xml_usuario(integer, uuid, uuid) TO service_role;

DO $$
DECLARE
  job_id bigint;
BEGIN
  FOR job_id IN SELECT jobid FROM cron.job WHERE jobname = 'fiscoai-worker-xml-automatico'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;
END $$;

SELECT cron.schedule(
  'fiscoai-worker-xml-automatico',
  '15 seconds',
  $job$
    SELECT net.http_get(
      url := 'https://fisco-ai-five.vercel.app/api/xml/cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'fiscoai_cron_secret'
        )
      ),
      timeout_milliseconds := 12000
    )
    WHERE EXISTS (
      SELECT 1
      FROM public.fiscoai_xml_itens item
      WHERE item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA', 'FALHA_DEFINITIVA')
        AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
        AND item.lock_ate <= now()
    );
  $job$
);

COMMENT ON TABLE public.fiscoai_xml_notificacoes IS
  'Notificações persistentes da recuperação de XML. Leitura e resolução são estados independentes.';
