-- Entradas da Central: XML completo ou listas de chaves. PDFs e resumos não são documentos aceitos.
UPDATE public.fiscoai_xml_lotes
SET origem_entrada = 'CHAVES_COLADAS'
WHERE origem_entrada NOT IN ('CHAVES_COLADAS', 'ARQUIVO_CHAVES');

ALTER TABLE public.fiscoai_xml_lotes
  DROP CONSTRAINT IF EXISTS fiscoai_xml_lotes_origem_entrada_check,
  ADD CONSTRAINT fiscoai_xml_lotes_origem_entrada_check
    CHECK (origem_entrada IN ('CHAVES_COLADAS', 'ARQUIVO_CHAVES'));
