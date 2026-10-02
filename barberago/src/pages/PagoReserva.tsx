import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { supabase, mensajeError, llamarPagos } from '../lib/supabase';
import type { EstadoPago } from '../lib/tipos';
import { dinero } from '../lib/formato';
import { Aviso, Cargando } from '../components/ui';

interface EstadoReserva {
  id: string; inicio: string; estado: string; precio: number | null; pago_monto: number | null;
  pago_estado: EstadoPago | null; pago_expira: string | null; cliente: string; servicio: string | null; barbero: string | null;
  productos?: { nombre: string; cantidad: number; precio: number }[];
  negocio: { nombre: string; slug: string; direccion: string | null; telefono: string | null; zona_horaria: string; moneda: string; logo_url: string | null };
}

/** Página a la que Mercado Pago regresa al cliente después de pagar (o de no pagar). */
export default function PagoReserva() {
  const { slug = '', cita = '' } = useParams();
  const [params] = useSearchParams();
  const rechazado = ['rejected', 'failure', 'null'].includes(params.get('status') || params.get('collection_status') || '');
  const [r, setR] = useState<EstadoReserva | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const intentos = useRef(0);

  const cargar = useCallback(async () => {
    const { data } = await supabase.rpc('reserva_estado', { p_cita: cita });
    setR((data as EstadoReserva) || null);
    return data as EstadoReserva | null;
  }, [cita]);

  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout>;
    // Por si el aviso de Mercado Pago se atrasa, se le pregunta directo una vez.
    const verificar = rechazado ? Promise.resolve() : llamarPagos({ accion: 'verificar', cita }).catch(() => undefined);
    const ciclo = async () => {
      const d = await cargar();
      if (!vivo) return;
      intentos.current += 1;
      // Mientras siga pendiente (y no fue rechazado), vuelve a revisar unos segundos.
      if (d?.pago_estado === 'pendiente' && !rechazado && intentos.current < 20) espera = setTimeout(ciclo, 3000);
    };
    verificar.then(ciclo);
    return () => { vivo = false; clearTimeout(espera); };
  }, [cita, cargar, rechazado]);

  async function reintentar() {
    setError(''); setEnviando(true);
    try {
      const res = await llamarPagos<{ url: string }>({ accion: 'reintentar', cita });
      window.location.href = res.url;
    } catch (err) {
      setEnviando(false);
      setError(mensajeError(err));
      cargar();
    }
  }

  if (r === undefined) return <Cargando />;
  if (r === null) {
    return (
      <div className="pantalla-centro">
        <div className="tarjeta acceso centro">
          <h2>No encontramos tu reserva</h2>
          <Link className="btn btn-primario" to={`/r/${slug}`}>Reservar</Link>
        </div>
      </div>
    );
  }

  const tz = r.negocio.zona_horaria;
  const fecha = new Date(r.inicio).toLocaleDateString('es-MX', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });
  const horaTxt = new Date(r.inicio).toLocaleTimeString('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const m = (n: number | null) => dinero(n, r.negocio.moneda);
  const productos = r.productos || [];
  const totalProductos = productos.reduce((a, p) => a + Number(p.precio) * p.cantidad, 0);
  // Los productos se pagan completos; lo que falte es del servicio.
  const resto = Number(r.precio || 0) - (Number(r.pago_monto || 0) - totalProductos);
  const listaProductos = productos.length > 0 && (
    <p className="pequeno">Productos: {productos.map((p) => `${p.cantidad} × ${p.nombre}`).join(', ')}. Te los entregan en tu cita.</p>
  );
  const pagada = r.pago_estado === 'pagado';

  return (
    <div className="publica">
      <div className="tarjeta acceso centro">
        {pagada ? (
          <>
            <div className="palomita" aria-hidden>✓</div>
            <h2>¡Pagado y reservado{r.cliente ? `, ${r.cliente}` : ''}!</h2>
            <p>Tu cita en <strong>{r.negocio.nombre}</strong> quedó confirmada:</p>
            <p className="grande-texto">{fecha}<br />{horaTxt}</p>
            <p>{r.servicio}{r.barbero && ` con ${r.barbero}`}</p>
            {listaProductos}
            <p>Pagaste <strong>{m(r.pago_monto)}</strong>{resto > 0.009 && <> · en la barbería pagas {m(resto)}</>}</p>
            {r.negocio.direccion && <p className="tenue">{r.negocio.direccion}</p>}
            <p className="tenue pequeno">
              Si necesitas cambiar o cancelar, comunícate con la barbería
              {r.negocio.telefono && <> al <a href={`tel:${r.negocio.telefono}`}>{r.negocio.telefono}</a></>}.
            </p>
          </>
        ) : r.pago_estado === 'pendiente' ? (
          <>
            <h2>{rechazado ? 'No se completó el pago' : 'Confirmando tu pago…'}</h2>
            <p>
              {rechazado
                ? 'Mercado Pago no aprobó el pago. Tu horario sigue apartado unos minutos; puedes intentar de nuevo con otra tarjeta.'
                : 'Estamos esperando la confirmación de Mercado Pago. Esto suele tardar unos segundos.'}
            </p>
            <p className="grande-texto">{fecha}<br />{horaTxt}</p>
            <p>{r.servicio}{productos.length > 0 && ` + ${productos.reduce((a, p) => a + p.cantidad, 0)} producto(s)`} · {m(r.pago_monto)}</p>
            <Aviso>{error}</Aviso>
            <button className="btn btn-primario ancho grande" onClick={reintentar} disabled={enviando}>
              {enviando ? 'Abriendo Mercado Pago…' : `Pagar ${m(r.pago_monto)}`}
            </button>
            {!rechazado && <button className="btn-texto" onClick={() => cargar()}>Ya pagué, revisar otra vez</button>}
          </>
        ) : r.pago_estado === 'reembolsar' || r.pago_estado === 'reembolsado' ? (
          <>
            <h2>Te devolvimos tu pago</h2>
            <p>El pago llegó cuando el horario ya se había liberado y alguien más lo tomó, así que Mercado Pago te regresa el dinero.</p>
            <Link className="btn btn-primario" to={`/r/${r.negocio.slug}`}>Elegir otro horario</Link>
          </>
        ) : (
          <>
            <h2>El apartado venció</h2>
            <p>No recibimos el pago a tiempo y el horario se liberó. Puedes reservar de nuevo.</p>
            <Link className="btn btn-primario" to={`/r/${r.negocio.slug}`}>Reservar de nuevo</Link>
          </>
        )}
      </div>
    </div>
  );
}
