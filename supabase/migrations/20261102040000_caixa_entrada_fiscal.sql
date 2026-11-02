-- Caixa de Entrada Fiscal multiempresa.
-- Chaves podem entrar sem empresa; o XML completo confirma o destinatário
-- antes de qualquer armazenamento definitivo no acervo fiscal.

ALTER TABLE public.fiscoai_xml_lotes
  ALTER COLUMN empresa_id DROP NOT NULL,
  ALTER COLUMN empresa_cnpj DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS nome_arquivo text,
  ADD COLUMN IF NOT EXISTS metadados_entrada jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.fiscoai_xml_itens
  ALTER COLUMN empresa_id DROP NOT NULL,
  ALTER COLUMN empresa_cnpj DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS destinatario_cnpj_informado text,
  ADD COLUMN IF NOT EXISTS destinatario_nome_informado text,
  ADD COLUMN IF NOT EXISTS emitente_cnpj_informado text,
  ADD COLUMN IF NOT EXISTS emitente_nome_informado text,
  ADD COLUMN IF NOT EXISTS numero_nfe_informado text,
  ADD COLUMN IF NOT EXISTS data_emissao_informada text,
  ADD COLUMN IF NOT EXISTS linha_origem integer,
  ADD COLUMN IF NOT EXISTS identificacao_origem text NOT NULL DEFAULT 'PENDENTE';

ALTER TABLE public.fiscoai_xml_itens
  DROP CONSTRAINT IF EXISTS fiscoai_xml_itens_destinatario_informado_check,
  DROP CONSTRAINT IF EXISTS fiscoai_xml_itens_identificacao_origem_check,
  DROP CONSTRAINT IF EXISTS fiscoai_xml_itens_status_check,
  ADD CONSTRAINT fiscoai_xml_itens_destinatario_informado_check
    CHECK (destinatario_cnpj_informado IS NULL OR destinatario_cnpj_informado ~ '^[0-9]{14}$'),
  ADD CONSTRAINT fiscoai_xml_itens_identificacao_origem_check
    CHECK (identificacao_origem IN ('PENDENTE', 'PLANILHA', 'XML_CONFIRMADO')),
  ADD CONSTRAINT fiscoai_xml_itens_status_check
    CHECK (status IN (
      'NA_FILA', 'CONSULTANDO', 'BAIXADA', 'VALIDANDO_XML', 'ARMAZENADA',
      'IMPORTADA', 'DUPLICADA', 'CHAVE_INVALIDA', 'NAO_ENCONTRADA',
      'XML_INCOMPLETO', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA',
      'AGUARDANDO_EMPRESA', 'FALHA_DEFINITIVA'
    ));

ALTER TABLE public.fiscoai_xml_auditoria
  ALTER COLUMN empresa_cnpj DROP NOT NULL;

CREATE INDEX IF NOT EXISTS fiscoai_xml_itens_caixa_usuario_idx
  ON public.fiscoai_xml_itens (user_id, criado_em DESC);

CREATE INDEX IF NOT EXISTS fiscoai_xml_itens_chave_usuario_idx
  ON public.fiscoai_xml_itens (user_id, chave_acesso);

COMMENT ON TABLE public.fiscoai_xml_lotes IS
  'Lotes da Caixa de Entrada Fiscal. Um lote pode conter NF-e de várias empresas.';

COMMENT ON COLUMN public.fiscoai_xml_itens.empresa_cnpj IS
  'CNPJ confirmado para armazenamento; nulo enquanto o destinatário não foi identificado.';

COMMENT ON COLUMN public.fiscoai_xml_itens.destinatario_cnpj_informado IS
  'CNPJ declarado pela planilha; não substitui a confirmação pelo XML completo.';
