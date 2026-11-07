ALTER TABLE public.fiscoai_dfe_documentos
  ADD COLUMN IF NOT EXISTS provedor_preferido text,
  ADD COLUMN IF NOT EXISTS provedores_consultados jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS assinatura_status text,
  ADD COLUMN IF NOT EXISTS situacao_fiscal text NOT NULL DEFAULT 'DESCONHECIDA',
  ADD COLUMN IF NOT EXISTS papel_empresa text,
  ADD COLUMN IF NOT EXISTS consultado_em timestamptz,
  ADD COLUMN IF NOT EXISTS eventos_atualizados_em timestamptz;

CREATE TABLE IF NOT EXISTS public.fiscoai_dfe_consultas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.fiscoai_xml_itens(id) ON DELETE SET NULL,
  chave_acesso text NOT NULL CHECK (chave_acesso ~ '^[0-9]{44}$'),
  provedor text NOT NULL CHECK (provedor IN ('CONSULTA_DANFE', 'NFE_IO')),
  iniciado_em timestamptz NOT NULL,
  finalizado_em timestamptz NOT NULL DEFAULT now(),
  duracao_ms integer NOT NULL DEFAULT 0 CHECK (duracao_ms >= 0),
  http_status integer,
  codigo_retorno text,
  sucesso boolean NOT NULL DEFAULT false,
  custo_estimado numeric(14,6),
  hash_retorno text CHECK (hash_retorno IS NULL OR hash_retorno ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS fiscoai_dfe_consultas_usuario_chave_idx
  ON public.fiscoai_dfe_consultas (user_id, chave_acesso, iniciado_em DESC);

ALTER TABLE public.fiscoai_dfe_consultas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fiscoai_dfe_consultas FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.fiscoai_dfe_consultas FROM anon, authenticated;
GRANT ALL ON public.fiscoai_dfe_consultas TO service_role;
