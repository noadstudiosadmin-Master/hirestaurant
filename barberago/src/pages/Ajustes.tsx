import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import { fechaCorta } from '../lib/formato';
import { Aviso, Cabecera, Campo } from '../components/ui';
import HorarioEditor from '../components/HorarioEditor';
import PagosAjustes from '../components/PagosAjustes';

const ZONAS = ['America/Mexico_City', 'America/Monterrey', 'America/Cancun', 'America/Chihuahua', 'America/Hermosillo', 'America/Mazatlan', 'America/Tijuana',
  'America/Bogota', 'America/Lima', 'America/Santiago', 'America/Argentina/Buenos_Aires', 'America/Guatemala', 'America/Los_Angeles', 'America/New_York', 'Europe/Madrid'];

export default function Ajustes() {
  const { negocio, recargar, suscripcion, session } = useNegocio();
  const [f, setF] = useState({
    nombre: negocio.nombre, slug: negocio.slug, telefono: negocio.telefono || '', direccion: negocio.direccion || '',
    zona_horaria: negocio.zona_horaria, moneda: negocio.moneda, intervalo_min: negocio.intervalo_min,
    anticipacion_min: negocio.anticipacion_min, reserva_online: negocio.reserva_online,
  });
  const [horario, setHorario] = useState(negocio.horario);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [codigo, setCodigo] = useState('');
  const enlace = `${window.location.origin}/r/${negocio.slug}`;
  const esDueno = negocio.creado_por === session?.user.id;

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk('');
    const { error } = await supabase.from('negocios').update({
      ...f, nombre: f.nombre.trim(), slug: f.slug.trim().toLowerCase(), telefono: f.telefono.trim() || null, direccion: f.direccion.trim() || null, horario,
    }).eq('id', negocio.id);
    if (error) return setError(mensajeError(error).includes('slug') ? 'El enlace solo admite minúsculas, números y guiones (3 a 40)' : mensajeError(error));
    setOk('Cambios guardados.');
    recargar();
  }

  async function canjear(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk('');
    const { error } = await supabase.rpc('canjear_codigo', { p_codigo: codigo });
    if (error) return setError(mensajeError(error));
    setCodigo(''); setOk('Código aplicado a tu plan.');
    recargar();
  }

  async function compartir() {
    const datos = { title: negocio.nombre, text: `Reserva tu cita en ${negocio.nombre}`, url: enlace };
    if (navigator.share) { try { await navigator.share(datos); } catch { /* cancelado */ } }
    else { await navigator.clipboard.writeText(enlace); setOk('Enlace copiado.'); }
  }

  return (
    <div className="pagina angosta">
      <Cabecera titulo="Ajustes" />

      <section className="tarjeta">
        <h2>Reservas en línea</h2>
        <p>Comparte este enlace en Instagram, WhatsApp o Google Maps:</p>
        <div className="enlace-reserva">
          <a href={`/r/${negocio.slug}`} target="_blank" rel="noreferrer">{enlace}</a>
          <button className="btn btn-chico" onClick={compartir}>Compartir</button>
        </div>
      </section>

      <PagosAjustes />

      <form onSubmit={guardar} className="tarjeta formulario">
        <h2>Datos de la barbería</h2>
        <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required maxLength={60} /></Campo>
        <Campo etiqueta="Enlace de reservas" ayuda={`${window.location.origin}/r/${f.slug || '…'}`}>
          <input value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} required minLength={3} maxLength={40} />
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" /></Campo>
          <Campo etiqueta="Moneda">
            <select value={f.moneda} onChange={(e) => setF({ ...f, moneda: e.target.value })}>
              {['MXN', 'USD', 'COP', 'PEN', 'CLP', 'ARS', 'GTQ', 'EUR'].map((m) => <option key={m}>{m}</option>)}
            </select>
          </Campo>
        </div>
        <Campo etiqueta="Dirección"><input value={f.direccion} onChange={(e) => setF({ ...f, direccion: e.target.value })} /></Campo>
        <Campo etiqueta="Zona horaria">
          <select value={f.zona_horaria} onChange={(e) => setF({ ...f, zona_horaria: e.target.value })}>
            {ZONAS.map((z) => <option key={z}>{z}</option>)}
          </select>
        </Campo>
        <h3>Horario de la barbería</h3>
        <HorarioEditor valor={horario} onCambio={setHorario} />
        <h3>Reglas de reserva</h3>
        <label className="check"><input type="checkbox" checked={f.reserva_online} onChange={(e) => setF({ ...f, reserva_online: e.target.checked })} /> Recibir reservas en línea</label>
        <div className="fila-campos">
          <Campo etiqueta="Horarios cada">
            <select value={f.intervalo_min} onChange={(e) => setF({ ...f, intervalo_min: Number(e.target.value) })}>
              {[5, 10, 15, 20, 30, 60].map((n) => <option key={n} value={n}>{n} min</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Anticipación mínima">
            <select value={f.anticipacion_min} onChange={(e) => setF({ ...f, anticipacion_min: Number(e.target.value) })}>
              {[0, 30, 60, 120, 240, 720, 1440].map((n) => <option key={n} value={n}>{n === 0 ? 'Sin mínimo' : n < 60 ? `${n} min` : `${n / 60} h`}</option>)}
            </select>
          </Campo>
        </div>
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{ok}</Aviso>
        <button className="btn btn-primario">Guardar</button>
      </form>

      {esDueno && (
        <section className="tarjeta">
          <h2>Plan</h2>
          {suscripcion ? (
            <p>Plan <strong>{suscripcion.plan}</strong>, hasta {suscripcion.negocios_max} sucursal(es). Vence el <strong>{fechaCorta(suscripcion.vence)}</strong>.</p>
          ) : <p>Sin plan activo.</p>}
          <form onSubmit={canjear} className="fila">
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="Código de activación" required aria-label="Código" />
            <button className="btn">Canjear</button>
          </form>
          <p className="mt"><Link to="/nueva-barberia">+ Agregar otra sucursal</Link></p>
        </section>
      )}
    </div>
  );
}
