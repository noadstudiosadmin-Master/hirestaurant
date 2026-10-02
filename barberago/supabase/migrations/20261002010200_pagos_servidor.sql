-- ───────────────────────── Funciones del servidor (solo service_role) ─────────────────────────

-- Aparta el horario y devuelve lo necesario para crear el cobro en Mercado Pago.
create function public.pago_reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_notas text default null, p_minutos integer default 20
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.negocios; pc privado.pago_cuentas; r jsonb; monto numeric; vence timestamptz;
begin
  select * into n from public.negocios where slug = lower(trim(p_slug)) and reserva_online;
  if n is null then raise exception 'Esta barbería no recibe reservas en línea'; end if;
  select * into pc from privado.pago_cuentas where negocio_id = n.id;
  if pc is null or n.pago_en_linea = 'desactivado' then raise exception 'Esta barbería no recibe pagos en línea'; end if;

  perform set_config('barberago.con_pago', '1', true);
  r := public.reservar(p_slug, p_servicio, p_barbero, p_inicio, p_nombre, p_telefono, null, p_notas);
  perform set_config('barberago.con_pago', '', true);

  monto := round((r->>'precio')::numeric * n.anticipo_pct / 100, 2);
  if monto <= 0 then raise exception 'Este servicio no tiene precio para cobrar en línea'; end if;
  vence := now() + make_interval(mins => greatest(least(coalesce(p_minutos, 20), 60), 5));
  update public.citas set pago_estado = 'pendiente', pago_monto = monto, pago_expira = vence where id = (r->>'id')::uuid;

  return r || jsonb_build_object(
    'monto', monto, 'expira', vence, 'servicio_id', p_servicio,
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'moneda', n.moneda),
    'access_token', pc.access_token);
end $$;

-- Llave de la cuenta de la barbería (por negocio o por cita).
create function public.pago_token(p_negocio uuid default null, p_cita uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('negocio_id', pc.negocio_id, 'access_token', pc.access_token)
    from privado.pago_cuentas pc
   where pc.negocio_id = coalesce(p_negocio, (select negocio_id from public.citas where id = p_cita));
$$;

-- Registra lo que Mercado Pago dice de un pago. Devuelve 'ok', 'reembolsar' o 'ignorado'.
create function public.pago_registrar(p_cita uuid, p_negocio uuid, p_pago_id text, p_estado text, p_monto numeric)
returns text language plpgsql security definer set search_path = '' as $$
declare c public.citas;
begin
  select * into c from public.citas where id = p_cita and negocio_id = p_negocio for update;
  if c is null or c.pago_estado is null then return 'ignorado'; end if;
  if p_estado <> 'approved' then return 'ok'; end if; -- rechazado: el cliente puede reintentar hasta que venza
  if c.pago_estado in ('pagado', 'reembolsar', 'reembolsado') then
    -- Ya registrado; un segundo pago distinto para la misma cita se devuelve.
    return case when c.pago_id is distinct from p_pago_id and c.pago_estado = 'pagado' then 'reembolsar' else 'ok' end;
  end if;
  if c.pago_estado = 'fallido' or p_monto + 0.01 < c.pago_monto then
    -- Apartado ya cancelado por el cliente, o pagó de menos: se devuelve.
    update public.citas set pago_estado = 'reembolsar', pago_id = p_pago_id where id = c.id;
    return 'reembolsar';
  end if;
  begin
    update public.citas
       set pago_estado = 'pagado', pago_id = p_pago_id, pago_fecha = now(), pago_monto = round(p_monto, 2),
           estado = case when estado in ('pendiente', 'cancelada') then 'confirmada' else estado end
     where id = c.id;
  exception when exclusion_violation then
    -- Pagó tarde y alguien más ya tomó el horario: se devuelve el dinero.
    update public.citas set pago_estado = 'reembolsar', pago_id = p_pago_id where id = c.id;
    return 'reembolsar';
  end;
  return 'ok';
end $$;

create function public.pago_marcar_reembolso(p_cita uuid, p_pago_id text) returns void
language sql security definer set search_path = '' as $$
  update public.citas set pago_estado = 'reembolsado',
         estado = case when estado = 'pendiente' then 'cancelada' else estado end
   where id = p_cita and pago_id = p_pago_id and pago_estado = 'reembolsar';
$$;

-- Si no se pudo crear el cobro, suelta el horario apartado.
create function public.pago_cancelar_apartado(p_cita uuid) returns void
language sql security definer set search_path = '' as $$
  update public.citas set estado = 'cancelada', pago_estado = 'fallido'
   where id = p_cita and pago_estado = 'pendiente';
$$;

create function public.pago_guardar_cuenta(p_negocio uuid, p_token text, p_cuenta text, p_prueba boolean)
returns void language sql security definer set search_path = '' as $$
  insert into privado.pago_cuentas (negocio_id, access_token, cuenta, prueba)
  values (p_negocio, p_token, p_cuenta, p_prueba)
  on conflict (negocio_id) do update
    set access_token = excluded.access_token, cuenta = excluded.cuenta, prueba = excluded.prueba, updated_at = now();
  update public.negocios set pago_cuenta = p_cuenta, pago_prueba = p_prueba,
         pago_en_linea = case when pago_en_linea = 'desactivado' then 'opcional' else pago_en_linea end
   where id = p_negocio;
$$;

-- ───────────────────────── Permisos ─────────────────────────

revoke execute on function public.reserva_estado(uuid), public.pago_reservar(text, uuid, uuid, timestamptz, text, text, text, integer),
  public.pago_token(uuid, uuid), public.pago_registrar(uuid, uuid, text, text, numeric), public.pago_marcar_reembolso(uuid, text),
  public.pago_cancelar_apartado(uuid), public.pago_guardar_cuenta(uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.reserva_estado(uuid) to anon, authenticated;
grant execute on function public.pago_reservar(text, uuid, uuid, timestamptz, text, text, text, integer),
  public.pago_token(uuid, uuid), public.pago_registrar(uuid, uuid, text, text, numeric), public.pago_marcar_reembolso(uuid, text),
  public.pago_cancelar_apartado(uuid), public.pago_guardar_cuenta(uuid, text, text, boolean) to service_role;
