-- ───────────────────────── Pedidos: funciones del servidor (solo service_role) ─────────────────────────

-- Aparta los productos y devuelve lo necesario para crear el cobro en Mercado Pago.
create function public.pedido_apartar(
  p_slug text, p_nombre text, p_telefono text, p_productos jsonb, p_notas text default null, p_minutos integer default 20
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.negocios; pc privado.pago_cuentas; tel text; cid uuid; pid uuid; num int; vence timestamptz;
        it jsonb; p public.productos; cant int; v_total numeric := 0; piezas int := 0;
begin
  select * into n from public.negocios where slug = lower(trim(p_slug)) and reserva_online;
  if n is null or not privado.negocio_vigente(n.id) then raise exception 'Esta barbería no vende en línea por ahora'; end if;
  select * into pc from privado.pago_cuentas where negocio_id = n.id;
  if pc.access_token is null or n.pago_en_linea = 'desactivado' then raise exception 'Esta barbería no recibe pagos en línea'; end if;
  if char_length(trim(coalesce(p_nombre, ''))) not between 2 and 80 then raise exception 'Escribe tu nombre'; end if;
  tel := regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g');
  if char_length(tel) not between 8 and 15 then raise exception 'Escribe un teléfono válido'; end if;
  if jsonb_typeof(coalesce(p_productos, '[]')) <> 'array' or jsonb_array_length(coalesce(p_productos, '[]')) not between 1 and 20 then
    raise exception 'Elige al menos un producto';
  end if;
  -- Un mismo teléfono no puede tener muchos pedidos sin pagar a la vez.
  if (select count(*) from public.pedidos where negocio_id = n.id and telefono = tel
        and estado = 'pendiente' and pago_expira >= now()) >= 3 then
    raise exception 'Ya tienes pedidos esperando pago; termina de pagarlos o espera unos minutos';
  end if;

  select id into cid from public.clientes where negocio_id = n.id and telefono = tel;
  if cid is null then
    insert into public.clientes (negocio_id, nombre, telefono) values (n.id, trim(p_nombre), tel) returning id into cid;
  end if;
  update public.negocios set ultimo_pedido = ultimo_pedido + 1 where id = n.id returning ultimo_pedido into num;
  vence := now() + make_interval(mins => greatest(least(coalesce(p_minutos, 20), 60), 5));
  insert into public.pedidos (negocio_id, numero, cliente_id, cliente_nombre, telefono, notas, total, pago_expira)
  values (n.id, num, cid, trim(p_nombre), tel, nullif(left(trim(p_notas), 300), ''), 0.01, vence)
  returning id into pid;

  for it in select * from jsonb_array_elements(p_productos) loop
    cant := coalesce((it->>'cantidad')::int, 0);
    continue when cant <= 0;
    select * into p from public.productos
     where id = (it->>'id')::uuid and negocio_id = n.id and activo and en_linea and precio > 0 for update;
    if p.id is null then raise exception 'Uno de los productos ya no está disponible'; end if;
    if cant > 20 or cant > privado.producto_disponible(p.id) then
      raise exception 'Ya no hay suficiente % (quedan %)', p.nombre, privado.producto_disponible(p.id);
    end if;
    insert into public.pedido_productos (pedido_id, negocio_id, producto_id, nombre, cantidad, precio_unit)
    values (pid, n.id, p.id, p.nombre, cant, p.precio);
    v_total := v_total + p.precio * cant;
    piezas := piezas + cant;
  end loop;
  if v_total <= 0 then raise exception 'Elige al menos un producto'; end if;
  update public.pedidos set total = round(v_total, 2) where id = pid;

  return jsonb_build_object('id', pid, 'numero', num, 'monto', round(v_total, 2), 'expira', vence, 'piezas', piezas,
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'moneda', n.moneda),
    'access_token', pc.access_token);
end $$;

-- Nueva liga de pago para un pedido que sigue vigente.
create function public.pedido_reintentar(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.pedidos; n public.negocios; pc privado.pago_cuentas;
begin
  select * into d from public.pedidos where id = p_pedido;
  if d.id is null or d.estado <> 'pendiente' or d.pago_expira < now() + interval '1 minute' then
    raise exception 'El pedido ya venció. Hazlo de nuevo';
  end if;
  select * into n from public.negocios where id = d.negocio_id;
  select * into pc from privado.pago_cuentas where negocio_id = d.negocio_id;
  if pc.access_token is null then raise exception 'Esta barbería no recibe pagos en línea'; end if;
  return jsonb_build_object('id', d.id, 'numero', d.numero, 'monto', d.total, 'expira', d.pago_expira, 'nombre', d.cliente_nombre,
    'piezas', (select sum(cantidad) from public.pedido_productos where pedido_id = d.id),
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'moneda', n.moneda),
    'access_token', pc.access_token);
end $$;

create function public.pedido_token(p_pedido uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('negocio_id', pc.negocio_id, 'access_token', pc.access_token)
    from privado.pago_cuentas pc
   where pc.negocio_id = (select negocio_id from public.pedidos where id = p_pedido) and pc.access_token is not null;
$$;

-- Registra lo que Mercado Pago dice de un pago de pedido. Devuelve 'ok', 'reembolsar' o 'ignorado'.
create function public.pedido_registrar(p_pedido uuid, p_negocio uuid, p_pago_id text, p_estado text, p_monto numeric)
returns text language plpgsql security definer set search_path = '' as $$
declare d public.pedidos; falta boolean;
begin
  select * into d from public.pedidos where id = p_pedido and negocio_id = p_negocio for update;
  if d.id is null then return 'ignorado'; end if;
  if p_estado <> 'approved' then return 'ok'; end if;
  if d.estado in ('pagado', 'entregado', 'reembolsar', 'reembolsado') then
    return case when d.pago_id is distinct from p_pago_id and d.estado in ('pagado', 'entregado') then 'reembolsar' else 'ok' end;
  end if;
  -- Si pagó tarde, solo se acepta si todavía hay existencia para todo el pedido.
  if d.pago_expira < now() then
    select exists (select 1 from public.pedido_productos pp
                    where pp.pedido_id = d.id and pp.producto_id is not null
                      and pp.cantidad > privado.producto_disponible(pp.producto_id)) into falta;
  end if;
  if d.estado = 'cancelado' or p_monto + 0.01 < d.total or coalesce(falta, false) then
    update public.pedidos set estado = 'reembolsar', pago_id = p_pago_id where id = d.id;
    return 'reembolsar';
  end if;
  update public.pedidos set estado = 'pagado', pago_id = p_pago_id, pago_fecha = now() where id = d.id;
  return 'ok';
end $$;

create function public.pedido_marcar_reembolso(p_pedido uuid, p_pago_id text) returns void
language sql security definer set search_path = '' as $$
  update public.pedidos set estado = 'reembolsado' where id = p_pedido and pago_id = p_pago_id and estado = 'reembolsar';
$$;

-- Si no se pudo crear el cobro, se cancela el pedido (libera la existencia).
create function public.pedido_cancelar_apartado(p_pedido uuid) returns void
language sql security definer set search_path = '' as $$
  update public.pedidos set estado = 'cancelado' where id = p_pedido and estado = 'pendiente';
$$;

revoke execute on function public.pedido_apartar(text, text, text, jsonb, text, integer), public.pedido_reintentar(uuid),
  public.pedido_token(uuid), public.pedido_registrar(uuid, uuid, text, text, numeric),
  public.pedido_marcar_reembolso(uuid, text), public.pedido_cancelar_apartado(uuid)
  from public, anon, authenticated;
grant execute on function public.pedido_apartar(text, text, text, jsonb, text, integer), public.pedido_reintentar(uuid),
  public.pedido_token(uuid), public.pedido_registrar(uuid, uuid, text, text, numeric),
  public.pedido_marcar_reembolso(uuid, text), public.pedido_cancelar_apartado(uuid)
  to service_role;

-- ───────────────────────── Pedidos: funciones públicas ─────────────────────────

-- Estado de un pedido para la página de regreso del pago (el id funciona como enlace privado).
create function public.pedido_estado(p_pedido uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', d.id, 'numero', d.numero, 'total', d.total, 'creado', d.created_at, 'pago_expira', d.pago_expira,
    'estado', case when d.estado = 'pendiente' and d.pago_expira < now() then 'vencido' else d.estado end,
    'cliente', split_part(d.cliente_nombre, ' ', 1),
    'productos', coalesce((select jsonb_agg(jsonb_build_object('nombre', pp.nombre, 'cantidad', pp.cantidad, 'precio', pp.precio_unit) order by pp.nombre)
                             from public.pedido_productos pp where pp.pedido_id = d.id), '[]'),
    'negocio', jsonb_build_object('nombre', n.nombre, 'slug', n.slug, 'direccion', n.direccion, 'telefono', n.telefono,
                                  'zona_horaria', n.zona_horaria, 'moneda', n.moneda, 'logo_url', n.logo_url, 'horario', n.horario))
    from public.pedidos d join public.negocios n on n.id = d.negocio_id
   where d.id = p_pedido;
$$;
revoke execute on function public.pedido_estado(uuid) from public;
grant execute on function public.pedido_estado(uuid) to anon, authenticated;

-- El equipo entrega un pedido pagado: se registra la venta (pagada en línea) y sale del inventario.
create function public.pedido_entregar(p_pedido uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.pedidos; r jsonb;
begin
  select * into d from public.pedidos where id = p_pedido for update;
  if d.id is null or not privado.puede(d.negocio_id, 'cobrar') then raise exception 'No tienes permiso para entregar pedidos'; end if;
  if d.estado = 'entregado' then raise exception 'Este pedido ya se entregó'; end if;
  if d.estado <> 'pagado' then raise exception 'Este pedido no está pagado'; end if;
  r := public.cobrar(d.negocio_id,
         (select jsonb_agg(jsonb_build_object('tipo', 'producto', 'id', pp.producto_id, 'cantidad', pp.cantidad, 'precio', pp.precio_unit))
            from public.pedido_productos pp where pp.pedido_id = d.id and pp.producto_id is not null),
         'tarjeta', 0, 0, d.cliente_id, null, null, 'Pedido en línea #' || d.numero);
  update public.ventas set pagado_en_linea = total, pedido_id = d.id where id = (r->>'id')::uuid;
  update public.pedidos set estado = 'entregado', entregado_en = now(), entregado_por = auth.uid(), venta_id = (r->>'id')::uuid
   where id = d.id;
  return r || jsonb_build_object('pagado_en_linea', r->'total');
end $$;
revoke execute on function public.pedido_entregar(uuid) from public, anon;
grant execute on function public.pedido_entregar(uuid) to authenticated;
