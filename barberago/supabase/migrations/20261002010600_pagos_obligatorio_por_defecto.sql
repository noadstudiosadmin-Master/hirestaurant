-- Al conectar Mercado Pago, la reserva en línea pide pago por defecto (se puede cambiar en Ajustes).
create or replace function public.pago_guardar_cuenta(p_negocio uuid, p_token text, p_cuenta text, p_prueba boolean)
returns void language sql security definer set search_path = '' as $$
  insert into privado.pago_cuentas (negocio_id, access_token, cuenta, prueba)
  values (p_negocio, p_token, p_cuenta, p_prueba)
  on conflict (negocio_id) do update
    set access_token = excluded.access_token, cuenta = excluded.cuenta, prueba = excluded.prueba, updated_at = now();
  update public.negocios set pago_cuenta = p_cuenta, pago_prueba = p_prueba,
         pago_en_linea = case when pago_en_linea = 'desactivado' then 'obligatorio' else pago_en_linea end
   where id = p_negocio;
$$;
