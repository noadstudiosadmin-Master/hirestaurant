-- Desconectar la cuenta de Mercado Pago: se borra la llave (queda en null) en lugar de borrar la fila.
alter table privado.pago_cuentas alter column access_token drop not null;

create function public.pago_desconectar(p_negocio uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not privado.puede(p_negocio, 'ajustes') then raise exception 'No tienes permiso para cambiar los pagos'; end if;
  update privado.pago_cuentas set access_token = null, cuenta = null, updated_at = now() where negocio_id = p_negocio;
  update public.negocios set pago_cuenta = null, pago_prueba = false, pago_en_linea = 'desactivado' where id = p_negocio;
end $$;

revoke execute on function public.pago_desconectar(uuid) from public, anon, authenticated;
grant execute on function public.pago_desconectar(uuid) to authenticated;

-- Con la llave en null la barbería cuenta como sin cuenta conectada.
create or replace function public.pago_token(p_negocio uuid default null, p_cita uuid default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('negocio_id', pc.negocio_id, 'access_token', pc.access_token)
    from privado.pago_cuentas pc
   where pc.negocio_id = coalesce(p_negocio, (select negocio_id from public.citas where id = p_cita))
     and pc.access_token is not null;
$$;

create or replace function privado.tiene_pagos(n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from privado.pago_cuentas where negocio_id = n and access_token is not null);
$$;
revoke execute on function privado.tiene_pagos(uuid) from public, anon, authenticated;

create or replace function public.reserva_negocio(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'telefono', n.telefono, 'direccion', n.direccion,
                                  'logo_url', n.logo_url, 'zona_horaria', n.zona_horaria, 'moneda', n.moneda, 'horario', n.horario,
                                  -- Solo se ofrece pagar si la barbería ya conectó su cuenta.
                                  'pago_en_linea', case when privado.tiene_pagos(n.id)
                                                        then n.pago_en_linea else 'desactivado' end,
                                  'anticipo_pct', n.anticipo_pct),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion,
                                  'categoria', s.categoria, 'duracion_min', s.duracion_min, 'precio', s.precio) order by s.orden, s.nombre)
                             from public.servicios s where s.negocio_id = n.id and s.activo and s.en_linea), '[]'),
    'barberos', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre, 'foto_url', b.foto_url, 'color', b.color)
                                  order by b.orden, b.nombre)
                            from public.barberos b where b.negocio_id = n.id and b.activo and b.en_linea), '[]'))
    from public.negocios n
   where n.slug = lower(trim(p_slug)) and n.reserva_online and privado.negocio_vigente(n.id);
$$;

create or replace function public.reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_email text default null, p_notas text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.negocios; s public.servicios; tel text; bid uuid; cid uuid; cita uuid;
begin
  select * into n from public.negocios where slug = lower(trim(p_slug)) and reserva_online;
  if n is null or not privado.negocio_vigente(n.id) then raise exception 'Esta barbería no recibe reservas en línea'; end if;
  -- Con pago obligatorio, la reserva solo entra por pago_reservar (la Edge Function de pagos).
  if n.pago_en_linea = 'obligatorio' and coalesce(current_setting('barberago.con_pago', true), '') <> '1'
     and privado.tiene_pagos(n.id) then
    raise exception 'Esta barbería pide pagar al reservar';
  end if;
  select * into s from public.servicios where id = p_servicio and negocio_id = n.id and activo and en_linea;
  if s is null then raise exception 'El servicio no está disponible'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) not between 2 and 80 then raise exception 'Escribe tu nombre'; end if;
  tel := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  if char_length(tel) not between 8 and 15 then raise exception 'Escribe un teléfono válido'; end if;

  select l.barbero_id into bid
    from privado.horarios_libres(n.id, s.id, p_barbero, (p_inicio at time zone n.zona_horaria)::date) l
   where l.inicio = p_inicio
   order by l.barbero_id limit 1;
  if bid is null then raise exception 'Ese horario ya no está disponible, elige otro'; end if;

  select id into cid from public.clientes where negocio_id = n.id and telefono = tel;
  if cid is null then
    insert into public.clientes (negocio_id, nombre, telefono, email)
    values (n.id, trim(p_nombre), tel, nullif(trim(p_email), '')) returning id into cid;
  end if;
  if (select count(*) from public.citas where negocio_id = n.id and cliente_id = cid
        and inicio > now() and estado in ('pendiente', 'confirmada')
        and not (pago_estado = 'pendiente' and pago_expira < now())) >= 3 then
    raise exception 'Ya tienes 3 citas próximas en esta barbería';
  end if;

  begin
    insert into public.citas (negocio_id, cliente_id, cliente_nombre, barbero_id, servicio_id, inicio, fin, estado, origen, precio, notas)
    values (n.id, cid, trim(p_nombre), bid, s.id, p_inicio, p_inicio + make_interval(mins => s.duracion_min),
            'pendiente', 'en_linea', s.precio, nullif(left(trim(p_notas), 300), ''))
    returning id into cita;
  exception when exclusion_violation then
    raise exception 'Ese horario se acaba de ocupar, elige otro';
  end;
  return jsonb_build_object('id', cita, 'inicio', p_inicio, 'fin', p_inicio + make_interval(mins => s.duracion_min),
    'servicio', s.nombre, 'precio', s.precio, 'barbero', (select nombre from public.barberos where id = bid));
end $$;

create or replace function public.pago_reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_notas text default null, p_minutos integer default 20
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.negocios; pc privado.pago_cuentas; r jsonb; monto numeric; vence timestamptz;
begin
  select * into n from public.negocios where slug = lower(trim(p_slug)) and reserva_online;
  if n is null then raise exception 'Esta barbería no recibe reservas en línea'; end if;
  select * into pc from privado.pago_cuentas where negocio_id = n.id;
  if pc.access_token is null or n.pago_en_linea = 'desactivado' then raise exception 'Esta barbería no recibe pagos en línea'; end if;

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
