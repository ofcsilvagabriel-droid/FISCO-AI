-- Reprocessa todas as NF-e rejeitadas exclusivamente pela regra legada
-- que aceitava apenas a empresa como destinatária. Não restringe por chave,
-- CNPJ, período ou usuário.
UPDATE public.fiscoai_xml_itens
SET status = 'NA_FILA',
    tentativas = 0,
    lock_token = NULL,
    lock_ate = '1970-01-01T00:00:00.000Z',
    proxima_tentativa_em = now(),
    ultimo_codigo = 'REPROCESSAMENTO_REGRA_PARTICIPANTE',
    ultimo_erro = NULL,
    atualizado_em = now()
WHERE ultimo_codigo = 'XML_REJEITADO'
  AND ultimo_erro = 'A NF-e não é uma entrada modelo 55 vinculada à empresa informada.';
