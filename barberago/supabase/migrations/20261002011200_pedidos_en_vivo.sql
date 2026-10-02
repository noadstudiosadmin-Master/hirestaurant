-- La pantalla de Pedidos se actualiza sola cuando llega un pedido pagado.
alter publication supabase_realtime add table public.pedidos;
