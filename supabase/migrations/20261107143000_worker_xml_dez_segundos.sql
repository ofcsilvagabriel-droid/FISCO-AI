-- Reduz a frequência do worker de recuperação de XML de 5 para 10 segundos.
-- O job continua executando somente quando houver item elegível na fila.

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
  '10 seconds',
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
