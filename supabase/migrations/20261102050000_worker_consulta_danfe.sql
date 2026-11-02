-- Reivindica somente itens do usuário autenticado que acionou o worker manual.
-- A versão global permanece exclusiva do service_role para a execução agendada.

CREATE OR REPLACE FUNCTION public.fiscoai_reivindicar_itens_xml_usuario(
  p_limite integer,
  p_lock_token uuid,
  p_user_id uuid
)
RETURNS SETOF public.fiscoai_xml_itens
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH candidatos AS (
    SELECT item.id
    FROM public.fiscoai_xml_itens item
    WHERE item.user_id = p_user_id
      AND item.status IN ('NA_FILA', 'PROVEDOR_INDISPONIVEL', 'BLOQUEADA')
      AND coalesce(item.proxima_tentativa_em, '1970-01-01'::timestamptz) <= now()
      AND item.lock_ate <= now()
      AND item.tentativas < 5
    ORDER BY item.criado_em
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limite, 5), 10))
  )
  UPDATE public.fiscoai_xml_itens item
  SET status = 'CONSULTANDO',
      tentativas = item.tentativas + 1,
      lock_token = p_lock_token,
      lock_ate = now() + interval '15 minutes',
      atualizado_em = now()
  FROM candidatos
  WHERE item.id = candidatos.id
  RETURNING item.*;
END;
$$;

REVOKE ALL ON FUNCTION public.fiscoai_reivindicar_itens_xml_usuario(integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fiscoai_reivindicar_itens_xml_usuario(integer, uuid, uuid)
  TO service_role;
