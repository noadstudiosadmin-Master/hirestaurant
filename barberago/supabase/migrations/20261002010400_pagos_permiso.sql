-- La Edge Function de pagos pregunta si quien conecta la cuenta tiene permiso de Ajustes.
create function public.pago_puede_configurar(p_negocio uuid, p_usuario uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.miembros
                  where negocio_id = p_negocio and usuario_id = p_usuario and activo
                    and (rol = 'admin' or 'ajustes' = any (permisos)));
$$;
revoke execute on function public.pago_puede_configurar(uuid, uuid) from public, anon, authenticated;
grant execute on function public.pago_puede_configurar(uuid, uuid) to service_role;
