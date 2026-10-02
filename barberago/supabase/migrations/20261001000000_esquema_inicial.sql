-- BarberaGo: esquema inicial.
-- Sigue los patrones de HiRestaurant: negocios multi-tenant, miembros con rol y permisos,
-- helpers en el esquema `privado` para RLS, suscripciones y códigos de activación.

create extension if not exists btree_gist with schema extensions;

create schema if not exists privado;
grant usage on schema privado to anon, authenticated;

-- ───────────────────────── Cuentas ─────────────────────────

create table public.perfiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null default '',
  email text,
  telefono text,
  created_at timestamptz not null default now()
);

create function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.perfiles (id, nombre, email)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data->>'nombre'), ''), split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger al_crear_usuario after insert on auth.users
  for each row execute function public.crear_perfil();

create table public.suscripciones (
  usuario_id uuid primary key references public.perfiles (id) on delete cascade,
  plan text not null,
  negocios_max integer not null check (negocios_max between 1 and 100),
  vence timestamptz not null,
  origen text not null default 'codigo' check (origen in ('prueba', 'codigo', 'pago', 'manual')),
  updated_at timestamptz not null default now()
);

create table public.codigos_activacion (
  codigo text primary key,
  plan text not null,
  negocios_max integer not null check (negocios_max between 1 and 100),
  dias integer not null check (dias between 1 and 3660),
  usos_max integer not null default 1 check (usos_max between 1 and 10000),
  usos integer not null default 0,
  expira timestamptz,
  nota text,
  created_at timestamptz not null default now()
);

-- ───────────────────────── Negocio y equipo ─────────────────────────

create table public.negocios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(trim(nombre)) between 1 and 60),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 40),
  telefono text,
  direccion text,
  logo_url text,
  zona_horaria text not null default 'America/Mexico_City',
  moneda text not null default 'MXN',
  -- Horario semanal por día ISO (1 = lunes … 7 = domingo): lista de tramos [abre, cierra].
  horario jsonb not null default '{"1":[["10:00","20:00"]],"2":[["10:00","20:00"]],"3":[["10:00","20:00"]],"4":[["10:00","20:00"]],"5":[["10:00","20:00"]],"6":[["10:00","18:00"]],"7":[]}',
  intervalo_min integer not null default 15 check (intervalo_min in (5, 10, 15, 20, 30, 60)),
  anticipacion_min integer not null default 60 check (anticipacion_min between 0 and 10080),
  reserva_online boolean not null default true,
  ultimo_folio integer not null default 0,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.barberos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 1 and 60),
  telefono text,
  color text not null default '#c8102e',
  foto_url text,
  -- Horario propio; null = usa el horario del negocio.
  horario jsonb,
  comision_servicios numeric(5,2) not null default 50 check (comision_servicios between 0 and 100),
  comision_productos numeric(5,2) not null default 10 check (comision_productos between 0 and 100),
  en_linea boolean not null default true,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  unique (negocio_id, id)
);

create table public.miembros (
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  usuario_id uuid not null references public.perfiles (id) on delete cascade,
  rol text not null default 'barbero' check (rol in ('admin', 'recepcion', 'barbero')),
  permisos text[] not null default array['agenda', 'clientes', 'cobrar']
    check (permisos <@ array['agenda', 'clientes', 'cobrar', 'caja', 'catalogo', 'inventario', 'reportes', 'equipo', 'ajustes']),
  activo boolean not null default true,
  nombre text not null default '',
  email text,
  barbero_id uuid,
  created_at timestamptz not null default now(),
  primary key (negocio_id, usuario_id),
  foreign key (negocio_id, barbero_id) references public.barberos (negocio_id, id) on delete set null (barbero_id)
);
create index miembros_usuario_idx on public.miembros (usuario_id);

create function privado.es_miembro(n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros where negocio_id = n and usuario_id = auth.uid() and activo);
$$;

create function privado.es_admin_de(n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros where negocio_id = n and usuario_id = auth.uid() and activo and rol = 'admin');
$$;

create function privado.puede(n uuid, p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros
                  where negocio_id = n and usuario_id = auth.uid() and activo
                    and (rol = 'admin' or p = any (permisos)));
$$;

create function privado.negocio_vigente(n uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.negocios ne join public.suscripciones s on s.usuario_id = ne.creado_por
                  where ne.id = n and s.vence > now());
$$;

create function public.proteger_miembros() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.negocio_id <> old.negocio_id or new.usuario_id <> old.usuario_id) then
    raise exception 'No se puede mover una membresía';
  end if;
  if old.rol = 'admin' and old.activo and (tg_op = 'DELETE' or new.rol <> 'admin' or not new.activo) then
    if exists (select 1 from public.negocios where id = old.negocio_id)
       and not exists (select 1 from public.miembros where negocio_id = old.negocio_id and rol = 'admin' and activo and usuario_id <> old.usuario_id) then
      raise exception 'Debe quedar al menos un administrador activo';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger proteger_miembros before update or delete on public.miembros
  for each row execute function public.proteger_miembros();

-- ───────────────────────── Catálogo, clientes y agenda ─────────────────────────

create table public.servicios (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 1 and 80),
  descripcion text,
  categoria text,
  duracion_min integer not null default 30 check (duracion_min between 5 and 480),
  precio numeric(10,2) not null default 0 check (precio >= 0),
  en_linea boolean not null default true,
  activo boolean not null default true,
  orden integer not null default 0,
  created_at timestamptz not null default now(),
  unique (negocio_id, id)
);

create table public.productos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 1 and 80),
  sku text,
  precio numeric(10,2) not null default 0 check (precio >= 0),
  costo numeric(10,2) not null default 0 check (costo >= 0),
  stock integer not null default 0,
  stock_minimo integer not null default 0,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (negocio_id, id)
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 1 and 80),
  telefono text,
  email text,
  nacimiento date,
  notas text,
  etiquetas text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (negocio_id, id)
);
create unique index clientes_telefono_uidx on public.clientes (negocio_id, telefono) where telefono is not null;
create index clientes_nombre_idx on public.clientes (negocio_id, lower(nombre));

create table public.bloqueos (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  barbero_id uuid, -- null = todo el negocio
  inicio timestamptz not null,
  fin timestamptz not null check (fin > inicio),
  motivo text,
  foreign key (negocio_id, barbero_id) references public.barberos (negocio_id, id) on delete cascade
);
create index bloqueos_rango_idx on public.bloqueos (negocio_id, inicio);

create table public.citas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  cliente_id uuid,
  cliente_nombre text, -- para clientes de paso sin ficha
  barbero_id uuid,     -- null = cualquiera (fila sin cita)
  servicio_id uuid,
  inicio timestamptz not null,
  fin timestamptz not null check (fin > inicio),
  estado text not null default 'confirmada'
    check (estado in ('pendiente', 'confirmada', 'en_espera', 'en_curso', 'completada', 'cancelada', 'no_asistio')),
  origen text not null default 'agenda' check (origen in ('agenda', 'en_linea', 'sin_cita')),
  precio numeric(10,2),
  notas text,
  creado_por uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (negocio_id, cliente_id) references public.clientes (negocio_id, id) on delete set null (cliente_id),
  foreign key (negocio_id, barbero_id) references public.barberos (negocio_id, id) on delete set null (barbero_id),
  foreign key (negocio_id, servicio_id) references public.servicios (negocio_id, id) on delete set null (servicio_id),
  -- Un barbero no puede tener dos citas activas encimadas.
  constraint citas_sin_empalme exclude using gist (
    barbero_id with =, tstzrange(inicio, fin, '[)') with &&
  ) where (barbero_id is not null and estado in ('pendiente', 'confirmada', 'en_curso'))
);
create index citas_agenda_idx on public.citas (negocio_id, inicio);
create index citas_cliente_idx on public.citas (negocio_id, cliente_id);

-- ───────────────────────── Ventas ─────────────────────────

create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  folio integer not null,
  fecha timestamptz not null default now(),
  cliente_id uuid,
  barbero_id uuid, -- recibe la propina
  cita_id uuid references public.citas (id) on delete set null,
  subtotal numeric(10,2) not null,
  descuento numeric(10,2) not null default 0,
  propina numeric(10,2) not null default 0,
  total numeric(10,2) not null,
  metodo_pago text not null check (metodo_pago in ('efectivo', 'tarjeta', 'transferencia')),
  estado text not null default 'pagada' check (estado in ('pagada', 'anulada')),
  notas text,
  usuario uuid references public.perfiles (id) on delete set null,
  unique (negocio_id, folio),
  foreign key (negocio_id, cliente_id) references public.clientes (negocio_id, id) on delete set null (cliente_id),
  foreign key (negocio_id, barbero_id) references public.barberos (negocio_id, id) on delete set null (barbero_id)
);
create index ventas_fecha_idx on public.ventas (negocio_id, fecha);
create index ventas_cliente_idx on public.ventas (negocio_id, cliente_id);

create table public.venta_items (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas (id) on delete cascade,
  negocio_id uuid not null references public.negocios (id) on delete cascade,
  tipo text not null check (tipo in ('servicio', 'producto')),
  servicio_id uuid,
  producto_id uuid,
  barbero_id uuid,
  nombre text not null,
  cantidad integer not null default 1 check (cantidad between 1 and 999),
  precio_unit numeric(10,2) not null check (precio_unit >= 0),
  importe numeric(10,2) not null,
  comision numeric(10,2) not null default 0,
  foreign key (negocio_id, servicio_id) references public.servicios (negocio_id, id) on delete set null (servicio_id),
  foreign key (negocio_id, producto_id) references public.productos (negocio_id, id) on delete set null (producto_id),
  foreign key (negocio_id, barbero_id) references public.barberos (negocio_id, id) on delete set null (barbero_id)
);
create index venta_items_venta_idx on public.venta_items (venta_id);
create index venta_items_negocio_idx on public.venta_items (negocio_id, barbero_id);

-- ───────────────────────── RLS ─────────────────────────

alter table public.perfiles enable row level security;
alter table public.suscripciones enable row level security;
alter table public.codigos_activacion enable row level security; -- sin políticas: solo vía funciones
alter table public.negocios enable row level security;
alter table public.miembros enable row level security;
alter table public.barberos enable row level security;
alter table public.servicios enable row level security;
alter table public.productos enable row level security;
alter table public.clientes enable row level security;
alter table public.bloqueos enable row level security;
alter table public.citas enable row level security;
alter table public.ventas enable row level security;
alter table public.venta_items enable row level security;

create policy perfil_propio_leer on public.perfiles for select using (id = (select auth.uid()));
create policy perfil_propio_editar on public.perfiles for update using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy suscripcion_propia_leer on public.suscripciones for select using (usuario_id = (select auth.uid()));

create policy negocio_leer on public.negocios for select using ((select privado.es_miembro(id)));
create policy negocio_editar on public.negocios for update
  using ((select privado.puede(id, 'ajustes'))) with check ((select privado.puede(id, 'ajustes')));

create policy miembros_leer on public.miembros for select
  using (usuario_id = (select auth.uid()) or (select privado.es_miembro(negocio_id)));
create policy miembros_editar on public.miembros for update
  using ((select privado.puede(negocio_id, 'equipo'))) with check ((select privado.puede(negocio_id, 'equipo')));
create policy miembros_quitar on public.miembros for delete
  using ((select privado.puede(negocio_id, 'equipo')) or usuario_id = (select auth.uid()));

-- Barberos y servicios: todo el equipo los ve; los edita quien tiene "equipo" / "catalogo".
create policy barberos_leer on public.barberos for select using ((select privado.es_miembro(negocio_id)));
create policy barberos_insertar on public.barberos for insert with check ((select privado.puede(negocio_id, 'equipo')));
create policy barberos_editar on public.barberos for update
  using ((select privado.puede(negocio_id, 'equipo'))) with check ((select privado.puede(negocio_id, 'equipo')));
create policy barberos_borrar on public.barberos for delete using ((select privado.puede(negocio_id, 'equipo')));

create policy servicios_leer on public.servicios for select using ((select privado.es_miembro(negocio_id)));
create policy servicios_insertar on public.servicios for insert with check ((select privado.puede(negocio_id, 'catalogo')));
create policy servicios_editar on public.servicios for update
  using ((select privado.puede(negocio_id, 'catalogo'))) with check ((select privado.puede(negocio_id, 'catalogo')));
create policy servicios_borrar on public.servicios for delete using ((select privado.puede(negocio_id, 'catalogo')));

create policy productos_leer on public.productos for select using ((select privado.es_miembro(negocio_id)));
create policy productos_insertar on public.productos for insert with check ((select privado.puede(negocio_id, 'inventario')));
create policy productos_editar on public.productos for update
  using ((select privado.puede(negocio_id, 'inventario'))) with check ((select privado.puede(negocio_id, 'inventario')));
create policy productos_borrar on public.productos for delete using ((select privado.puede(negocio_id, 'inventario')));

create policy clientes_leer on public.clientes for select using ((select privado.es_miembro(negocio_id)));
create policy clientes_insertar on public.clientes for insert with check ((select privado.puede(negocio_id, 'clientes')) or (select privado.puede(negocio_id, 'agenda')));
create policy clientes_editar on public.clientes for update
  using ((select privado.puede(negocio_id, 'clientes'))) with check ((select privado.puede(negocio_id, 'clientes')));
create policy clientes_borrar on public.clientes for delete using ((select privado.puede(negocio_id, 'clientes')));

create policy bloqueos_leer on public.bloqueos for select using ((select privado.es_miembro(negocio_id)));
create policy bloqueos_insertar on public.bloqueos for insert with check ((select privado.puede(negocio_id, 'agenda')));
create policy bloqueos_editar on public.bloqueos for update
  using ((select privado.puede(negocio_id, 'agenda'))) with check ((select privado.puede(negocio_id, 'agenda')));
create policy bloqueos_borrar on public.bloqueos for delete using ((select privado.puede(negocio_id, 'agenda')));

create policy citas_leer on public.citas for select using ((select privado.es_miembro(negocio_id)));
create policy citas_insertar on public.citas for insert with check ((select privado.puede(negocio_id, 'agenda')));
create policy citas_editar on public.citas for update
  using ((select privado.puede(negocio_id, 'agenda'))) with check ((select privado.puede(negocio_id, 'agenda')));
create policy citas_borrar on public.citas for delete using ((select privado.puede(negocio_id, 'agenda')));

-- Ventas: solo se crean y anulan con funciones (cobrar / anular_venta).
create policy ventas_leer on public.ventas for select
  using ((select privado.puede(negocio_id, 'caja')) or (select privado.puede(negocio_id, 'reportes')) or usuario = (select auth.uid()));
create policy venta_items_leer on public.venta_items for select
  using ((select privado.puede(negocio_id, 'caja')) or (select privado.puede(negocio_id, 'reportes'))
         or exists (select 1 from public.ventas v where v.id = venta_id and v.usuario = (select auth.uid())));

-- ───────────────────────── Funciones del equipo ─────────────────────────

create function privado.slug_libre(p_texto text) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare base text; candidato text; i int := 0;
begin
  base := lower(translate(coalesce(p_texto, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun'));
  base := trim(both '-' from regexp_replace(base, '[^a-z0-9]+', '-', 'g'));
  base := left(base, 32);
  if char_length(base) < 3 then base := 'barberia'; end if;
  candidato := base;
  while exists (select 1 from public.negocios where slug = candidato) loop
    i := i + 1;
    candidato := base || '-' || substr(md5(random()::text), 1, 4);
    if i > 20 then raise exception 'No se pudo generar un enlace único'; end if;
  end loop;
  return candidato;
end $$;

create function public.crear_negocio(p_nombre text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare nid uuid; bid uuid; p record; s public.suscripciones; usados int;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para crear una barbería'; end if;
  if exists (select 1 from public.miembros where usuario_id = auth.uid())
     and not exists (select 1 from public.miembros where usuario_id = auth.uid() and rol = 'admin') then
    raise exception 'Las cuentas de empleado no pueden crear barberías. Pide al administrador lo que necesites';
  end if;
  if char_length(trim(coalesce(p_nombre, ''))) not between 1 and 60 then
    raise exception 'El nombre debe tener entre 1 y 60 caracteres';
  end if;

  select * into s from public.suscripciones where usuario_id = auth.uid();
  if s is null then
    -- Primera barbería: 30 días de prueba con 1 sucursal.
    insert into public.suscripciones (usuario_id, plan, negocios_max, vence, origen)
    values (auth.uid(), 'prueba', 1, now() + interval '30 days', 'prueba')
    returning * into s;
  end if;
  if s.vence < now() then raise exception 'Tu suscripción venció. Canjea un código o renueva tu plan'; end if;
  select count(*) into usados from public.negocios where creado_por = auth.uid();
  if usados >= s.negocios_max then
    raise exception 'Tu plan permite % sucursal(es). Mejora tu plan para crear más', s.negocios_max;
  end if;

  select nombre, email into p from public.perfiles where id = auth.uid();
  insert into public.negocios (nombre, slug, creado_por)
  values (trim(p_nombre), privado.slug_libre(p_nombre), auth.uid()) returning id into nid;
  insert into public.barberos (negocio_id, nombre) values (nid, coalesce(nullif(p.nombre, ''), 'Barbero 1')) returning id into bid;
  insert into public.miembros (negocio_id, usuario_id, rol, activo, nombre, email, barbero_id, permisos)
  values (nid, auth.uid(), 'admin', true, coalesce(p.nombre, ''), p.email, bid,
          array['agenda', 'clientes', 'cobrar', 'caja', 'catalogo', 'inventario', 'reportes', 'equipo', 'ajustes']);
  insert into public.servicios (negocio_id, nombre, duracion_min, precio, orden) values
    (nid, 'Corte de cabello', 40, 200, 1),
    (nid, 'Barba', 30, 150, 2),
    (nid, 'Corte y barba', 60, 320, 3);
  return nid;
end $$;

create function public.canjear_codigo(p_codigo text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.codigos_activacion; s public.suscripciones;
begin
  if auth.uid() is null then raise exception 'Inicia sesión para canjear un código'; end if;
  select * into c from public.codigos_activacion where codigo = upper(trim(p_codigo)) for update;
  if c is null or c.usos >= c.usos_max or (c.expira is not null and c.expira < now()) then
    raise exception 'El código no es válido o ya fue usado';
  end if;
  insert into public.suscripciones as x (usuario_id, plan, negocios_max, vence, origen)
  values (auth.uid(), c.plan, c.negocios_max, now() + make_interval(days => c.dias), 'codigo')
  on conflict (usuario_id) do update set
    plan = case when excluded.negocios_max >= x.negocios_max or x.vence < now() then excluded.plan else x.plan end,
    negocios_max = case when x.vence < now() then excluded.negocios_max else greatest(x.negocios_max, excluded.negocios_max) end,
    vence = greatest(x.vence, now()) + make_interval(days => c.dias),
    origen = 'codigo', updated_at = now()
  returning * into s;
  update public.codigos_activacion set usos = usos + 1 where codigo = c.codigo;
  return to_jsonb(s);
end $$;

-- Agrega a una persona que ya creó su cuenta (por correo) al equipo.
create function public.agregar_miembro(p_negocio uuid, p_email text, p_rol text, p_barbero uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare u public.perfiles; perm text[];
begin
  if not privado.puede(p_negocio, 'equipo') then raise exception 'No tienes permiso para administrar el equipo'; end if;
  if p_rol not in ('admin', 'recepcion', 'barbero') then raise exception 'Rol no válido'; end if;
  select * into u from public.perfiles where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'No existe una cuenta con ese correo. Pide que se registre primero en BarberaGo'; end if;
  if p_barbero is not null and not exists (select 1 from public.barberos where id = p_barbero and negocio_id = p_negocio) then
    raise exception 'Barbero no válido';
  end if;
  perm := case p_rol
    when 'admin' then array['agenda', 'clientes', 'cobrar', 'caja', 'catalogo', 'inventario', 'reportes', 'equipo', 'ajustes']
    when 'recepcion' then array['agenda', 'clientes', 'cobrar', 'caja']
    else array['agenda', 'clientes', 'cobrar'] end;
  insert into public.miembros (negocio_id, usuario_id, rol, permisos, nombre, email, barbero_id)
  values (p_negocio, u.id, p_rol, perm, u.nombre, u.email, p_barbero)
  on conflict (negocio_id, usuario_id) do update
    set rol = excluded.rol, permisos = excluded.permisos, barbero_id = excluded.barbero_id, activo = true;
end $$;

-- Cobro: crea la venta con sus partidas, calcula comisiones, descuenta inventario y cierra la cita.
-- p_items: [{"tipo":"servicio"|"producto","id":uuid,"cantidad":int,"precio":num?,"barbero_id":uuid?}]
create function public.cobrar(
  p_negocio uuid, p_items jsonb, p_metodo text,
  p_propina numeric default 0, p_descuento numeric default 0,
  p_cliente uuid default null, p_barbero uuid default null, p_cita uuid default null, p_notas text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  it jsonb; vid uuid; nfolio int; sub numeric := 0; factor numeric; tot numeric;
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
  update public.ventas set subtotal = round(sub, 2), descuento = round(coalesce(p_descuento, 0), 2),
    propina = round(coalesce(p_propina, 0), 2), total = round(tot, 2) where id = vid;
  if p_cita is not null then
    update public.citas set estado = 'completada' where id = p_cita and negocio_id = p_negocio;
  end if;
  return jsonb_build_object('id', vid, 'folio', nfolio, 'total', round(tot, 2));
end $$;

create function public.anular_venta(p_negocio uuid, p_venta uuid, p_motivo text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not privado.puede(p_negocio, 'caja') then raise exception 'No tienes permiso para anular ventas'; end if;
  update public.ventas set estado = 'anulada', notas = concat_ws(' · ', notas, 'Anulada: ' || nullif(trim(p_motivo), ''))
   where id = p_venta and negocio_id = p_negocio and estado = 'pagada';
  if not found then raise exception 'La venta no existe o ya estaba anulada'; end if;
  update public.productos p set stock = p.stock + i.cantidad
    from public.venta_items i where i.venta_id = p_venta and i.tipo = 'producto' and i.producto_id = p.id;
end $$;

-- Reporte del periodo (fechas en la zona horaria del negocio).
create function public.reporte(p_negocio uuid, p_desde date, p_hasta date) returns jsonb
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
    'por_metodo', coalesce((select jsonb_object_agg(metodo_pago, t) from (select metodo_pago, sum(total) t from v group by 1) x), '{}'),
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
                'en_linea', count(*) filter (where origen = 'en_linea'))
              from public.citas where negocio_id = p_negocio
                and inicio >= (p_desde::timestamp at time zone tz) and inicio < ((p_hasta + 1)::timestamp at time zone tz))
  ) into r;
  return r;
end $$;

-- ───────────────────────── Reservas en línea (públicas) ─────────────────────────

create function privado.horarios_libres(p_negocio uuid, p_servicio uuid, p_barbero uuid, p_fecha date)
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
                        and tstzrange(ci.inicio, ci.fin, '[)') && tstzrange(c.inicio, c.fin, '[)'))
     and not exists (select 1 from public.bloqueos bl
                      where bl.negocio_id = p_negocio and (bl.barbero_id is null or bl.barbero_id = c.barbero_id)
                        and tstzrange(bl.inicio, bl.fin, '[)') && tstzrange(c.inicio, c.fin, '[)'))
   order by c.inicio, c.barbero_id;
$$;

create function public.reserva_negocio(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'telefono', n.telefono, 'direccion', n.direccion,
                                  'logo_url', n.logo_url, 'zona_horaria', n.zona_horaria, 'moneda', n.moneda, 'horario', n.horario),
    'servicios', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'nombre', s.nombre, 'descripcion', s.descripcion,
                                  'categoria', s.categoria, 'duracion_min', s.duracion_min, 'precio', s.precio) order by s.orden, s.nombre)
                             from public.servicios s where s.negocio_id = n.id and s.activo and s.en_linea), '[]'),
    'barberos', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'nombre', b.nombre, 'foto_url', b.foto_url, 'color', b.color)
                                  order by b.orden, b.nombre)
                            from public.barberos b where b.negocio_id = n.id and b.activo and b.en_linea), '[]'))
    from public.negocios n
   where n.slug = lower(trim(p_slug)) and n.reserva_online and privado.negocio_vigente(n.id);
$$;

create function public.reserva_horarios(p_slug text, p_servicio uuid, p_barbero uuid, p_fecha date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare nid uuid;
begin
  select id into nid from public.negocios where slug = lower(trim(p_slug)) and reserva_online and privado.negocio_vigente(id);
  if nid is null then raise exception 'Esta barbería no recibe reservas en línea'; end if;
  if p_fecha < current_date - 1 or p_fecha > current_date + 60 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('inicio', h.inicio, 'barbero_id', h.barbero_id) order by h.inicio)
      from (select distinct on (l.inicio) l.inicio, l.barbero_id
              from privado.horarios_libres(nid, p_servicio, p_barbero, p_fecha) l
             order by l.inicio, l.barbero_id) h), '[]'::jsonb);
end $$;

create function public.reservar(
  p_slug text, p_servicio uuid, p_barbero uuid, p_inicio timestamptz,
  p_nombre text, p_telefono text, p_email text default null, p_notas text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n public.negocios; s public.servicios; tel text; bid uuid; cid uuid; cita uuid;
begin
  select * into n from public.negocios where slug = lower(trim(p_slug)) and reserva_online;
  if n is null or not privado.negocio_vigente(n.id) then raise exception 'Esta barbería no recibe reservas en línea'; end if;
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
        and inicio > now() and estado in ('pendiente', 'confirmada')) >= 3 then
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

-- El cliente cancela con el enlace de su cita (id) y su teléfono.
create function public.reserva_cancelar(p_cita uuid, p_telefono text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.citas c set estado = 'cancelada'
    from public.clientes cl
   where c.id = p_cita and cl.id = c.cliente_id and cl.negocio_id = c.negocio_id
     and cl.telefono = regexp_replace(coalesce(p_telefono, ''), '[^0-9]', '', 'g')
     and c.estado in ('pendiente', 'confirmada') and c.inicio > now();
  if not found then raise exception 'No encontramos una cita activa con esos datos'; end if;
end $$;

-- Permisos de ejecución: anónimos solo usan las funciones de reserva.
revoke execute on all functions in schema public from public, anon;
grant execute on function public.reserva_negocio(text), public.reserva_horarios(text, uuid, uuid, date),
  public.reservar(text, uuid, uuid, timestamptz, text, text, text, text), public.reserva_cancelar(uuid, text) to anon, authenticated;
grant execute on function public.crear_negocio(text), public.canjear_codigo(text), public.agregar_miembro(uuid, text, text, uuid),
  public.cobrar(uuid, jsonb, text, numeric, numeric, uuid, uuid, uuid, text), public.anular_venta(uuid, uuid, text),
  public.reporte(uuid, date, date) to authenticated;
revoke execute on all functions in schema privado from public;
grant execute on function privado.es_miembro(uuid), privado.es_admin_de(uuid), privado.puede(uuid, text) to anon, authenticated;

-- La agenda se actualiza en vivo en todos los dispositivos.
alter publication supabase_realtime add table public.citas;
