-- Pagos en línea: protección de las columnas de pago, apartados que vencen y reservas públicas.

-- Nadie del equipo puede marcar una cita como pagada a mano: solo las funciones del servidor.
create function public.proteger_pago_cita() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') then
    if tg_op = 'INSERT' and (new.pago_estado is not null or new.pago_monto is not null or new.pago_id is not null) then
      raise exception 'El pago en línea solo lo registra Mercado Pago';
    end if;
    if tg_op = 'UPDATE' and (new.pago_estado is distinct from old.pago_estado or new.pago_monto is distinct from old.pago_monto
        or new.pago_id is distinct from old.pago_id or new.pago_expira is distinct from old.pago_expira
        or new.pago_fecha is distinct from old.pago_fecha) then
      raise exception 'El pago en línea solo lo registra Mercado Pago';
    end if;
  end if;
  return new;
end $$;

create trigger proteger_pago before insert or update on public.citas
  for each row execute function public.proteger_pago_cita();

-- Antes de ocupar un horario, cancela los apartados vencidos que lo estorban
-- (si no, la restricción citas_sin_empalme los seguiría contando).
create function public.liberar_apartados_vencidos() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.barbero_id is not null and new.estado in ('pendiente', 'confirmada', 'en_curso') then
    update public.citas set estado = 'cancelada', pago_estado = 'expirado'
     where barbero_id = new.barbero_id and id <> new.id
       and estado = 'pendiente' and pago_estado = 'pendiente' and pago_expira < now()
       and tstzrange(inicio, fin, '[)') && tstzrange(new.inicio, new.fin, '[)');
  end if;
  return new;
end $$;

create trigger liberar_apartados before insert or update of barbero_id, inicio, fin, estado on public.citas
  for each row execute function public.liberar_apartados_vencidos();

revoke execute on function public.proteger_pago_cita(), public.liberar_apartados_vencidos() from public, anon, authenticated;

-- ───────────────────────── Reservas públicas (actualizadas) ─────────────────────────

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
                        and not (ci.pago_estado = 'pendiente' and ci.pago_expira < now())
                        and tstzrange(ci.inicio, ci.fin, '[)') && tstzrange(c.inicio, c.fin, '[)'))
     and not exists (select 1 from public.bloqueos bl
                      where bl.negocio_id = p_negocio and (bl.barbero_id is null or bl.barbero_id = c.barbero_id)
                        and tstzrange(bl.inicio, bl.fin, '[)') && tstzrange(c.inicio, c.fin, '[)'))
   order by c.inicio, c.barbero_id;
$$;

create or replace function public.reserva_negocio(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'telefono', n.telefono, 'direccion', n.direccion,
                                  'logo_url', n.logo_url, 'zona_horaria', n.zona_horaria, 'moneda', n.moneda, 'horario', n.horario,
                                  -- Solo se ofrece pagar si la barbería ya conectó su cuenta.
                                  'pago_en_linea', case when exists (select 1 from privado.pago_cuentas pc where pc.negocio_id = n.id)
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
     and exists (select 1 from privado.pago_cuentas where negocio_id = n.id) then
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

create or replace function public.reserva_cancelar(p_cita uuid, p_telefono text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.citas where id = p_cita and pago_estado = 'pagado') then
    raise exception 'Tu cita ya está pagada. Para cancelarla comunícate con la barbería';
  end if;
  update public.citas c set estado = 'cancelada',
         pago_estado = case when c.pago_estado = 'pendiente' then 'fallido' else c.pago_estado end
    from public.clientes cl
   where c.id = p_cita and cl.id = c.cliente_id and cl.negocio_id = c.negocio_id
     and cl.telefono = regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g')
     and c.estado in ('pendiente', 'confirmada') and c.inicio > now();
  if not found then raise exception 'No encontramos una cita activa con esos datos'; end if;
end $$;

-- Estado de una cita para la página de regreso del pago (el id de la cita funciona como enlace privado).
create function public.reserva_estado(p_cita uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'inicio', c.inicio, 'estado', c.estado, 'precio', c.precio, 'pago_monto', c.pago_monto,
    'pago_estado', case when c.pago_estado = 'pendiente' and c.pago_expira < now() then 'expirado' else c.pago_estado end,
    'pago_expira', c.pago_expira,
    'cliente', split_part(coalesce(c.cliente_nombre, ''), ' ', 1),
    'servicio', (select nombre from public.servicios where id = c.servicio_id),
    'barbero', (select nombre from public.barberos where id = c.barbero_id),
    'negocio', jsonb_build_object('nombre', n.nombre, 'slug', n.slug, 'direccion', n.direccion, 'telefono', n.telefono,
                                  'zona_horaria', n.zona_horaria, 'moneda', n.moneda, 'logo_url', n.logo_url))
    from public.citas c join public.negocios n on n.id = c.negocio_id
   where c.id = p_cita and c.origen = 'en_linea';
$$;
