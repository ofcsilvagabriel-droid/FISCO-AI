-- Worker automático da Caixa de Entrada Fiscal.
-- O token permanece no Vault e a chamada só ocorre quando há item elegível.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'fiscoai_cron_secret') THEN
    PERFORM vault.create_secret(
      encode(gen_random_bytes(32), 'hex'),
      'fiscoai_cron_secret',
      'Token interno do worker automático de XML'
    );
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.fiscoai_validar_token_worker(p_token text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, vault
AS $$
  SELECT coalesce(
    EXISTS (
      SELECT 1
      FROM vault.decrypted_secrets segredo
      WHERE segredo.name = 'fiscoai_cron_secret'
        AND segredo.decrypted_secret = p_token
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.fiscoai_validar_token_worker(text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscoai_validar_token_worker(text)
  TO service_role;

DO $$
DECLARE
  job_id bigint;
BEGIN
  FOR job_id IN
    SELECT jobid FROM cron.job WHERE jobname = 'fiscoai-worker-xml-automatico'
  LOOP
    PERFORM cron.unschedule(job_id);
  END LOOP;
END $$;

SELECT cron.schedule(
  'fiscoai-worker-xml-automatico',
  '* * * * *',
  $job$
    SELECT net.http_get(
      url := 'https://fisco-ai-five.vercel.app/api/xml/cron',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (
          SELECT decrypted_secret
          FROM vault.decrypted_secrets
          WHERE name = 'fiscoai_cron_secret'
        )
      ),
      timeout_milliseconds := 50000
    )
    WHERE EXISTS (
      SELECT 1
      FROM public.fiscoai_xml_itens item
      WHERE item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA')
        AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
        AND item.lock_ate <= now()
        AND item.tentativas < 5
    );
  $job$
);

COMMENT ON FUNCTION public.fiscoai_validar_token_worker(text) IS
  'Valida o token do agendador sem expor o segredo armazenado no Vault.';
