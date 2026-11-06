-- Acelera a recuperação da fila e reativa automaticamente documentos
-- cujo destinatário foi cadastrado depois de o XML ser localizado.

CREATE OR REPLACE FUNCTION public.fiscoai_reativar_itens_xml_ao_cadastrar_empresa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.fiscoai_xml_itens item
  SET empresa_id = NEW.empresa_id,
      empresa_cnpj = NEW.cnpj,
      status = 'NA_FILA',
      proxima_tentativa_em = now(),
      lock_token = NULL,
      lock_ate = '1970-01-01'::timestamptz,
      ultimo_codigo = 'EMPRESA_CADASTRADA',
      ultimo_erro = NULL,
      atualizado_em = now()
  WHERE item.user_id = NEW.user_id
    AND item.destinatario_cnpj_informado = NEW.cnpj
    AND item.status = 'AGUARDANDO_EMPRESA';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fiscoai_reativar_itens_xml_empresa_trigger
  ON public.fiscoai_empresas;

CREATE TRIGGER fiscoai_reativar_itens_xml_empresa_trigger
AFTER INSERT OR UPDATE OF cnpj ON public.fiscoai_empresas
FOR EACH ROW
EXECUTE FUNCTION public.fiscoai_reativar_itens_xml_ao_cadastrar_empresa();

REVOKE ALL ON FUNCTION public.fiscoai_reativar_itens_xml_ao_cadastrar_empresa()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscoai_reativar_itens_xml_ao_cadastrar_empresa()
  TO service_role;

-- Recupera imediatamente os itens que já estavam aguardando uma empresa agora cadastrada.
UPDATE public.fiscoai_xml_itens item
SET empresa_id = empresa.empresa_id,
    empresa_cnpj = empresa.cnpj,
    status = 'NA_FILA',
    proxima_tentativa_em = now(),
    lock_token = NULL,
    lock_ate = '1970-01-01'::timestamptz,
    ultimo_codigo = 'EMPRESA_CADASTRADA',
    ultimo_erro = NULL,
    atualizado_em = now()
FROM public.fiscoai_empresas empresa
WHERE item.user_id = empresa.user_id
  AND item.destinatario_cnpj_informado = empresa.cnpj
  AND item.status = 'AGUARDANDO_EMPRESA';

DO $$
DECLARE
  job_id bigint;
BEGIN
  FOR job_id IN SELECT jobid FROM cron.job WHERE jobname = 'fiscoai-worker-xml-automatico'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;
END $$;

SELECT cron.schedule(
  'fiscoai-worker-xml-automatico',
  '5 seconds',
  $job$
    SELECT net.http_get(
      url := 'https://fisco-ai-five.vercel.app/api/xml/cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret FROM vault.decrypted_secrets
          WHERE name = 'fiscoai_cron_secret'
        )
      ),
      timeout_milliseconds := 12000
    )
    WHERE EXISTS (
      SELECT 1
      FROM public.fiscoai_xml_itens item
      WHERE item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA', 'FALHA_DEFINITIVA')
        AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
        AND item.lock_ate <= now()
    );
  $job$
);
