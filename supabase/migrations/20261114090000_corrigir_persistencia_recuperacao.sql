ALTER TABLE public.fiscoai_dfe_documentos
  ADD COLUMN IF NOT EXISTS destinatario_nome text,
  ADD COLUMN IF NOT EXISTS destinatario_cnpj text;

ALTER ROLE authenticated SET statement_timeout = '60s';

NOTIFY pgrst, 'reload schema';
