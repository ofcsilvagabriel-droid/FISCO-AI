-- Estrutura incremental do hub Documentos Fiscais.
-- Mantém fiscoai_dfe_documentos e os caminhos atuais para preservar os registros existentes.
ALTER TABLE public.fiscoai_dfe_documentos
  ALTER COLUMN nsu DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'SEFAZ_DISTRIBUICAO',
  ADD COLUMN IF NOT EXISTS tipo_documento text NOT NULL DEFAULT 'NFE',
  ADD COLUMN IF NOT EXISTS tipo_conteudo text NOT NULL DEFAULT 'XML_COMPLETO',
  ADD COLUMN IF NOT EXISTS competencia text,
  ADD COLUMN IF NOT EXISTS metadados_origem jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS atualizado_em timestamptz NOT NULL DEFAULT now();

UPDATE public.fiscoai_dfe_documentos
SET tipo_conteudo = CASE
  WHEN schema_xml ILIKE 'resNFe%' THEN 'RESUMO'
  WHEN schema_xml ILIKE 'procNFe%' THEN 'XML_COMPLETO'
  ELSE 'EVENTO'
END;

UPDATE public.fiscoai_dfe_documentos
SET competencia = substring(data_emissao FROM 1 FOR 7)
WHERE competencia IS NULL
  AND data_emissao ~ '^[0-9]{4}-(0[1-9]|1[0-2])';

ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_origem_check,
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_tipo_documento_check,
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_tipo_conteudo_check,
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_competencia_check,
  ADD CONSTRAINT fiscoai_dfe_documentos_origem_check
    CHECK (origem IN ('SEFAZ_DISTRIBUICAO', 'FISCALAPI_CHAVE', 'IMPORTACAO_MANUAL')),
  ADD CONSTRAINT fiscoai_dfe_documentos_tipo_documento_check
    CHECK (tipo_documento = 'NFE'),
  ADD CONSTRAINT fiscoai_dfe_documentos_tipo_conteudo_check
    CHECK (tipo_conteudo IN ('RESUMO', 'XML_COMPLETO', 'EVENTO')),
  ADD CONSTRAINT fiscoai_dfe_documentos_competencia_check
    CHECK (competencia IS NULL OR competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT fiscoai_dfe_documentos_identidade_tenant_unique
    UNIQUE (id, user_id, cnpj);

-- Consolida duplicidades legadas antes de tornar a chave idempotente no banco.
-- Prioriza XML completo, registro já importado e o recebimento mais recente.
WITH documentos_repetidos AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY user_id, cnpj, chave_acesso
      ORDER BY
        CASE WHEN schema_xml ILIKE 'procNFe%' THEN 0 ELSE 1 END,
        CASE WHEN processamento_status = 'importada' THEN 0 ELSE 1 END,
        recebido_em DESC,
        id
    ) AS posicao
  FROM public.fiscoai_dfe_documentos
  WHERE chave_acesso IS NOT NULL
)
DELETE FROM public.fiscoai_dfe_documentos documento
USING documentos_repetidos repetido
WHERE documento.id = repetido.id
  AND repetido.posicao > 1;

ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_chave_tenant_unique,
  ADD CONSTRAINT fiscoai_dfe_documentos_chave_tenant_unique
    UNIQUE (user_id, cnpj, chave_acesso);

CREATE INDEX IF NOT EXISTS fiscoai_dfe_documentos_competencia_idx
  ON public.fiscoai_dfe_documentos (user_id, cnpj, competencia, data_emissao DESC);

CREATE INDEX IF NOT EXISTS fiscoai_dfe_documentos_chave_idx
  ON public.fiscoai_dfe_documentos (user_id, cnpj, chave_acesso)
  WHERE chave_acesso IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.fiscoai_dfe_artefatos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  documento_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('XML_ORIGINAL', 'XML_PROCESSADO', 'DANFE_PDF')),
  origem text NOT NULL CHECK (origem IN ('SEFAZ_DISTRIBUICAO', 'FISCALAPI_CHAVE', 'IMPORTACAO_MANUAL', 'GERADO_PELO_FISCOAI')),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_path text NOT NULL,
  content_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes >= 0),
  criptografia_versao text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (documento_id, user_id, cnpj)
    REFERENCES public.fiscoai_dfe_documentos(id, user_id, cnpj) ON DELETE CASCADE,
  UNIQUE (user_id, cnpj, documento_id, tipo, sha256)
);

CREATE INDEX IF NOT EXISTS fiscoai_dfe_artefatos_documento_idx
  ON public.fiscoai_dfe_artefatos (user_id, cnpj, documento_id, tipo);

INSERT INTO public.fiscoai_dfe_artefatos (
  user_id, cnpj, documento_id, tipo, origem, sha256, storage_path,
  content_type, tamanho_bytes, criptografia_versao
)
SELECT
  user_id, cnpj, id, 'XML_ORIGINAL', origem, sha256, storage_path,
  'application/octet-stream', 0, 'AES-256-GCM-v1'
FROM public.fiscoai_dfe_documentos
ON CONFLICT (user_id, cnpj, documento_id, tipo, sha256) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fiscoai_dfe_tentativas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  documento_id uuid,
  origem text NOT NULL CHECK (origem IN ('SEFAZ_DISTRIBUICAO', 'FISCALAPI_CHAVE', 'IMPORTACAO_MANUAL')),
  operacao text NOT NULL CHECK (operacao IN ('BUSCAR_DISTRIBUICAO', 'RECUPERAR_POR_CHAVE', 'IMPORTAR_XML', 'GERAR_DANFE')),
  status text NOT NULL CHECK (status IN ('INICIADA', 'SUCESSO', 'SEM_DOCUMENTO', 'BLOQUEADA', 'FALHA')),
  codigo_retorno text,
  mensagem text,
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  FOREIGN KEY (documento_id, user_id, cnpj)
    REFERENCES public.fiscoai_dfe_documentos(id, user_id, cnpj) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS fiscoai_dfe_tentativas_consulta_idx
  ON public.fiscoai_dfe_tentativas (user_id, cnpj, iniciada_em DESC);

CREATE TABLE IF NOT EXISTS public.fiscoai_dfe_recuperacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  chave_acesso text NOT NULL CHECK (chave_acesso ~ '^[0-9]{44}$'),
  provedor text NOT NULL DEFAULT 'FISCALAPI' CHECK (provedor = 'FISCALAPI'),
  manifestar boolean NOT NULL DEFAULT false CHECK (manifestar = false),
  status text NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'RECUPERADA', 'SOMENTE_RESUMO', 'NAO_AUTORIZADA', 'NAO_ENCONTRADA', 'FORA_PRAZO', 'CHAVE_INVALIDA', 'CANCELADA', 'FALHA')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  lock_ate timestamptz NOT NULL DEFAULT '1970-01-01',
  lock_token uuid,
  proxima_tentativa_em timestamptz,
  ultimo_erro text,
  documento_id uuid,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (documento_id, user_id, cnpj)
    REFERENCES public.fiscoai_dfe_documentos(id, user_id, cnpj) ON DELETE CASCADE,
  UNIQUE (user_id, cnpj, chave_acesso)
);

CREATE INDEX IF NOT EXISTS fiscoai_dfe_recuperacoes_fila_idx
  ON public.fiscoai_dfe_recuperacoes (status, proxima_tentativa_em, criado_em)
  WHERE status IN ('PENDENTE', 'FALHA');

ALTER TABLE public.fiscoai_certificados_dfe FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_cursores FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_documentos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_artefatos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_artefatos FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_tentativas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_tentativas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_recuperacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_recuperacoes FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.fiscoai_dfe_artefatos, public.fiscoai_dfe_tentativas, public.fiscoai_dfe_recuperacoes
  FROM anon, authenticated;
GRANT ALL ON public.fiscoai_dfe_artefatos, public.fiscoai_dfe_tentativas, public.fiscoai_dfe_recuperacoes
  TO service_role;

COMMENT ON COLUMN public.fiscoai_dfe_recuperacoes.manifestar IS
  'Guardrail: a recuperacao por chave nao pode registrar manifestacao fiscal automaticamente.';
