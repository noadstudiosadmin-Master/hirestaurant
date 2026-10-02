-- Las citas sin pago en línea (pago_estado null) no contaban como ocupadas: la condición
-- "apartado vencido" daba null y anulaba el filtro. Se corrige con coalesce.

create or replace function privado.horarios_libres(p_negocio uuid, p_servicio uuid, p_barbero uuid, p_fecha date)
returns table (inicio timestamptz, barbero_id uuid)
language sql stable security definer set search_path = '' as $$
  with n as (select * from public.negocios where id = p_negocio),
  s as (select duracion_min from public.servicios where id = p_servicio and negocio_id = p_negocio and activo),
  b as (select br.id, coalesce(br.horario, n.horario) as horario
          from public.barberos br, n
         where br.negocio_id = p_negocio and br.activo and br.en_linea and (p_barbero is null or br.id = p_barbero)),
  ventanas as (
    select b.id as barbero_id,
           ((p_fecha + (v->>0)::time) at time zone n.zona_horaria) as abre,
           ((p_fecha + (v->>1)::time) at time zone n.zona_horaria) as cierra
      from b, n, jsonb_array_elements(coalesce(b.horario -> (extract(isodow from p_fecha)::int)::text, '[]'::jsonb)) v
  ),
  candidatos as (
    select w.barbero_id, t as inicio, t + make_interval(mins => s.duracion_min) as fin
      from ventanas w, s, n,
           generate_series(w.abre, w.cierra - make_interval(mins => s.duracion_min), make_interval(mins => n.intervalo_min)) t
  )
  select c.inicio, c.barbero_id
    from candidatos c, n
   where c.inicio >= now() + make_interval(mins => n.anticipacion_min)
     and not exists (select 1 from public.citas ci
                      where ci.barbero_id = c.barbero_id and ci.estado in ('pendiente', 'confirmada', 'en_curso')
                        and not coalesce(ci.pago_estado = 'pendiente' and ci.pago_expira < now(), false)
                        and tstzrange(ci.inicio, ci.fin, '[)') && tstzrange(c.inicio, c.fin, '[)'))
     and not exists (select 1 from public.bloqueos bl
                      where bl.negocio_id = p_negocio and (bl.barbero_id is null or bl.barbero_id = c.barbero_id)
                        and tstzrange(bl.inicio, bl.fin, '[)') && tstzrange(c.inicio, c.fin, '[)'))
   order by c.inicio, c.barbero_id;
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
        and not coalesce(pago_estado = 'pendiente' and pago_expira < now(), false)) >= 3 then
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
