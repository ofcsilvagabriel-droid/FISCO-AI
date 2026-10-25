-- Dados da Distribuição DF-e: somente funções autenticadas do servidor usam a service role.
CREATE TABLE IF NOT EXISTS public.fiscoai_certificados_dfe (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  nome text NOT NULL,
  titular text NOT NULL,
  validade_inicio timestamptz NOT NULL,
  validade_fim timestamptz NOT NULL CHECK (validade_fim > validade_inicio),
  fingerprint_sha256 text NOT NULL,
  segredo_criptografado text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cnpj)
);

CREATE TABLE IF NOT EXISTS public.fiscoai_dfe_cursores (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  ult_nsu text NOT NULL DEFAULT '000000000000000',
  max_nsu text NOT NULL DEFAULT '000000000000000',
  bloqueado_ate timestamptz NOT NULL DEFAULT '1970-01-01',
  lock_ate timestamptz NOT NULL DEFAULT '1970-01-01',
  lock_token uuid,
  ultimo_status text,
  consultado_em timestamptz,
  PRIMARY KEY (user_id, cnpj),
  FOREIGN KEY (user_id, cnpj) REFERENCES public.fiscoai_certificados_dfe(user_id, cnpj) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.fiscoai_dfe_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  nsu text NOT NULL,
  schema_xml text NOT NULL,
  chave_acesso text,
  sha256 text NOT NULL,
  storage_path text NOT NULL,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cnpj, nsu, sha256)
);

ALTER TABLE public.fiscoai_certificados_dfe ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_cursores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_documentos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscoai_certificados_dfe, public.fiscoai_dfe_cursores, public.fiscoai_dfe_documentos FROM anon, authenticated;
GRANT ALL ON public.fiscoai_certificados_dfe, public.fiscoai_dfe_cursores, public.fiscoai_dfe_documentos TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('fiscoai-dfe-xml', 'fiscoai-dfe-xml', false, 11534336)
ON CONFLICT (id) DO NOTHING;
UPDATE storage.buckets SET public = false WHERE id = 'fiscoai-dfe-xml';
-- Sem policies para anon/authenticated: XML bruto só passa por função autenticada do servidor.
