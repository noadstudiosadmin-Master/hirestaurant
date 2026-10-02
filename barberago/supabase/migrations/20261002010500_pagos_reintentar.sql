-- Si el cliente regresa sin pagar (tarjeta rechazada, cerró la ventana), puede volver a intentarlo
-- con el mismo apartado mientras no venza.
create function public.pago_reintentar(p_cita uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.citas; n public.negocios; pc privado.pago_cuentas;
begin
  select * into c from public.citas where id = p_cita;
  if c.id is null or c.pago_estado is distinct from 'pendiente' or c.estado <> 'pendiente'
     or c.pago_expira < now() + interval '1 minute' then
    raise exception 'El apartado ya venció. Elige tu horario de nuevo';
  end if;
  select * into n from public.negocios where id = c.negocio_id;
  select * into pc from privado.pago_cuentas where negocio_id = c.negocio_id;
  if pc.access_token is null then raise exception 'Esta barbería no recibe pagos en línea'; end if;
  return jsonb_build_object(
    'id', c.id, 'inicio', c.inicio, 'precio', c.precio, 'monto', c.pago_monto, 'expira', c.pago_expira,
    'nombre', c.cliente_nombre, 'servicio_id', c.servicio_id,
    'servicio', (select nombre from public.servicios where id = c.servicio_id),
    'negocio', jsonb_build_object('id', n.id, 'nombre', n.nombre, 'slug', n.slug, 'moneda', n.moneda),
    'access_token', pc.access_token);
end $$;
revoke execute on function public.pago_reintentar(uuid) from public, anon, authenticated;
grant execute on function public.pago_reintentar(uuid) to service_role;
