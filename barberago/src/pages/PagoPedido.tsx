import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase, mensajeError, llamarPagos } from '../lib/supabase';
import { dinero } from '../lib/formato';
import { Aviso, Cargando } from '../components/ui';

type EstadoPedido = 'pendiente' | 'pagado' | 'entregado' | 'cancelado' | 'vencido' | 'reembolsar' | 'reembolsado';
interface Pedido {
  id: string; numero: number; total: number; estado: EstadoPedido; cliente: string;
  productos: { nombre: string; cantidad: number; precio: number }[];
  negocio: { nombre: string; slug: string; direccion: string | null; telefono: string | null; moneda: string; logo_url: string | null };
}

/** Página a la que Mercado Pago regresa al cliente después de pagar un pedido para recoger. */
export default function PagoPedido() {
  const { slug = '', pedido = '' } = useParams();
  const [params] = useSearchParams();
  const rechazado = ['rejected', 'failure', 'null'].includes(params.get('status') || params.get('collection_status') || '');
  const [p, setP] = useState<Pedido | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const intentos = useRef(0);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('pedido_estado', { p_pedido: pedido });
    setP((data as Pedido) || null);
    return data as Pedido | null;
  }, [pedido]);

  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout>;
    // Por si el aviso de Mercado Pago se atrasa, se le pregunta directo una vez.
    const verificar = rechazado ? Promise.resolve() : llamarPagos({ accion: 'verificar', pedido }).catch(() => undefined);
    const ciclo = async () => {
      const d = await cargar();
      if (!vivo) return;
      intentos.current += 1;
      if (d?.estado === 'pendiente' && !rechazado && intentos.current < 20) espera = setTimeout(ciclo, 3000);
    };
    verificar.then(ciclo);
    return () => { vivo = false; clearTimeout(espera); };
  }, [pedido, cargar, rechazado]);

  async function reintentar() {
    setError(''); setEnviando(true);
    try {
      const res = await llamarPagos<{ url: string }>({ accion: 'reintentar', pedido });
      window.location.href = res.url;
    } catch (err) {
      setEnviando(false);
      setError(mensajeError(err));
      cargar();
    }
  }

  if (p === undefined) return <Cargando />;
  if (p === null) {
    return (
      <div className="pantalla-centro">
        <div className="tarjeta acceso centro">
          <h2>No encontramos tu pedido</h2>
          <Link className="btn btn-primario" to={`/r/${slug}/productos`}>Ver productos</Link>
        </div>
      </div>
    );
  }

  const m = (n: number) => dinero(n, p.negocio.moneda);
  const lista = (
    <ul className="lista-simple">
      {p.productos.map((x) => <li key={x.nombre}>{x.cantidad} × {x.nombre} <span className="tenue">{m(x.precio * x.cantidad)}</span></li>)}
    </ul>
  );

  return (
    <div className="publica">
      <div className="tarjeta acceso centro">
        {p.estado === 'pagado' || p.estado === 'entregado' ? (
          <>
            <div className="palomita" aria-hidden>✓</div>
            <h2>{p.estado === 'entregado' ? 'Pedido entregado' : `¡Pagado${p.cliente ? `, ${p.cliente}` : ''}!`}</h2>
            <p>Tu número de pedido es</p>
            <p className="numero-pedido">#{p.numero}</p>
            {lista}
            <p>Pagaste <strong>{m(p.total)}</strong></p>
            {p.estado === 'pagado' && (
              <div className="recoger">
                <p><strong>Recógelo en {p.negocio.nombre}</strong></p>
                {p.negocio.direccion && <p className="pequeno">{p.negocio.direccion}</p>}
                <p className="tenue pequeno">Muestra tu número de pedido en la barbería. Guarda esta página para tenerlo a la mano.</p>
              </div>
            )}
            {p.negocio.telefono && <p className="tenue pequeno">¿Dudas? Llama al <a href={`tel:${p.negocio.telefono}`}>{p.negocio.telefono}</a></p>}
          </>
        ) : p.estado === 'pendiente' ? (
          <>
            <h2>{rechazado ? 'No se completó el pago' : 'Confirmando tu pago…'}</h2>
            <p>
              {rechazado
                ? 'Mercado Pago no aprobó el pago. Tus productos siguen apartados unos minutos; puedes intentar de nuevo con otra tarjeta.'
                : 'Estamos esperando la confirmación de Mercado Pago. Esto suele tardar unos segundos.'}
            </p>
            {lista}
            <Aviso>{error}</Aviso>
            <button className="btn btn-primario ancho grande" onClick={reintentar} disabled={enviando}>
              {enviando ? 'Abriendo Mercado Pago…' : `Pagar ${m(p.total)}`}
            </button>
            {!rechazado && <button className="btn-texto" onClick={() => cargar()}>Ya pagué, revisar otra vez</button>}
          </>
        ) : p.estado === 'reembolsar' || p.estado === 'reembolsado' ? (
          <>
            <h2>Te devolvimos tu pago</h2>
            <p>El pago llegó cuando ya no había existencia suficiente, así que Mercado Pago te regresa el dinero.</p>
            <Link className="btn btn-primario" to={`/r/${p.negocio.slug}/productos`}>Ver productos</Link>
          </>
        ) : (
          <>
            <h2>El pedido venció</h2>
            <p>No recibimos el pago a tiempo y los productos se liberaron. Puedes hacer tu pedido de nuevo.</p>
            <Link className="btn btn-primario" to={`/r/${p.negocio.slug}/productos`}>Hacer otro pedido</Link>
          </>
        )}
      </div>
    </div>
  );
}
