ALTER TABLE public.fiscoai_dados_fiscais
  DROP CONSTRAINT IF EXISTS fiscoai_dados_fiscais_tipo_check;

ALTER TABLE public.fiscoai_dados_fiscais
  ADD CONSTRAINT fiscoai_dados_fiscais_tipo_check
  CHECK (tipo IN ('arquivo', 'historico-importacao', 'memoria-protegida'));
