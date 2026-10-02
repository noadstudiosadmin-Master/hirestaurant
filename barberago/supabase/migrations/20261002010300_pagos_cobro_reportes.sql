-- ───────────────────────── Cobro y reportes (con anticipo en línea) ─────────────────────────

create or replace function public.cobrar(
  p_negocio uuid, p_items jsonb, p_metodo text,
  p_propina numeric default 0, p_descuento numeric default 0,
  p_cliente uuid default null, p_barbero uuid default null, p_cita uuid default null, p_notas text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; vid uuid; nfolio int; sub numeric := 0; factor numeric; tot numeric; anticipo numeric := 0;
  v_tipo text; v_id uuid; v_cant int; v_precio numeric; v_nombre text; v_barb uuid; v_pct numeric;
begin
  if not privado.puede(p_negocio, 'cobrar') then raise exception 'No tienes permiso para cobrar'; end if;
  if p_metodo not in ('efectivo', 'tarjeta', 'transferencia') then raise exception 'Método de pago no válido'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'Agrega al menos un servicio o producto'; end if;
  if coalesce(p_propina, 0) < 0 or coalesce(p_descuento, 0) < 0 then raise exception 'Montos no válidos'; end if;
  if p_barbero is not null and not exists (select 1 from public.barberos where id = p_barbero and negocio_id = p_negocio) then
    raise exception 'Barbero no válido';
  end if;
  if p_cita is not null and not exists (select 1 from public.citas where id = p_cita and negocio_id = p_negocio) then
    raise exception 'Cita no válida';
  end if;
  if p_cita is not null then
    select coalesce(pago_monto, 0) into anticipo from public.citas
     where id = p_cita and pago_estado = 'pagado'
       and not exists (select 1 from public.ventas where cita_id = p_cita and estado = 'pagada' and pagado_en_linea > 0);
    anticipo := coalesce(anticipo, 0);
  end if;

  update public.negocios set ultimo_folio = ultimo_folio + 1 where id = p_negocio returning ultimo_folio into nfolio;
  insert into public.ventas (negocio_id, folio, cliente_id, barbero_id, cita_id, subtotal, descuento, propina, total, metodo_pago, notas, usuario)
  values (p_negocio, nfolio, p_cliente, p_barbero, p_cita, 0, 0, 0, 0, p_metodo, nullif(trim(p_notas), ''), auth.uid())
  returning id into vid;

  for it in select * from jsonb_array_elements(p_items) loop
    v_tipo := it->>'tipo';
    v_id := (it->>'id')::uuid;
    v_cant := greatest(coalesce((it->>'cantidad')::int, 1), 1);
    v_barb := coalesce(nullif(it->>'barbero_id', '')::uuid, p_barbero);
    if v_tipo = 'servicio' then
      select nombre, precio into v_nombre, v_precio from public.servicios where id = v_id and negocio_id = p_negocio;
    elsif v_tipo = 'producto' then
      select nombre, precio into v_nombre, v_precio from public.productos where id = v_id and negocio_id = p_negocio;
      update public.productos set stock = stock - v_cant where id = v_id and negocio_id = p_negocio;
    else
      raise exception 'Tipo de partida no válido';
    end if;
    if v_nombre is null then raise exception 'Un servicio o producto ya no existe'; end if;
    if it ? 'precio' and it->>'precio' is not null then v_precio := (it->>'precio')::numeric; end if;
    if v_precio < 0 then raise exception 'Precio no válido'; end if;
    select case when v_tipo = 'servicio' then comision_servicios else comision_productos end into v_pct
      from public.barberos where id = v_barb and negocio_id = p_negocio;
    insert into public.venta_items (venta_id, negocio_id, tipo, servicio_id, producto_id, barbero_id, nombre, cantidad, precio_unit, importe, comision)
    values (vid, p_negocio, v_tipo,
            case when v_tipo = 'servicio' then v_id end, case when v_tipo = 'producto' then v_id end,
            v_barb, v_nombre, v_cant, v_precio, round(v_precio * v_cant, 2), round(v_precio * v_cant * coalesce(v_pct, 0) / 100, 2));
    sub := sub + v_precio * v_cant;
    v_nombre := null;
  end loop;

  if coalesce(p_descuento, 0) > sub then raise exception 'El descuento no puede ser mayor al subtotal'; end if;
  -- La comisión se calcula sobre el importe ya con descuento.
  factor := case when sub > 0 then (sub - coalesce(p_descuento, 0)) / sub else 1 end;
  if factor < 1 then
    update public.venta_items set comision = round(comision * factor, 2) where venta_id = vid;
  end if;
  tot := sub - coalesce(p_descuento, 0) + coalesce(p_propina, 0);
  anticipo := least(anticipo, tot);
  update public.ventas set subtotal = round(sub, 2), descuento = round(coalesce(p_descuento, 0), 2),
    propina = round(coalesce(p_propina, 0), 2), total = round(tot, 2), pagado_en_linea = round(anticipo, 2) where id = vid;
  if p_cita is not null then
    update public.citas set estado = 'completada' where id = p_cita and negocio_id = p_negocio;
  end if;
  return jsonb_build_object('id', vid, 'folio', nfolio, 'total', round(tot, 2), 'pagado_en_linea', round(anticipo, 2));
end $$;

create or replace function public.reporte(p_negocio uuid, p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare tz text; r jsonb;
begin
  if not (privado.puede(p_negocio, 'reportes') or privado.puede(p_negocio, 'caja')) then
    raise exception 'No tienes permiso para ver reportes';
  end if;
  select zona_horaria into tz from public.negocios where id = p_negocio;
  with v as (
    select * from public.ventas
     where negocio_id = p_negocio and estado = 'pagada'
       and fecha >= (p_desde::timestamp at time zone tz) and fecha < ((p_hasta + 1)::timestamp at time zone tz)
  ), i as (
    select it.* from public.venta_items it join v on v.id = it.venta_id
  )
  select jsonb_build_object(
    'ventas', (select count(*) from v),
    'total', coalesce((select sum(total) from v), 0),
    'propinas', coalesce((select sum(propina) from v), 0),
    'descuentos', coalesce((select sum(descuento) from v), 0),
    'servicios', coalesce((select sum(importe) from i where tipo = 'servicio'), 0),
    'productos', coalesce((select sum(importe) from i where tipo = 'producto'), 0),
    'ticket_promedio', coalesce((select round(avg(total), 2) from v), 0),
    -- Lo pagado en línea al reservar va aparte; el método de la venta cubre solo el resto.
    'por_metodo', coalesce((select jsonb_object_agg(k, t) from (
                      select metodo_pago k, sum(total - pagado_en_linea) t from v group by 1
                      union all
                      select 'en_linea', sum(pagado_en_linea) from v having sum(pagado_en_linea) > 0) x), '{}'),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', d, 'total', t) order by d)
                           from (select (fecha at time zone tz)::date d, sum(total) t from v group by 1) x), '[]'),
    'por_barbero', coalesce((select jsonb_agg(jsonb_build_object(
                        'barbero_id', b.id, 'nombre', b.nombre,
                        'servicios', coalesce(x.serv, 0), 'productos', coalesce(x.prod, 0),
                        'comision', coalesce(x.com, 0), 'propinas', coalesce(pr.prop, 0), 'atenciones', coalesce(x.aten, 0))
                        order by coalesce(x.serv, 0) + coalesce(x.prod, 0) desc)
                      from public.barberos b
                      left join (select barbero_id,
                                        sum(importe) filter (where tipo = 'servicio') serv,
                                        sum(importe) filter (where tipo = 'producto') prod,
                                        sum(comision) com,
                                        sum(cantidad) filter (where tipo = 'servicio') aten
                                   from i group by 1) x on x.barbero_id = b.id
                      left join (select barbero_id, sum(propina) prop from v group by 1) pr on pr.barbero_id = b.id
                      where b.negocio_id = p_negocio and (b.activo or x.barbero_id is not null)), '[]'),
    'top_servicios', coalesce((select jsonb_agg(jsonb_build_object('nombre', nombre, 'cantidad', c, 'importe', t) order by t desc)
                      from (select nombre, sum(cantidad) c, sum(importe) t from i where tipo = 'servicio' group by 1 order by 3 desc limit 10) x), '[]'),
    'citas', (select jsonb_build_object(
                'total', count(*),
                'completadas', count(*) filter (where estado = 'completada'),
                'canceladas', count(*) filter (where estado = 'cancelada'),
                'no_asistio', count(*) filter (where estado = 'no_asistio'),
                'en_linea', count(*) filter (where origen = 'en_linea'),
                'pagadas_en_linea', count(*) filter (where pago_estado = 'pagado'),
                'anticipos', coalesce(sum(pago_monto) filter (where pago_estado = 'pagado'), 0))
              from public.citas where negocio_id = p_negocio
                and inicio >= (p_desde::timestamp at time zone tz) and inicio < ((p_hasta + 1)::timestamp at time zone tz))
  ) into r;
  return r;
end $$;
