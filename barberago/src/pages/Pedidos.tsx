import { useCallback, useEffect, useState } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import type { Pedido } from '../lib/tipos';
import { dinero, fechaCorta, hora, whatsapp } from '../lib/formato';
import { Aviso, Cabecera, Vacio } from '../components/ui';

/** Pedidos de productos pagados en línea para recoger en la sucursal. */
export default function Pedidos() {
  const { negocio } = useNegocio();
  const [porEntregar, setPorEntregar] = useState<Pedido[] | null>(null);
  const [entregados, setEntregados] = useState<Pedido[]>([]);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [entregando, setEntregando] = useState('');

  const cargar = useCallback(async () => {
    const campos = '*, pedido_productos(nombre, cantidad, precio_unit)';
    const [pend, hechos] = await Promise.all([
      supabase.from('pedidos').select(campos).eq('negocio_id', negocio.id).eq('estado', 'pagado').order('created_at'),
      supabase.from('pedidos').select(campos).eq('negocio_id', negocio.id).eq('estado', 'entregado')
        .order('entregado_en', { ascending: false }).limit(15),
    ]);
    setPorEntregar((pend.data as Pedido[]) || []);
    setEntregados((hechos.data as Pedido[]) || []);
  }, [negocio.id]);

  useEffect(() => { cargar(); }, [cargar]);

  // En vivo: un pedido recién pagado aparece sin recargar.
  useEffect(() => {
    const canal = supabase.channel(`pedidos-${negocio.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pedidos', filter: `negocio_id=eq.${negocio.id}` }, () => cargar())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [negocio.id, cargar]);

  async function entregar(p: Pedido) {
    if (!confirm(`¿Entregar el pedido #${p.numero} a ${p.cliente_nombre}?`)) return;
    setError(''); setOk(''); setEntregando(p.id);
    const { data, error } = await supabase.rpc('pedido_entregar', { p_pedido: p.id });
    setEntregando('');
    if (error) return setError(mensajeError(error));
    setOk(`Pedido #${p.numero} entregado. Quedó como venta con folio #${(data as { folio: number }).folio}.`);
    cargar();
  }

  const m = (n: number) => dinero(n, negocio.moneda);
  const productos = (p: Pedido) => (p.pedido_productos || []).map((x) => `${x.cantidad} × ${x.nombre}`).join(', ');

  return (
    <div className="pagina">
      <Cabecera titulo="Pedidos para recoger">
        <button className="btn" onClick={cargar}>Actualizar</button>
      </Cabecera>
      <p className="tenue pequeno">
        Productos que tus clientes compraron y pagaron en línea desde{' '}
        <a href={`/r/${negocio.slug}/productos`} target="_blank" rel="noreferrer">tu página de productos</a>.
        Pide el número de pedido y entrégalo; se registra la venta y sale del inventario.
      </p>
      <Aviso>{error}</Aviso>
      <Aviso tipo="ok">{ok}</Aviso>

      {porEntregar === null ? null : porEntregar.length === 0 ? (
        <Vacio>No hay pedidos pendientes de entregar.</Vacio>
      ) : (
        <div className="lista-pedidos">
          {porEntregar.map((p) => {
            const wa = whatsapp(p.telefono, `Hola ${p.cliente_nombre.split(' ')[0]}, tu pedido #${p.numero} ya está listo para recoger en ${negocio.nombre}.`);
            return (
              <div key={p.id} className="tarjeta pedido">
                <div className="pedido-cabeza">
                  <span className="numero-pedido chico">#{p.numero}</span>
                  <div className="crece">
                    <strong>{p.cliente_nombre}</strong>
                    <div className="tenue pequeno">Pagó {m(p.total)} · {fechaCorta(p.pago_fecha || p.created_at)} {hora(p.pago_fecha || p.created_at)}</div>
                  </div>
                </div>
                <p>{productos(p)}</p>
                {p.notas && <p className="tenue pequeno">“{p.notas}”</p>}
                <div className="acciones">
                  {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">Avisar por WhatsApp</a>}
                  <button className="btn btn-primario" disabled={entregando === p.id} onClick={() => entregar(p)}>
                    {entregando === p.id ? 'Entregando…' : 'Entregar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {entregados.length > 0 && (
        <>
          <h2 className="subtitulo">Entregados recientemente</h2>
          <div className="tabla-scroll">
            <table className="tabla">
              <thead><tr><th>Pedido</th><th>Cliente</th><th>Productos</th><th className="num">Total</th><th>Entregado</th></tr></thead>
              <tbody>
                {entregados.map((p) => (
                  <tr key={p.id}>
                    <td>#{p.numero}</td><td>{p.cliente_nombre}</td><td>{productos(p)}</td>
                    <td className="num">{m(p.total)}</td>
                    <td>{p.entregado_en && `${fechaCorta(p.entregado_en)} ${hora(p.entregado_en)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
