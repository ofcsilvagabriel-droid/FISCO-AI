CREATE TABLE IF NOT EXISTS public.fiscoai_dados_fiscais (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo text NOT NULL CHECK (tipo IN ('arquivo', 'historico-importacao')),
  dados jsonb NOT NULL,
  versao bigint NOT NULL DEFAULT 0,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tipo)
);

REVOKE ALL ON public.fiscoai_dados_fiscais FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.fiscoai_dados_fiscais TO authenticated;
ALTER TABLE public.fiscoai_dados_fiscais ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuario le seus dados fiscais"
ON public.fiscoai_dados_fiscais FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = user_id);

CREATE POLICY "Usuario cria seus dados fiscais"
ON public.fiscoai_dados_fiscais FOR INSERT TO authenticated
WITH CHECK ((SELECT auth.uid()) = user_id);

CREATE POLICY "Usuario atualiza seus dados fiscais"
ON public.fiscoai_dados_fiscais FOR UPDATE TO authenticated
USING ((SELECT auth.uid()) = user_id)
WITH CHECK ((SELECT auth.uid()) = user_id);
