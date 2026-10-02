import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, mensajeError, llamarPagos } from '../lib/supabase';
import type { Horario, ModoPago } from '../lib/tipos';
import { dinero, DIAS } from '../lib/formato';
import { Aviso, Campo, Cargando } from '../components/ui';

interface Info {
  negocio: { id: string; nombre: string; slug: string; telefono: string | null; direccion: string | null; logo_url: string | null; zona_horaria: string; moneda: string; horario: Horario; pago_en_linea: ModoPago; anticipo_pct: number };
  servicios: { id: string; nombre: string; descripcion: string | null; categoria: string | null; duracion_min: number; precio: number }[];
  barberos: { id: string; nombre: string; foto_url: string | null; color: string }[];
}
type Hueco = { inicio: string; barbero_id: string };
type Confirmacion = { id: string; inicio: string; servicio: string; barbero: string; precio: number };

/** Página pública: el cliente reserva sin crear cuenta. */
export default function Reservar() {
  const { slug = '' } = useParams();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [servicioId, setServicioId] = useState('');
  const [barberoId, setBarberoId] = useState<string>('');
  const [dia, setDia] = useState('');
  const [huecos, setHuecos] = useState<Hueco[] | null>(null);
  const [hueco, setHueco] = useState<Hueco | null>(null);
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<Confirmacion | null>(null);
  const formulario = useRef<HTMLFormElement>(null);

  useEffect(() => {
    supabase.rpc('reserva_negocio', { p_slug: slug }).then(({ data }) => {
      setInfo((data as Info) || null);
      if (data) document.title = `Reservar en ${(data as Info).negocio.nombre}`;
    });
  }, [slug]);

  const tz = info?.negocio.zona_horaria || 'America/Mexico_City';
  const diaEnTz = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const horaEnTz = (iso: string) => new Date(iso).toLocaleTimeString('es-MX', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
  const fechaEnTz = (iso: string) => new Date(iso).toLocaleDateString('es-MX', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' });

  // Próximos 21 días contados en la zona horaria de la barbería.
  const dias = Array.from({ length: 21 }, (_, i) => {
    const iso = diaEnTz(new Date(Date.now() + i * 864e5));
    return { iso, d: new Date(iso + 'T12:00:00') };
  });

  useEffect(() => {
    if (!servicioId || !dia) { setHuecos(null); return; }
    setHuecos(null); setHueco(null);
    supabase.rpc('reserva_horarios', { p_slug: slug, p_servicio: servicioId, p_barbero: barberoId || null, p_fecha: dia })
      .then(({ data, error }) => { if (error) setError(mensajeError(error)); setHuecos((data as Hueco[]) || []); });
  }, [slug, servicioId, barberoId, dia]);

  async function reservar(e: FormEvent) {
    e.preventDefault();
    if (!hueco) return;
    // Con pago obligatorio, Enter en el formulario también lleva a pagar.
    if (info?.negocio.pago_en_linea === 'obligatorio') return pagar();
    setError(''); setEnviando(true);
    const { data, error } = await supabase.rpc('reservar', {
      p_slug: slug, p_servicio: servicioId, p_barbero: barberoId || null, p_inicio: hueco.inicio,
      p_nombre: nombre, p_telefono: telefono, p_notas: notas || null,
    });
    setEnviando(false);
    if (error) {
      setError(mensajeError(error));
      setHueco(null);
      const d = dia; setDia(''); setTimeout(() => setDia(d)); // recarga horarios
      return;
    }
    setListo(data as Confirmacion);
  }

  /** Aparta el horario y manda al cliente a pagar a Mercado Pago. */
  async function pagar() {
    if (!hueco || !formulario.current?.reportValidity()) return;
    setError(''); setEnviando(true);
    try {
      const r = await llamarPagos<{ url: string }>({
        accion: 'crear', slug, servicio: servicioId, barbero: barberoId || null, inicio: hueco.inicio,
        nombre, telefono, notas: notas || null,
      });
      window.location.href = r.url;
    } catch (err) {
      setEnviando(false);
      setError(mensajeError(err));
      setHueco(null);
      const d = dia; setDia(''); setTimeout(() => setDia(d)); // recarga horarios
    }
  }

  if (info === undefined) return <Cargando />;
  if (info === null) {
    return (
      <div className="pantalla-centro">
        <div className="tarjeta acceso centro">
          <h2>Barbería no encontrada</h2>
          <p className="tenue">El enlace no existe o la barbería no está recibiendo reservas en línea por ahora.</p>
        </div>
      </div>
    );
  }

  const { negocio, servicios, barberos } = info;
  const serv = servicios.find((s) => s.id === servicioId);
  const m = (n: number) => dinero(n, negocio.moneda);
  const modoPago = negocio.pago_en_linea;
  const anticipo = serv ? Math.round(serv.precio * negocio.anticipo_pct) / 100 : 0;
  const cobraEnLinea = modoPago !== 'desactivado' && anticipo > 0;

  if (listo) {
    return (
      <div className="publica">
        <div className="tarjeta acceso centro">
          <div className="palomita" aria-hidden>✓</div>
          <h2>¡Listo, {nombre.split(' ')[0]}!</h2>
          <p>Tu cita en <strong>{negocio.nombre}</strong> quedó agendada:</p>
          <p className="grande-texto">{fechaEnTz(listo.inicio)}<br />{horaEnTz(listo.inicio)}</p>
          <p>{listo.servicio} con {listo.barbero} · {m(listo.precio)}</p>
          {negocio.direccion && <p className="tenue">{negocio.direccion}</p>}
          <p className="tenue pequeno">Guarda este enlace por si necesitas cancelar:</p>
          <Link to={`/r/${negocio.slug}/cancelar/${listo.id}`}>Cancelar mi cita</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="publica">
      <header className="publica-cabeza">
        <img src={negocio.logo_url || '/icon.svg'} alt="" width={48} height={48} />
        <div>
          <h1>{negocio.nombre}</h1>
          {negocio.direccion && <p className="tenue pequeno">{negocio.direccion}</p>}
        </div>
      </header>

      <section className="paso">
        <h2><span className="num-paso">1</span> Elige tu servicio</h2>
        <div className="opciones">
          {servicios.map((s) => (
            <button key={s.id} className={`opcion ${servicioId === s.id ? 'elegida' : ''}`} onClick={() => setServicioId(s.id)}>
              <div className="crece">
                <strong>{s.nombre}</strong>
                <div className="tenue pequeno">{s.duracion_min} min{s.descripcion && ` · ${s.descripcion}`}</div>
              </div>
              <strong>{m(s.precio)}</strong>
            </button>
          ))}
        </div>
      </section>

      {serv && barberos.length > 1 && (
        <section className="paso">
          <h2><span className="num-paso">2</span> ¿Con quién?</h2>
          <div className="chips">
            <button className={`chip ${!barberoId ? 'chip-activo' : ''}`} onClick={() => setBarberoId('')}>Cualquiera</button>
            {barberos.map((b) => (
              <button key={b.id} className={`chip ${barberoId === b.id ? 'chip-activo' : ''}`} onClick={() => setBarberoId(b.id)}>
                <span className="punto" style={{ background: b.color }} /> {b.nombre}
              </button>
            ))}
          </div>
        </section>
      )}

      {serv && (
        <section className="paso">
          <h2><span className="num-paso">{barberos.length > 1 ? 3 : 2}</span> Día y hora</h2>
          <div className="dias">
            {dias.map(({ iso, d }) => (
              <button key={iso} className={`dia ${dia === iso ? 'elegida' : ''}`} onClick={() => setDia(iso)}>
                <small>{DIAS[(d.getDay() + 6) % 7].slice(0, 3)}</small>
                <strong>{d.getDate()}</strong>
                <small>{d.toLocaleDateString('es-MX', { month: 'short' })}</small>
              </button>
            ))}
          </div>
          {dia && (huecos === null ? <Cargando /> : huecos.length === 0 ? (
            <p className="tenue">No hay horarios libres ese día. Prueba otro.</p>
          ) : (
            <div className="horas">
              {huecos.map((h) => (
                <button key={h.inicio} className={`hora ${hueco?.inicio === h.inicio ? 'elegida' : ''}`} onClick={() => setHueco(h)}>
                  {horaEnTz(h.inicio)}
                </button>
              ))}
            </div>
          ))}
        </section>
      )}

      {hueco && serv && (
        <form className="paso tarjeta formulario" onSubmit={reservar} ref={formulario}>
          <h2><span className="num-paso">{barberos.length > 1 ? 4 : 3}</span> Tus datos</h2>
          <p>
            <strong>{serv.nombre}</strong> el {fechaEnTz(hueco.inicio)} a las {horaEnTz(hueco.inicio)}
            {' '}con {barberos.find((b) => b.id === hueco.barbero_id)?.nombre} · {m(serv.precio)}
          </p>
          <Campo etiqueta="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" /></Campo>
          <Campo etiqueta="WhatsApp o teléfono"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} required inputMode="tel" autoComplete="tel" placeholder="10 dígitos" /></Campo>
          <Campo etiqueta="Comentario (opcional)"><input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
          {cobraEnLinea && (
            <div className="pago-resumen">
              {anticipo < serv.precio ? (
                <p>Para apartar se paga un anticipo de <strong>{m(anticipo)}</strong>; el resto ({m(serv.precio - anticipo)}) en la barbería.</p>
              ) : <p>Puedes pagar ahora <strong>{m(anticipo)}</strong> con tarjeta o Mercado Pago.</p>}
              <p className="tenue pequeno">Pago seguro con Mercado Pago. Tu horario queda apartado 20 minutos mientras pagas.</p>
            </div>
          )}
          <Aviso>{error}</Aviso>
          {cobraEnLinea ? (
            <>
              <button type="button" className="btn btn-primario ancho grande" disabled={enviando} onClick={pagar}>
                {enviando ? 'Abriendo Mercado Pago…' : `Pagar ${m(anticipo)} y reservar`}
              </button>
              {modoPago === 'opcional' && (
                <button className="btn ancho" disabled={enviando}>Reservar y pagar en la barbería</button>
              )}
            </>
          ) : (
            <button className="btn btn-primario ancho grande" disabled={enviando}>Confirmar reserva</button>
          )}
        </form>
      )}
      {!hueco && <Aviso>{error}</Aviso>}

      <footer className="publica-pie tenue pequeno">
        {negocio.telefono && <>¿Dudas? Llama al <a href={`tel:${negocio.telefono}`}>{negocio.telefono}</a> · </>}
        Reservas con BarberaGo
      </footer>
    </div>
  );
}
