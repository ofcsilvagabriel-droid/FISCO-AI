ALTER TABLE public.fiscoai_dfe_documentos
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_documentos_processamento_status_check;

ALTER TABLE public.fiscoai_dfe_documentos
  ADD CONSTRAINT fiscoai_dfe_documentos_processamento_status_check
  CHECK (processamento_status IN ('pendente', 'importada', 'interna', 'descartada', 'falha', 'ciencia_pendente', 'ciencia_enviada', 'ciencia_erro')),
  ADD COLUMN IF NOT EXISTS ciencia_cstat text,
  ADD COLUMN IF NOT EXISTS ciencia_motivo text,
  ADD COLUMN IF NOT EXISTS ciencia_protocolo text,
  ADD COLUMN IF NOT EXISTS ciencia_enviada_em timestamptz;

CREATE INDEX IF NOT EXISTS fiscoai_dfe_ciencia_pendente_idx
  ON public.fiscoai_dfe_documentos (user_id, cnpj, processamento_status, recebido_em)
  WHERE processamento_status IN ('ciencia_pendente', 'ciencia_erro');
