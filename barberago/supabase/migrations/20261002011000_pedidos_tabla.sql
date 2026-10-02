-- Pedidos en línea sin reserva: el cliente compra productos, paga en Mercado Pago
-- y los recoge en la sucursal. Al entregarlos se registra la venta (sale del inventario).

alter table public.negocios add column ultimo_pedido integer not null default 0;

create table public.pedidos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  numero integer not null,
  cliente_id uuid,
  cliente_nombre text not null,
  telefono text not null,
  notas text,
  -- pendiente: esperando el pago · pagado: listo para recoger · entregado · cancelado
  -- reembolsar / reembolsado: el pago llegó cuando ya no correspondía y se devuelve.
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'pagado', 'entregado', 'cancelado', 'reembolsar', 'reembolsado')),
  total numeric(10,2) not null check (total > 0),
  pago_id text,
  pago_expira timestamptz not null,
  pago_fecha timestamptz,
  entregado_en timestamptz,
  entregado_por uuid references auth.users (id) on delete set null,
  venta_id uuid references public.ventas (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (negocio_id, numero),
  unique (negocio_id, id),
  foreign key (negocio_id, cliente_id) references public.clientes (negocio_id, id) on delete set null (cliente_id)
);
create index pedidos_estado_idx on public.pedidos (negocio_id, estado, created_at desc);

create table public.pedido_productos (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.pedidos (id) on delete cascade,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  producto_id uuid,
  nombre text not null,
  cantidad integer not null check (cantidad between 1 and 20),
  precio_unit numeric(10,2) not null check (precio_unit >= 0),
  foreign key (negocio_id, producto_id) references public.productos (negocio_id, id) on delete set null (producto_id)
);
create index pedido_productos_pedido_idx on public.pedido_productos (pedido_id);
create index pedido_productos_producto_idx on public.pedido_productos (negocio_id, producto_id);

alter table public.pedidos enable row level security;
alter table public.pedido_productos enable row level security;
-- El equipo los ve; se crean y cambian solo con las funciones del servidor.
create policy pedidos_leer on public.pedidos for select using ((select privado.es_miembro(negocio_id)));
create policy pedido_productos_leer on public.pedido_productos for select using ((select privado.es_miembro(negocio_id)));

alter table public.ventas add column pedido_id uuid references public.pedidos (id) on delete set null;

-- La existencia disponible también descuenta los pedidos por pagar (vigentes) y por entregar.
create or replace function privado.producto_disponible(p_producto uuid) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(p.stock
    - coalesce((select sum(cp.cantidad) from public.cita_productos cp join public.citas c on c.id = cp.cita_id
                 where cp.producto_id = p.id and c.estado in ('pendiente', 'confirmada', 'en_espera', 'en_curso')
                   and not coalesce(c.pago_estado = 'pendiente' and c.pago_expira < now(), false)), 0)
    - coalesce((select sum(pp.cantidad) from public.pedido_productos pp join public.pedidos d on d.id = pp.pedido_id
                 where pp.producto_id = p.id
                   and (d.estado = 'pagado' or (d.estado = 'pendiente' and d.pago_expira >= now()))), 0), 0)::int
    from public.productos p where p.id = p_producto;
$$;
