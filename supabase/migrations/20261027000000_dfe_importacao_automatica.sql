ALTER TABLE public.fiscoai_dfe_documentos
  ADD COLUMN IF NOT EXISTS processamento_status text NOT NULL DEFAULT 'pendente'
    CHECK (processamento_status IN ('pendente', 'importada', 'descartada', 'falha')),
  ADD COLUMN IF NOT EXISTS processamento_erro text,
  ADD COLUMN IF NOT EXISTS numero_nfe text,
  ADD COLUMN IF NOT EXISTS serie_nfe text,
  ADD COLUMN IF NOT EXISTS emitente_nome text,
  ADD COLUMN IF NOT EXISTS emitente_cnpj text,
  ADD COLUMN IF NOT EXISTS uf_origem text,
  ADD COLUMN IF NOT EXISTS uf_destino text,
  ADD COLUMN IF NOT EXISTS data_emissao text,
  ADD COLUMN IF NOT EXISTS valor_total_xml text;

CREATE INDEX IF NOT EXISTS fiscoai_dfe_documentos_fila_idx
  ON public.fiscoai_dfe_documentos (user_id, cnpj, processamento_status, nsu);
