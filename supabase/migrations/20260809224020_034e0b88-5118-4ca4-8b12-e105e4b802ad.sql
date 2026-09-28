CREATE TABLE public.st_decisoes_validadas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ncm_prefixo text NOT NULL,
  assinatura_descricao text NOT NULL,
  status_confirmado text NOT NULL CHECK (status_confirmado IN ('ST_CONFIRMADA','NAO_ENQUADRADO')),
  regra_id text,
  validado_em timestamptz NOT NULL DEFAULT now(),
  observacao text
);

CREATE INDEX idx_st_decisoes_ncm ON public.st_decisoes_validadas (ncm_prefixo);
CREATE INDEX idx_st_decisoes_assinatura ON public.st_decisoes_validadas (assinatura_descricao);

GRANT SELECT ON public.st_decisoes_validadas TO anon;
GRANT SELECT ON public.st_decisoes_validadas TO authenticated;
GRANT ALL ON public.st_decisoes_validadas TO service_role;

ALTER TABLE public.st_decisoes_validadas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Decisoes validadas sao legiveis" ON public.st_decisoes_validadas
FOR SELECT TO anon, authenticated USING (true);