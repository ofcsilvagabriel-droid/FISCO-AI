CREATE TABLE public.memoria_decisoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  empresa_id text NOT NULL,
  ncm text NOT NULL,
  faixa_interestadual text NOT NULL DEFAULT 'NA',
  regime_tributario_aplicado text NOT NULL,
  origem_decisao text NOT NULL DEFAULT 'AUTOMATICO',
  descricao_ultima text,
  parametros jsonb NOT NULL DEFAULT '{}'::jsonb,
  calculo_aplicado jsonb NOT NULL DEFAULT '{}'::jsonb,
  legislacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint text,
  versao integer NOT NULL DEFAULT 1,
  vezes_aplicada integer NOT NULL DEFAULT 0,
  congelado boolean NOT NULL DEFAULT false,
  ativo boolean NOT NULL DEFAULT true,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT memoria_decisoes_unica UNIQUE (user_id, empresa_id, ncm, faixa_interestadual)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memoria_decisoes TO authenticated;
GRANT ALL ON public.memoria_decisoes TO service_role;

ALTER TABLE public.memoria_decisoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios gerenciam sua propria memoria"
ON public.memoria_decisoes FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_memoria_decisoes_lookup ON public.memoria_decisoes (user_id, empresa_id, ncm);

CREATE TABLE public.memoria_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  decisao_id uuid REFERENCES public.memoria_decisoes(id) ON DELETE CASCADE,
  empresa_id text NOT NULL,
  ncm text NOT NULL,
  tipo text NOT NULL,
  descricao text,
  antes jsonb,
  depois jsonb,
  criado_em timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memoria_eventos TO authenticated;
GRANT ALL ON public.memoria_eventos TO service_role;

ALTER TABLE public.memoria_eventos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios gerenciam seus proprios eventos"
ON public.memoria_eventos FOR ALL TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_memoria_eventos_lookup ON public.memoria_eventos (user_id, empresa_id, ncm, criado_em DESC);

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.atualizado_em = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_memoria_decisoes_updated
BEFORE UPDATE ON public.memoria_decisoes
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();