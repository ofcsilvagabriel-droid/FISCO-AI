ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_processamento_status_check;

ALTER TABLE public.fiscoai_dfe_documentos
  ADD CONSTRAINT fiscoai_dfe_documentos_processamento_status_check
  CHECK (processamento_status IN ('pendente', 'importada', 'interna', 'descartada', 'falha'));

DROP TABLE IF EXISTS public.fiscoai_obrigacoes_icms;
