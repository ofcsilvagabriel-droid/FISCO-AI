CREATE TABLE IF NOT EXISTS public.fiscoai_empresas (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cnpj text NOT NULL CHECK (cnpj ~ '^[0-9]{14}$'),
  razao_social text NOT NULL,
  nome_fantasia text,
  uf text,
  inscricao_estadual text,
  regime text CHECK (regime IS NULL OR regime IN ('SN', 'LP', 'LR', 'MEI', 'OUTRO')),
  ativa boolean NOT NULL DEFAULT true,
  busca_xml_automatica boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, cnpj)
);

INSERT INTO public.fiscoai_empresas (user_id, cnpj, razao_social)
SELECT user_id, cnpj, COALESCE(NULLIF(nome, ''), cnpj)
FROM public.fiscoai_certificados_dfe
ON CONFLICT (user_id, cnpj) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.fiscoai_acessos_sefaz (
  user_id uuid NOT NULL,
  empresa_cnpj text NOT NULL,
  sistema text NOT NULL DEFAULT 'Portal SEFAZ',
  endereco_portal text,
  segredo_criptografado text NOT NULL,
  observacoes text,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, empresa_cnpj),
  FOREIGN KEY (user_id, empresa_cnpj) REFERENCES public.fiscoai_empresas(user_id, cnpj) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.fiscoai_obrigacoes_icms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  empresa_cnpj text NOT NULL,
  competencia text NOT NULL CHECK (competencia ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  tipo text NOT NULL CHECK (tipo IN ('ANTECIPACAO_PARCIAL', 'ANTECIPACAO_TRIBUTARIA', 'DIFAL')),
  status text NOT NULL DEFAULT 'PENDENTE' CHECK (status IN ('PENDENTE', 'ENVIADO', 'SEM_MOVIMENTO', 'NA_PASTA')),
  vencimento date,
  valor_guia numeric(14,2) CHECK (valor_guia IS NULL OR valor_guia >= 0),
  data_envio date,
  observacoes text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, empresa_cnpj, competencia, tipo),
  FOREIGN KEY (user_id, empresa_cnpj) REFERENCES public.fiscoai_empresas(user_id, cnpj) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS fiscoai_empresas_owner_idx ON public.fiscoai_empresas (user_id, ativa, razao_social);
CREATE INDEX IF NOT EXISTS fiscoai_obrigacoes_competencia_idx ON public.fiscoai_obrigacoes_icms (user_id, competencia, status, vencimento);

ALTER TABLE public.fiscoai_empresas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_acessos_sefaz ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_obrigacoes_icms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_empresas FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_acessos_sefaz FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_obrigacoes_icms FORCE ROW LEVEL SECURITY;

REVOKE ALL ON public.fiscoai_empresas, public.fiscoai_acessos_sefaz, public.fiscoai_obrigacoes_icms FROM anon, authenticated;
GRANT ALL ON public.fiscoai_empresas, public.fiscoai_acessos_sefaz, public.fiscoai_obrigacoes_icms TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

