-- La página de reservas muestra también los horarios ocupados (en rojo, sin poder elegirlos)
-- y los horarios van cada 30 minutos por defecto.

alter table public.negocios alter column intervalo_min set default 30;
update public.negocios set intervalo_min = 30 where intervalo_min <> 30;

-- Todas las horas de inicio posibles del día según el horario, sin descontar citas ni bloqueos.
create function privado.horarios_todos(p_negocio uuid, p_servicio uuid, p_barbero uuid, p_fecha date)
returns table (inicio timestamptz)
language sql stable security definer set search_path = '' as $$
  with n as (select * from public.negocios where id = p_negocio),
  s as (select duracion_min from public.servicios where id = p_servicio and negocio_id = p_negocio and activo),
  b as (select br.id, coalesce(br.horario, n.horario) as horario
          from public.barberos br, n
         where br.negocio_id = p_negocio and br.activo and br.en_linea and (p_barbero is null or br.id = p_barbero)),
  ventanas as (
    select ((p_fecha + (v->>0)::time) at time zone n.zona_horaria) as abre,
           ((p_fecha + (v->>1)::time) at time zone n.zona_horaria) as cierra
      from b, n, jsonb_array_elements(coalesce(b.horario -> (extract(isodow from p_fecha)::int)::text, '[]'::jsonb)) v
  )
  select distinct t
    from ventanas w, s, n,
         generate_series(w.abre, w.cierra - make_interval(mins => s.duracion_min), make_interval(mins => n.intervalo_min)) t
   where t >= now() + make_interval(mins => n.anticipacion_min);
$$;
revoke execute on function privado.horarios_todos(uuid, uuid, uuid, date) from public, anon, authenticated;

-- Ahora devuelve cada hora con "libre": true/false (las ocupadas traen barbero_id null).
create or replace function public.reserva_horarios(p_slug text, p_servicio uuid, p_barbero uuid, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare nid uuid;
begin
  select id into nid from public.negocios where slug = lower(trim(p_slug)) and reserva_online and privado.negocio_vigente(id);
  if nid is null then raise exception 'Esta barbería no recibe reservas en línea'; end if;
  if p_fecha < current_date - 1 or p_fecha > current_date + 60 then return '[]'::jsonb; end if;
  return coalesce((
    with libres as (
      select distinct on (l.inicio) l.inicio, l.barbero_id
        from privado.horarios_libres(nid, p_servicio, p_barbero, p_fecha) l
       order by l.inicio, l.barbero_id
    )
    select jsonb_agg(jsonb_build_object('inicio', t.inicio, 'barbero_id', l.barbero_id, 'libre', l.inicio is not null)
                     order by t.inicio)
      from privado.horarios_todos(nid, p_servicio, p_barbero, p_fecha) t
      left join libres l on l.inicio = t.inicio), '[]'::jsonb);
end $$;
