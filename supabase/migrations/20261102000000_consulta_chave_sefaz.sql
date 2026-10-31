ALTER TABLE public.fiscoai_dfe_tentativas
  DROP CONSTRAINT IF EXISTS fiscoai_dfe_tentativas_operacao_check;

ALTER TABLE public.fiscoai_dfe_tentativas
  ADD CONSTRAINT fiscoai_dfe_tentativas_operacao_check
  CHECK (operacao IN (
    'BUSCAR_DISTRIBUICAO',
    'CONSULTAR_POR_CHAVE',
    'RECUPERAR_POR_CHAVE',
    'IMPORTAR_XML',
    'GERAR_DANFE'
  ));

CREATE INDEX IF NOT EXISTS fiscoai_dfe_consulta_chave_limite_idx
  ON public.fiscoai_dfe_tentativas (user_id, cnpj, iniciada_em DESC)
  WHERE operacao = 'CONSULTAR_POR_CHAVE';

COMMENT ON INDEX public.fiscoai_dfe_consulta_chave_limite_idx IS
  'Controle preventivo do limite oficial de consultas consChNFe por CNPJ e hora.';
