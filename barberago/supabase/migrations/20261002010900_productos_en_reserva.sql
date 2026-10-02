-- Productos en la página de reservas: el cliente agrega productos a su cita y los paga en línea
-- junto con el servicio (los productos se pagan completos; el anticipo solo aplica al servicio).
-- Se entregan en la barbería y salen del inventario cuando se cobra la cita.

alter table public.productos add column en_linea boolean not null default true;
alter table public.productos add column descripcion text check (char_length(descripcion) <= 200);

create table public.cita_productos (
  id uuid primary key default gen_random_uuid(),
  cita_id uuid not null references public.citas (id) on delete cascade,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  producto_id uuid,
  nombre text not null,
  cantidad integer not null check (cantidad between 1 and 20),
  precio_unit numeric(10,2) not null check (precio_unit >= 0),
  foreign key (negocio_id, producto_id) references public.productos (negocio_id, id) on delete set null (producto_id)
);
create index cita_productos_cita_idx on public.cita_productos (cita_id);
create index cita_productos_producto_idx on public.cita_productos (negocio_id, producto_id);
alter table public.cita_productos enable row level security;
-- El equipo las ve; solo se crean desde las funciones del servidor.
create policy cita_productos_leer on public.cita_productos for select using ((select privado.es_miembro(negocio_id)));

-- Existencia que se puede vender en línea: lo que hay menos lo apartado en citas que aún no se cobran.
create function privado.producto_disponible(p_producto uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(p.stock - coalesce((
           select sum(cp.cantidad) from public.cita_productos cp join public.citas c on c.id = cp.cita_id
            where cp.producto_id = p.id and c.estado in ('pendiente', 'confirmada', 'en_espera', 'en_curso')
              and not coalesce(c.pago_estado = 'pendiente' and c.pago_expira < now(), false)), 0), 0)::int
    from public.productos p where p.id = p_producto;
$$;
revoke execute on function privado.producto_disponible(uuid) from public, anon, authenticated;

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
                            from public.barberos b where b.negocio_id = n.id and b.activo and b.en_linea), '[]'),
    -- Los productos solo se venden en línea cuando hay pago en línea.
    'productos', case when privado.tiene_pagos(n.id) and n.pago_en_linea <> 'desactivado' then coalesce((
                   select jsonb_agg(jsonb_build_object('id', x.id, 'nombre', x.nombre, 'descripcion', x.descripcion,
                                                       'precio', x.precio, 'disponible', least(x.disp, 20)) order by x.nombre)
                     from (select p.*, privado.producto_disponible(p.id) as disp from public.productos p
                            where p.negocio_id = n.id and p.activo and p.en_linea and p.precio > 0) x
                    where x.disp > 0), '[]') else '[]' end)
    from public.negocios n
   where n.slug = lower(trim(p_slug)) and n.reserva_online and privado.negocio_vigente(n.id);
$$;

-- Igual que pago_reservar, más los productos (pago_reservar queda por compatibilidad).
create function public.pago_apartar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_notas text default null, p_minutos integer default 20,
  p_productos jsonb default '[]'
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.negocios; pc privado.pago_cuentas; r jsonb; monto numeric; vence timestamptz;
        cita uuid; it jsonb; p public.productos; cant integer; total_prod numeric := 0; lineas jsonb := '[]';
begin
  select * into n from public.negocios where slug = lower(trim(p_slug)) and reserva_online;
  if n is null then raise exception 'Esta barbería no recibe reservas en línea'; end if;
  select * into pc from privado.pago_cuentas where negocio_id = n.id;
  if pc.access_token is null or n.pago_en_linea = 'desactivado' then raise exception 'Esta barbería no recibe pagos en línea'; end if;
  if jsonb_typeof(coalesce(p_productos, '[]')) <> 'array' or jsonb_array_length(coalesce(p_productos, '[]')) > 20 then
    raise exception 'Revisa los productos elegidos';
  end if;

  perform set_config('barberago.con_pago', '1', true);
  r := public.reservar(p_slug, p_servicio, p_barbero, p_inicio, p_nombre, p_telefono, null, p_notas);
  perform set_config('barberago.con_pago', '', true);
  cita := (r->>'id')::uuid;

  for it in select * from jsonb_array_elements(coalesce(p_productos, '[]')) loop
    cant := coalesce((it->>'cantidad')::int, 0);
    continue when cant <= 0;
    select * into p from public.productos
     where id = (it->>'id')::uuid and negocio_id = n.id and activo and en_linea and precio > 0 for update;
    if p.id is null then raise exception 'Uno de los productos ya no está disponible'; end if;
    if cant > 20 or cant > privado.producto_disponible(p.id) then
      raise exception 'Ya no hay suficiente % (quedan %)', p.nombre, privado.producto_disponible(p.id);
    end if;
    insert into public.cita_productos (cita_id, negocio_id, producto_id, nombre, cantidad, precio_unit)
    values (cita, n.id, p.id, p.nombre, cant, p.precio);
    total_prod := total_prod + p.precio * cant;
    lineas := lineas || jsonb_build_object('id', p.id, 'nombre', p.nombre, 'cantidad', cant, 'precio', p.precio);
  end loop;

  monto := round((r->>'precio')::numeric * n.anticipo_pct / 100, 2) + total_prod;
  if monto <= 0 then raise exception 'Este servicio no tiene precio para cobrar en línea'; end if;
  vence := now() + make_interval(mins => greatest(least(coalesce(p_minutos, 20), 60), 5));
  update public.citas set pago_estado = 'pendiente', pago_monto = monto, pago_expira = vence where id = cita;

  return r || jsonb_build_object(
    'monto', monto, 'expira', vence, 'servicio_id', p_servicio, 'productos', lineas,
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'moneda', n.moneda),
    'access_token', pc.access_token);
end $$;
revoke execute on function public.pago_apartar(text, uuid, uuid, timestamptz, text, text, text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.pago_apartar(text, uuid, uuid, timestamptz, text, text, text, integer, jsonb) to service_role;

-- La página de regreso del pago también muestra los productos.
create or replace function public.reserva_estado(p_cita uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id, 'inicio', c.inicio, 'estado', c.estado, 'precio', c.precio, 'pago_monto', c.pago_monto,
    'pago_estado', case when c.pago_estado = 'pendiente' and c.pago_expira < now() then 'expirado' else c.pago_estado end,
    'pago_expira', c.pago_expira,
    'cliente', split_part(coalesce(c.cliente_nombre, ''), ' ', 1),
    'servicio', (select nombre from public.servicios where id = c.servicio_id),
    'barbero', (select nombre from public.barberos where id = c.barbero_id),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('nombre', cp.nombre, 'cantidad', cp.cantidad, 'precio', cp.precio_unit) order by cp.nombre)
                             from public.cita_productos cp where cp.cita_id = c.id), '[]'),
    'negocio', jsonb_build_object('nombre', n.nombre, 'slug', n.slug, 'direccion', n.direccion, 'telefono', n.telefono,
                                  'zona_horaria', n.zona_horaria, 'moneda', n.moneda, 'logo_url', n.logo_url))
    from public.citas c join public.negocios n on n.id = c.negocio_id
   where c.id = p_cita and c.origen = 'en_linea';
$$;
