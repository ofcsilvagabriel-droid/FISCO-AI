-- Fundação da API própria de recuperação por chave e evolução cadastral ERP.
-- A Distribuição DF-e anterior é desativada na aplicação, mas seus documentos
-- e registros de auditoria são preservados.

ALTER TABLE public.fiscoai_empresas
  ADD COLUMN IF NOT EXISTS empresa_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS situacao text NOT NULL DEFAULT 'ATIVA',
  ADD COLUMN IF NOT EXISTS tipo_estabelecimento text NOT NULL DEFAULT 'MATRIZ',
  ADD COLUMN IF NOT EXISTS cnae_principal text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS telefone text,
  ADD COLUMN IF NOT EXISTS cep text,
  ADD COLUMN IF NOT EXISTS municipio text,
  ADD COLUMN IF NOT EXISTS bairro text,
  ADD COLUMN IF NOT EXISTS logradouro text,
  ADD COLUMN IF NOT EXISTS numero text,
  ADD COLUMN IF NOT EXISTS complemento text;

ALTER TABLE public.fiscoai_empresas
  DROP CONSTRAINT IF EXISTS fiscoai_empresas_situacao_check,
  DROP CONSTRAINT IF EXISTS fiscoai_empresas_tipo_estabelecimento_check,
  ADD CONSTRAINT fiscoai_empresas_situacao_check
    CHECK (situacao IN ('ATIVA', 'INATIVA', 'SUSPENSA', 'BAIXADA')),
  ADD CONSTRAINT fiscoai_empresas_tipo_estabelecimento_check
    CHECK (tipo_estabelecimento IN ('MATRIZ', 'FILIAL')),
  ADD CONSTRAINT fiscoai_empresas_empresa_id_unique UNIQUE (empresa_id),
  ADD CONSTRAINT fiscoai_empresas_owner_empresa_id_unique UNIQUE (user_id, empresa_id);

CREATE TABLE IF NOT EXISTS public.fiscoai_xml_lotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  empresa_cnpj text NOT NULL,
  origem_entrada text NOT NULL DEFAULT 'CHAVES_COLADAS'
    CHECK (origem_entrada IN ('CHAVES_COLADAS', 'ARQUIVO_CHAVES', 'DANFE_PDF', 'DANFE_IMAGEM', 'RESUMO_LEGADO')),
  status text NOT NULL DEFAULT 'PENDENTE'
    CHECK (status IN ('PENDENTE', 'PROCESSANDO', 'CONCLUIDO', 'CONCLUIDO_COM_FALHAS', 'CANCELADO')),
  total_itens integer NOT NULL DEFAULT 0 CHECK (total_itens >= 0),
  total_recuperados integer NOT NULL DEFAULT 0 CHECK (total_recuperados >= 0),
  total_falhas integer NOT NULL DEFAULT 0 CHECK (total_falhas >= 0),
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, empresa_cnpj)
    REFERENCES public.fiscoai_empresas(user_id, cnpj) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.fiscoai_xml_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lote_id uuid NOT NULL REFERENCES public.fiscoai_xml_lotes(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  empresa_id uuid NOT NULL,
  empresa_cnpj text NOT NULL,
  chave_acesso text NOT NULL CHECK (chave_acesso ~ '^[0-9]{44}$'),
  provedor text NOT NULL DEFAULT 'CONSULTADANFE_ROBO'
    CHECK (provedor IN ('CONSULTADANFE_ROBO', 'IMPORTACAO_DIRETA')),
  status text NOT NULL DEFAULT 'NA_FILA'
    CHECK (status IN ('NA_FILA', 'CONSULTANDO', 'BAIXADA', 'VALIDANDO_XML', 'ARMAZENADA', 'IMPORTADA', 'DUPLICADA', 'CHAVE_INVALIDA', 'NAO_ENCONTRADA', 'XML_INCOMPLETO', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA', 'FALHA_DEFINITIVA')),
  tentativas integer NOT NULL DEFAULT 0 CHECK (tentativas >= 0),
  proxima_tentativa_em timestamptz,
  lock_ate timestamptz NOT NULL DEFAULT '1970-01-01',
  lock_token uuid,
  documento_id uuid,
  ultimo_codigo text,
  ultimo_erro text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id, empresa_id)
    REFERENCES public.fiscoai_empresas(user_id, empresa_id) ON DELETE CASCADE,
  FOREIGN KEY (user_id, empresa_cnpj)
    REFERENCES public.fiscoai_empresas(user_id, cnpj) ON DELETE CASCADE,
  FOREIGN KEY (documento_id, user_id, empresa_cnpj)
    REFERENCES public.fiscoai_dfe_documentos(id, user_id, cnpj) ON DELETE SET NULL (documento_id),
  UNIQUE (user_id, empresa_id, chave_acesso)
);

CREATE INDEX IF NOT EXISTS fiscoai_xml_lotes_empresa_idx
  ON public.fiscoai_xml_lotes (user_id, empresa_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS fiscoai_xml_itens_fila_idx
  ON public.fiscoai_xml_itens (status, proxima_tentativa_em, criado_em)
  WHERE status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA');

CREATE INDEX IF NOT EXISTS fiscoai_xml_itens_empresa_idx
  ON public.fiscoai_xml_itens (user_id, empresa_id, criado_em DESC);

ALTER TABLE public.fiscoai_xml_lotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_lotes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_itens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_xml_itens FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.fiscoai_xml_lotes, public.fiscoai_xml_itens FROM anon, authenticated;
GRANT ALL ON public.fiscoai_xml_lotes, public.fiscoai_xml_itens TO service_role;

COMMENT ON TABLE public.fiscoai_xml_itens IS
  'Fila idempotente da API própria. O provedor externo é substituível e não pode inserir XML sem validação fiscal.';
