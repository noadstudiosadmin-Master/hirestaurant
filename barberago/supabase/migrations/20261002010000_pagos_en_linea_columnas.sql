-- BarberaGo: pagos en línea al reservar (Mercado Pago).
-- Cada barbería conecta su propia cuenta de Mercado Pago y el dinero le llega directo.
-- El cliente aparta el horario, paga en Mercado Pago y la cita se confirma sola con el aviso (webhook).
-- Un apartado sin pagar vence a los pocos minutos y el horario se libera.

-- ───────────────────────── Configuración por barbería ─────────────────────────

alter table public.negocios
  add column pago_en_linea text not null default 'desactivado'
    check (pago_en_linea in ('desactivado', 'opcional', 'obligatorio')),
  add column anticipo_pct integer not null default 100 check (anticipo_pct between 10 and 100),
  -- Datos visibles de la cuenta conectada (la llave secreta vive en privado.pago_cuentas).
  add column pago_cuenta text,
  add column pago_prueba boolean not null default false;

create table privado.pago_cuentas (
  negocio_id uuid primary key references public.negocios (id) on delete cascade,
  proveedor text not null default 'mercadopago' check (proveedor in ('mercadopago')),
  access_token text not null,
  cuenta text,
  prueba boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table privado.pago_cuentas enable row level security; -- sin políticas: solo el servidor la lee
revoke all on privado.pago_cuentas from public, anon, authenticated;

-- ───────────────────────── Pago de la cita ─────────────────────────

alter table public.citas
  add column pago_estado text
    check (pago_estado in ('pendiente', 'pagado', 'expirado', 'fallido', 'reembolsar', 'reembolsado')),
  add column pago_monto numeric(10,2),
  add column pago_id text,
  add column pago_expira timestamptz,
  add column pago_fecha timestamptz;

alter table public.ventas add column pagado_en_linea numeric(10,2) not null default 0;
