import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import type { Cita, Producto } from '../lib/tipos';
import { dinero, fechaLarga, hora } from '../lib/formato';
import { Aviso, Cabecera, Campo } from '../components/ui';
import ClienteBuscador, { asegurarCliente, type ClienteElegido } from '../components/ClienteBuscador';

type Partida = { clave: string; tipo: 'servicio' | 'producto'; id: string; nombre: string; precio: number; cantidad: number; barberoId: string };
type Metodo = 'efectivo' | 'tarjeta' | 'transferencia';
type Ticket = { folio: number; total: number; partidas: Partida[]; propina: number; descuento: number; metodo: Metodo; cliente: string; recibido: number; enLinea: number };

export default function Cobrar() {
  const { negocio, barberos, servicios, miembro } = useNegocio();
  const [params, setParams] = useSearchParams();
  const citaId = params.get('cita');
  const activos = barberos.filter((b) => b.activo);
  const [productos, setProductos] = useState<Producto[]>([]);
  const [cita, setCita] = useState<Cita | null>(null);
  const [cliente, setCliente] = useState<ClienteElegido>({ id: null, nombre: '', telefono: '' });
  const [barberoId, setBarberoId] = useState(miembro.barbero_id || activos[0]?.id || '');
  const [partidas, setPartidas] = useState<Partida[]>([]);
  const [descuento, setDescuento] = useState(0);
  const [propina, setPropina] = useState(0);
  const [metodo, setMetodo] = useState<Metodo>('efectivo');
  const [recibido, setRecibido] = useState(0);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [pendientes, setPendientes] = useState<Cita[]>([]);

  useEffect(() => {
    supabase.from('productos').select('*').eq('negocio_id', negocio.id).eq('activo', true).order('nombre')
      .then(({ data }) => setProductos((data as Producto[]) || []));
    // Citas de hoy listas para cobrar.
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    const manana = new Date(hoy.getTime() + 864e5);
    supabase.from('citas').select('*, clientes(nombre, telefono)').eq('negocio_id', negocio.id)
      .in('estado', ['en_curso', 'confirmada', 'pendiente']).gte('inicio', hoy.toISOString()).lt('inicio', manana.toISOString()).order('inicio')
      .then(({ data }) => setPendientes(((data as Cita[]) || []).filter((c) => c.pago_estado !== 'pendiente')));
  }, [negocio.id, ticket]);

  useEffect(() => {
    if (!citaId) { setCita(null); return; }
    supabase.from('citas').select('*, clientes(nombre, telefono)').eq('id', citaId).maybeSingle().then(({ data }) => {
      const c = data as Cita | null;
      setCita(c);
      if (!c) return;
      setCliente({ id: c.cliente_id, nombre: c.clientes?.nombre || c.cliente_nombre || '', telefono: c.clientes?.telefono || '' });
      if (c.barbero_id) setBarberoId(c.barbero_id);
      const s = servicios.find((x) => x.id === c.servicio_id);
      if (s) {
        setPartidas([{ clave: crypto.randomUUID(), tipo: 'servicio', id: s.id, nombre: s.nombre, precio: Number(c.precio ?? s.precio), cantidad: 1, barberoId: c.barbero_id || '' }]);
      }
    });
  }, [citaId, servicios]);

  const subtotal = useMemo(() => partidas.reduce((a, p) => a + p.precio * p.cantidad, 0), [partidas]);
  const total = Math.max(subtotal - descuento, 0) + propina;
  // Lo que el cliente ya pagó al reservar en línea se descuenta de lo que se cobra aquí.
  const enLinea = cita?.pago_estado === 'pagado' ? Math.min(Number(cita.pago_monto || 0), total) : 0;
  const porCobrar = total - enLinea;
  const cambio = metodo === 'efectivo' && recibido > porCobrar ? recibido - porCobrar : 0;

  function agregar(tipo: 'servicio' | 'producto', id: string, nombre: string, precio: number) {
    setPartidas((ps) => {
      const ya = ps.find((p) => p.tipo === tipo && p.id === id && p.barberoId === barberoId);
      if (ya && tipo === 'producto') return ps.map((p) => (p === ya ? { ...p, cantidad: p.cantidad + 1 } : p));
      return [...ps, { clave: crypto.randomUUID(), tipo, id, nombre, precio: Number(precio), cantidad: 1, barberoId }];
    });
  }

  function limpiar() {
    setPartidas([]); setDescuento(0); setPropina(0); setRecibido(0); setNotas(''); setError('');
    setCliente({ id: null, nombre: '', telefono: '' }); setCita(null);
    if (citaId) setParams({});
  }

  async function cobrar() {
    setError('');
    if (!partidas.length) return setError('Agrega al menos un servicio o producto');
    setEnviando(true);
    try {
      const clienteId = await asegurarCliente(negocio.id, cliente);
      const { data, error } = await supabase.rpc('cobrar', {
        p_negocio: negocio.id,
        p_items: partidas.map((p) => ({ tipo: p.tipo, id: p.id, cantidad: p.cantidad, precio: p.precio, barbero_id: p.barberoId || null })),
        p_metodo: metodo, p_propina: propina, p_descuento: descuento,
        p_cliente: clienteId, p_barbero: barberoId || null, p_cita: cita?.id || null, p_notas: notas || null,
      });
      if (error) throw error;
      const r = data as { folio: number; total: number; pagado_en_linea: number };
      setTicket({ folio: r.folio, total: r.total, partidas, propina, descuento, metodo, cliente: cliente.nombre, recibido, enLinea: Number(r.pagado_en_linea || 0) });
      limpiar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  if (ticket) {
    return (
      <div className="pagina angosta">
        <div className="tarjeta ticket" id="ticket">
          <h2>{negocio.nombre}</h2>
          {negocio.direccion && <p className="tenue pequeno">{negocio.direccion}</p>}
          <p>Folio <strong>#{ticket.folio}</strong> · {fechaLarga(new Date())} {hora(new Date())}</p>
          {ticket.cliente && <p>Cliente: {ticket.cliente}</p>}
          <table className="tabla">
            <tbody>
              {ticket.partidas.map((p) => (
                <tr key={p.clave}><td>{p.cantidad} × {p.nombre}</td><td className="num">{dinero(p.precio * p.cantidad, negocio.moneda)}</td></tr>
              ))}
              {ticket.descuento > 0 && <tr><td>Descuento</td><td className="num">−{dinero(ticket.descuento, negocio.moneda)}</td></tr>}
              {ticket.propina > 0 && <tr><td>Propina</td><td className="num">{dinero(ticket.propina, negocio.moneda)}</td></tr>}
              {ticket.enLinea > 0 ? (
                <>
                  <tr className="total"><td>Total</td><td className="num">{dinero(ticket.total, negocio.moneda)}</td></tr>
                  <tr><td>Pagado en línea</td><td className="num">−{dinero(ticket.enLinea, negocio.moneda)}</td></tr>
                  <tr className="total"><td>Pagado aquí ({ticket.metodo})</td><td className="num">{dinero(ticket.total - ticket.enLinea, negocio.moneda)}</td></tr>
                </>
              ) : <tr className="total"><td>Total ({ticket.metodo})</td><td className="num">{dinero(ticket.total, negocio.moneda)}</td></tr>}
              {ticket.metodo === 'efectivo' && ticket.recibido > ticket.total - ticket.enLinea && (
                <tr><td>Cambio</td><td className="num">{dinero(ticket.recibido - (ticket.total - ticket.enLinea), negocio.moneda)}</td></tr>
              )}
            </tbody>
          </table>
          <p className="tenue pequeno centro">¡Gracias por tu visita!</p>
        </div>
        <div className="acciones no-imprimir">
          <button className="btn" onClick={() => window.print()}>Imprimir</button>
          <button className="btn btn-primario" onClick={() => setTicket(null)}>Nuevo cobro</button>
        </div>
      </div>
    );
  }

  return (
    <div className="pagina">
      <Cabecera titulo="Cobrar">
        {partidas.length > 0 && <button className="btn" onClick={limpiar}>Limpiar</button>}
      </Cabecera>

      {!cita && pendientes.length > 0 && (
        <div className="chips">
          <span className="tenue pequeno">Citas de hoy:</span>
          {pendientes.map((c) => (
            <button key={c.id} className="chip" onClick={() => setParams({ cita: c.id })}>
              {hora(c.inicio)} {c.clientes?.nombre || c.cliente_nombre}
            </button>
          ))}
        </div>
      )}

      <div className="cobro">
        <section className="tarjeta">
          <h2>Servicios</h2>
          <div className="botonera">
            {servicios.filter((s) => s.activo).map((s) => (
              <button key={s.id} className="boton-item" onClick={() => agregar('servicio', s.id, s.nombre, s.precio)}>
                <strong>{s.nombre}</strong><span>{dinero(s.precio, negocio.moneda)}</span>
              </button>
            ))}
          </div>
          {productos.length > 0 && (
            <>
              <h2 className="mt">Productos</h2>
              <div className="botonera">
                {productos.map((p) => (
                  <button key={p.id} className="boton-item" onClick={() => agregar('producto', p.id, p.nombre, p.precio)}>
                    <strong>{p.nombre}</strong>
                    <span>{dinero(p.precio, negocio.moneda)} · {p.stock} en stock</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="tarjeta cuenta">
          {cita && <Aviso tipo="info">Cobrando la cita de las {hora(cita.inicio)}</Aviso>}
          {enLinea > 0 && <Aviso tipo="ok">Ya pagó {dinero(enLinea, negocio.moneda)} en línea al reservar.</Aviso>}
          <Campo etiqueta="Cliente"><ClienteBuscador negocioId={negocio.id} valor={cliente} onCambio={setCliente} /></Campo>
          <Campo etiqueta="Barbero (recibe la propina)">
            <select value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
              {activos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
            </select>
          </Campo>

          {partidas.length === 0 ? <p className="tenue">Toca un servicio o producto para agregarlo.</p> : (
            <ul className="partidas">
              {partidas.map((p) => (
                <li key={p.clave}>
                  <div className="crece">
                    <strong>{p.nombre}</strong>
                    {activos.length > 1 && (
                      <select className="mini" value={p.barberoId} aria-label="Barbero de la partida"
                        onChange={(e) => setPartidas((ps) => ps.map((x) => (x === p ? { ...x, barberoId: e.target.value } : x)))}>
                        {activos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
                      </select>
                    )}
                  </div>
                  <input className="cant" type="number" min={1} value={p.cantidad} aria-label="Cantidad"
                    onChange={(e) => setPartidas((ps) => ps.map((x) => (x === p ? { ...x, cantidad: Math.max(1, Number(e.target.value)) } : x)))} />
                  <input className="precio" type="number" min={0} step="0.5" value={p.precio} aria-label="Precio"
                    onChange={(e) => setPartidas((ps) => ps.map((x) => (x === p ? { ...x, precio: Math.max(0, Number(e.target.value)) } : x)))} />
                  <button className="btn-icono" onClick={() => setPartidas((ps) => ps.filter((x) => x !== p))} aria-label="Quitar">✕</button>
                </li>
              ))}
            </ul>
          )}

          <div className="fila-campos">
            <Campo etiqueta="Descuento"><input type="number" min={0} value={descuento} onChange={(e) => setDescuento(Math.max(0, Number(e.target.value)))} /></Campo>
            <Campo etiqueta="Propina"><input type="number" min={0} value={propina} onChange={(e) => setPropina(Math.max(0, Number(e.target.value)))} /></Campo>
          </div>
          <div className="chips">
            {[0, 10, 15, 20].map((pct) => (
              <button key={pct} className="chip" onClick={() => setPropina(Math.round((subtotal - descuento) * pct) / 100)}>
                {pct ? `${pct}%` : 'Sin propina'}
              </button>
            ))}
          </div>

          <div className="segmentado" role="radiogroup" aria-label="Método de pago">
            {(['efectivo', 'tarjeta', 'transferencia'] as Metodo[]).map((m) => (
              <button key={m} role="radio" aria-checked={metodo === m} className={metodo === m ? 'activo' : ''} onClick={() => setMetodo(m)}>
                {m === 'efectivo' ? 'Efectivo' : m === 'tarjeta' ? 'Tarjeta' : 'Transferencia'}
              </button>
            ))}
          </div>
          {metodo === 'efectivo' && (
            <Campo etiqueta="Recibido"><input type="number" min={0} value={recibido || ''} onChange={(e) => setRecibido(Number(e.target.value))} placeholder="Para calcular el cambio" /></Campo>
          )}
          <Campo etiqueta="Nota"><input value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>

          <div className="totales">
            <div><span>Subtotal</span><span>{dinero(subtotal, negocio.moneda)}</span></div>
            {descuento > 0 && <div><span>Descuento</span><span>−{dinero(descuento, negocio.moneda)}</span></div>}
            {propina > 0 && <div><span>Propina</span><span>{dinero(propina, negocio.moneda)}</span></div>}
            <div className="total"><span>Total</span><span>{dinero(total, negocio.moneda)}</span></div>
            {enLinea > 0 && <div><span>Pagado en línea</span><span>−{dinero(enLinea, negocio.moneda)}</span></div>}
            {enLinea > 0 && <div className="total"><span>Por cobrar</span><span>{dinero(porCobrar, negocio.moneda)}</span></div>}
            {cambio > 0 && <div><span>Cambio</span><span>{dinero(cambio, negocio.moneda)}</span></div>}
          </div>
          <Aviso>{error}</Aviso>
          <button className="btn btn-primario ancho grande" onClick={cobrar} disabled={enviando || !partidas.length}>
            {enLinea > 0 && porCobrar <= 0 ? 'Cerrar venta (ya pagada)' : `Cobrar ${dinero(porCobrar, negocio.moneda)}`}
          </button>
        </section>
      </div>
    </div>
  );
}
