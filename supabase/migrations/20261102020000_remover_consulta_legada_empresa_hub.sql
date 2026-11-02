-- Remove o motor operacional de consulta NSU/SEFAZ e consolida o acervo na API própria.
-- XMLs, certificados e metadados dos documentos são preservados.

DO $$
DECLARE
  job_id bigint;
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'fiscoai-buscar-nfe'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;
EXCEPTION
  WHEN undefined_table OR undefined_function THEN NULL;
END $$;

ALTER TABLE public.fiscoai_empresas
  ADD COLUMN IF NOT EXISTS codigo_interno text,
  ADD COLUMN IF NOT EXISTS responsavel_nome text,
  ADD COLUMN IF NOT EXISTS matriz_empresa_id uuid;

ALTER TABLE public.fiscoai_empresas
  DROP CONSTRAINT IF EXISTS fiscoai_empresas_matriz_fk,
  ADD CONSTRAINT fiscoai_empresas_matriz_fk
    FOREIGN KEY (user_id, matriz_empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id)
    ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS fiscoai_empresas_codigo_interno_unique
  ON public.fiscoai_empresas (user_id, codigo_interno)
  WHERE codigo_interno IS NOT NULL AND codigo_interno <> '';

CREATE TABLE IF NOT EXISTS public.fiscoai_xml_artefatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_cnpj text NOT NULL CHECK (empresa_cnpj ~ '^[0-9]{14}$'),
  documento_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('XML_ORIGINAL', 'XML_PROCESSADO', 'DANFE_PDF')),
  origem text NOT NULL CHECK (origem IN ('API_PROPRIA', 'IMPORTACAO_MANUAL', 'ACERVO_LEGADO')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL,
  content_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes >= 0),
  criptografia_versao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (documento_id, user_id, empresa_cnpj)
    REFERENCES public.fiscoai_dfe_documentos(id, user_id, cnpj) ON DELETE CASCADE,
  UNIQUE (user_id, empresa_cnpj, documento_id, tipo, sha256)
);

INSERT INTO public.fiscoai_xml_artefatos (
  user_id, empresa_cnpj, documento_id, tipo, origem, sha256, storage_path,
  content_type, tamanho_bytes, criptografia_versao, criado_em
)
SELECT
  user_id, cnpj, documento_id, tipo,
  CASE WHEN origem = 'IMPORTACAO_MANUAL' THEN 'IMPORTACAO_MANUAL' ELSE 'ACERVO_LEGADO' END,
  sha256, storage_path, content_type, tamanho_bytes, criptografia_versao, criado_em
FROM public.fiscoai_dfe_artefatos
ON CONFLICT (user_id, empresa_cnpj, documento_id, tipo, sha256) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fiscoai_xml_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid,
  empresa_cnpj text NOT NULL CHECK (empresa_cnpj ~ '^[0-9]{14}$'),
  documento_id uuid,
  item_id uuid,
  operacao text NOT NULL,
  status text NOT NULL CHECK (status IN ('INICIADA', 'SUCESSO', 'SEM_DOCUMENTO', 'BLOQUEADA', 'FALHA', 'INFORMATIVA')),
  codigo_retorno text,
  mensagem text,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  criado_em timestamptz NOT NULL DEFAULT now(),
  finalizado_em timestamptz,
  FOREIGN KEY (user_id, empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id) ON DELETE SET NULL (empresa_id),
  FOREIGN KEY (documento_id, user_id, empresa_cnpj)
    REFERENCES public.fiscoai_dfe_documentos(id, user_id, cnpj) ON DELETE SET NULL (documento_id),
  FOREIGN KEY (item_id) REFERENCES public.fiscoai_xml_itens(id) ON DELETE SET NULL
);

INSERT INTO public.fiscoai_xml_auditoria (
  user_id, empresa_id, empresa_cnpj, documento_id, operacao, status,
  codigo_retorno, mensagem, detalhes, criado_em, finalizado_em
)
SELECT
  tentativa.user_id, empresa.empresa_id, tentativa.cnpj, tentativa.documento_id,
  tentativa.operacao, tentativa.status, tentativa.codigo_retorno,
  tentativa.mensagem, tentativa.detalhes, tentativa.iniciada_em, tentativa.finalizada_em
FROM public.fiscoai_dfe_tentativas tentativa
LEFT JOIN public.fiscoai_empresas empresa
  ON empresa.user_id = tentativa.user_id AND empresa.cnpj = tentativa.cnpj;

INSERT INTO public.fiscoai_xml_auditoria (
  user_id, empresa_id, empresa_cnpj, operacao, status, mensagem, detalhes, criado_em
)
SELECT
  cursor.user_id, empresa.empresa_id, cursor.cnpj, 'MIGRAR_CURSOR_NSU', 'INFORMATIVA',
  'Cursor NSU arquivado durante a remoção do sistema de consulta legado.',
  jsonb_build_object(
    'ult_nsu', cursor.ult_nsu,
    'max_nsu', cursor.max_nsu,
    'ultimo_status', cursor.ultimo_status,
    'consultado_em', cursor.consultado_em
  ),
  now()
FROM public.fiscoai_dfe_cursores cursor
LEFT JOIN public.fiscoai_empresas empresa
  ON empresa.user_id = cursor.user_id AND empresa.cnpj = cursor.cnpj;

INSERT INTO public.fiscoai_xml_auditoria (
  user_id, empresa_id, empresa_cnpj, documento_id, operacao, status, mensagem, detalhes, criado_em, finalizado_em
)
SELECT
  recuperacao.user_id, empresa.empresa_id, recuperacao.cnpj, recuperacao.documento_id,
  'MIGRAR_RECUPERACAO_LEGADA',
  CASE WHEN recuperacao.status = 'RECUPERADA' THEN 'SUCESSO'
       WHEN recuperacao.status = 'NAO_ENCONTRADA' THEN 'SEM_DOCUMENTO'
       WHEN recuperacao.status = 'CANCELADA' THEN 'INFORMATIVA'
       ELSE 'FALHA' END,
  'Registro da fila anterior preservado durante a migração para a API própria.',
  jsonb_build_object(
    'chave_acesso', recuperacao.chave_acesso,
    'provedor', recuperacao.provedor,
    'status', recuperacao.status,
    'tentativas', recuperacao.tentativas,
    'ultimo_erro', recuperacao.ultimo_erro
  ),
  recuperacao.criado_em, recuperacao.atualizado_em
FROM public.fiscoai_dfe_recuperacoes recuperacao
LEFT JOIN public.fiscoai_empresas empresa
  ON empresa.user_id = recuperacao.user_id AND empresa.cnpj = recuperacao.cnpj;

ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_origem_check,
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_processamento_status_check;

-- Preserva os dados de ciência no JSON de origem antes de remover os campos operacionais.
UPDATE public.fiscoai_dfe_documentos
SET metadados_origem = coalesce(metadados_origem, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'legado_nsu', nsu,
      'legado_ciencia_cstat', ciencia_cstat,
      'legado_ciencia_motivo', ciencia_motivo,
      'legado_ciencia_protocolo', ciencia_protocolo,
      'legado_ciencia_enviada_em', ciencia_enviada_em
    )),
    origem = CASE WHEN origem = 'IMPORTACAO_MANUAL' THEN 'IMPORTACAO_MANUAL' ELSE 'ACERVO_LEGADO' END,
    processamento_status = CASE
      WHEN processamento_status IN ('ciencia_pendente', 'ciencia_enviada', 'ciencia_erro') THEN 'descartada'
      ELSE processamento_status
    END;

-- O novo Hub guarda apenas NF-e de entrada com XML completo.
DELETE FROM public.fiscoai_dfe_documentos
WHERE tipo_documento <> 'NFE'
   OR tipo_conteudo <> 'XML_COMPLETO'
   OR schema_xml NOT ILIKE 'procNFe%';

ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_origem_check,
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_processamento_status_check,
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_tipo_conteudo_check,
  ADD CONSTRAINT fiscoai_dfe_documentos_origem_check
    CHECK (origem IN ('API_PROPRIA', 'IMPORTACAO_MANUAL', 'ACERVO_LEGADO')),
  ADD CONSTRAINT fiscoai_dfe_documentos_tipo_conteudo_check
    CHECK (tipo_conteudo = 'XML_COMPLETO'),
  ADD CONSTRAINT fiscoai_dfe_documentos_processamento_status_check
    CHECK (processamento_status IN ('pendente', 'importada', 'interna', 'descartada', 'falha'));

DROP INDEX IF EXISTS public.fiscoai_dfe_ciencia_pendente_idx;
DROP INDEX IF EXISTS public.fiscoai_dfe_documentos_fila_idx;

ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_user_id_cnpj_nsu_sha256_key,
  DROP COLUMN IF EXISTS ciencia_cstat,
  DROP COLUMN IF EXISTS ciencia_motivo,
  DROP COLUMN IF EXISTS ciencia_protocolo,
  DROP COLUMN IF EXISTS ciencia_enviada_em,
  DROP COLUMN IF EXISTS nsu;

ALTER TABLE public.fiscoai_xml_itens
  DROP CONSTRAINT IF EXISTS fiscoai_xml_itens_provedor_check;

UPDATE public.fiscoai_xml_itens
SET provedor = CASE
  WHEN provedor = 'IMPORTACAO_DIRETA' THEN 'IMPORTACAO_DIRETA'
  ELSE 'WORKER_AUTORIZADO'
END;

ALTER TABLE public.fiscoai_xml_itens
  ALTER COLUMN provedor SET DEFAULT 'WORKER_AUTORIZADO',
  ADD CONSTRAINT fiscoai_xml_itens_provedor_check
    CHECK (provedor IN ('WORKER_AUTORIZADO', 'IMPORTACAO_DIRETA', 'ACERVO_LEGADO'));

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
    WHERE item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA')
      AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
      AND item.lock_ate <= now()
      AND item.tentativas < 5
    ORDER BY item.criado_em
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limite, 10), 50))
  )
  UPDATE public.fiscoai_xml_itens item
  SET status = 'CONSULTANDO',
      tentativas = item.tentativas + 1,
      lock_token = p_lock_token,
      lock_ate = now() + interval '15 minutes',
      atualizado_em = now()
  FROM candidatos
  WHERE item.id = candidatos.id
  RETURNING item.*;
END;
$$;

REVOKE ALL ON FUNCTION public.fiscoai_reivindicar_itens_xml(integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscoai_reivindicar_itens_xml(integer, uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.fiscoai_empresa_integracoes (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  empresa_cnpj text NOT NULL,
  tipo text NOT NULL DEFAULT 'RECUPERACAO_XML' CHECK (tipo = 'RECUPERACAO_XML'),
  provedor text NOT NULL DEFAULT 'WORKER_AUTORIZADO',
  status text NOT NULL DEFAULT 'AGUARDANDO_CONFIGURACAO'
    CHECK (status IN ('DESATIVADA', 'AGUARDANDO_CONFIGURACAO', 'ATIVA', 'ERRO')),
  ultima_execucao_em timestamptz,
  ultimo_sucesso_em timestamptz,
  ultimo_erro text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, empresa_id, tipo),
  FOREIGN KEY (user_id, empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, empresa_cnpj)
    REFERENCES public.fiscoai_empresas(user_id, cnpj) ON DELETE CASCADE
);

INSERT INTO public.fiscoai_empresa_integracoes (user_id, empresa_id, empresa_cnpj)
SELECT user_id, empresa_id, cnpj FROM public.fiscoai_empresas
ON CONFLICT (user_id, empresa_id, tipo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fiscoai_empresa_usuarios (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  membro_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  papel text NOT NULL DEFAULT 'PROPRIETARIO'
    CHECK (papel IN ('PROPRIETARIO', 'ADMINISTRADOR', 'FISCAL', 'CONSULTA')),
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, empresa_id, membro_user_id),
  FOREIGN KEY (user_id, empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id) ON DELETE CASCADE
);

INSERT INTO public.fiscoai_empresa_usuarios (user_id, empresa_id, membro_user_id, papel)
SELECT user_id, empresa_id, user_id, 'PROPRIETARIO' FROM public.fiscoai_empresas
ON CONFLICT (user_id, empresa_id, membro_user_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS fiscoai_xml_auditoria_empresa_idx
  ON public.fiscoai_xml_auditoria (user_id, empresa_cnpj, criado_em DESC);
CREATE INDEX IF NOT EXISTS fiscoai_xml_artefatos_documento_idx
  ON public.fiscoai_xml_artefatos (user_id, empresa_cnpj, documento_id, tipo);

ALTER TABLE public.fiscoai_xml_artefatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_artefatos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_auditoria FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_empresa_integracoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_empresa_integracoes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_empresa_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_empresa_usuarios FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.fiscoai_xml_artefatos, public.fiscoai_xml_auditoria,
  public.fiscoai_empresa_integracoes, public.fiscoai_empresa_usuarios FROM anon, authenticated;
GRANT ALL ON public.fiscoai_xml_artefatos, public.fiscoai_xml_auditoria,
  public.fiscoai_empresa_integracoes, public.fiscoai_empresa_usuarios TO service_role;

DROP TABLE IF EXISTS public.fiscoai_dfe_recuperacoes;
DROP TABLE IF EXISTS public.fiscoai_dfe_tentativas;
DROP TABLE IF EXISTS public.fiscoai_dfe_artefatos;
DROP TABLE IF EXISTS public.fiscoai_dfe_cursores;

COMMENT ON TABLE public.fiscoai_xml_itens IS
  'Fila idempotente da API própria. Somente workers autorizados podem reivindicar e concluir itens.';
COMMENT ON TABLE public.fiscoai_xml_auditoria IS
  'Trilha operacional imutável da Central de Documentos e das integrações por empresa.';
