-- Las funciones de trigger no deben llamarse por la API.
revoke execute on function public.crear_perfil(), public.proteger_miembros() from authenticated;
