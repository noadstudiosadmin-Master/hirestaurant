import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import { ESTADOS, apartadoVencido, type Barbero, type Bloqueo, type Cita, type EstadoCita } from '../lib/tipos';
import { deIsoDia, diaIso, dinero, fechaLarga, hora, isoDia, minutos, sumarDias, whatsapp } from '../lib/formato';
import { Aviso, Campo, Modal } from '../components/ui';
import ClienteBuscador, { asegurarCliente, type ClienteElegido } from '../components/ClienteBuscador';

const PX_MIN = 1.3; // alto en píxeles de cada minuto en la agenda
const ACTIVAS: EstadoCita[] = ['pendiente', 'confirmada', 'en_curso', 'completada', 'no_asistio'];

type Borrador = { cita?: Cita; barberoId: string | null; inicio: Date };

export default function Agenda() {
  const { negocio, miembro, barberos, servicios, puede } = useNegocio();
  const navegar = useNavigate();
  const [dia, setDia] = useState(isoDia(new Date()));
  const [citas, setCitas] = useState<Cita[]>([]);
  const [fila, setFila] = useState<Cita[]>([]);
  const [bloqueos, setBloqueos] = useState<Bloqueo[]>([]);
  const [soloMia, setSoloMia] = useState(miembro.rol === 'barbero' && !!miembro.barbero_id);
  const [barberoMovil, setBarberoMovil] = useState<string | null>(miembro.barbero_id);
  const [borrador, setBorrador] = useState<Borrador | null>(null);
  const [detalle, setDetalle] = useState<Cita | null>(null);
  const [nuevoEnFila, setNuevoEnFila] = useState(false);
  const [bloquear, setBloquear] = useState(false);
  const [ahora, setAhora] = useState(new Date());

  const fecha = deIsoDia(dia);
  const esHoy = dia === isoDia(new Date());
  const activos = barberos.filter((b) => b.activo);
  const visibles = soloMia && miembro.barbero_id ? activos.filter((b) => b.id === miembro.barbero_id) : activos;

  const cargar = useCallback(async () => {
    const desde = deIsoDia(dia);
    const hasta = sumarDias(desde, 1);
    const [c, f, b] = await Promise.all([
      supabase.from('citas').select('*, clientes(nombre, telefono)').eq('negocio_id', negocio.id)
        .gte('inicio', desde.toISOString()).lt('inicio', hasta.toISOString()).in('estado', ACTIVAS).order('inicio'),
      supabase.from('citas').select('*, clientes(nombre, telefono)').eq('negocio_id', negocio.id)
        .eq('estado', 'en_espera').order('created_at'),
      supabase.from('bloqueos').select('*').eq('negocio_id', negocio.id)
        .lt('inicio', hasta.toISOString()).gt('fin', desde.toISOString()),
    ]);
    // Los apartados en línea que vencieron sin pagarse ya no ocupan lugar.
    setCitas(((c.data as Cita[]) || []).filter((x) => !apartadoVencido(x)));
    setFila((f.data as Cita[]) || []);
    setBloqueos((b.data as Bloqueo[]) || []);
  }, [dia, negocio.id]);

  useEffect(() => { cargar(); }, [cargar]);

  // En vivo: cualquier cambio de citas en otro dispositivo recarga la agenda.
  useEffect(() => {
    const canal = supabase.channel(`citas-${negocio.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'citas', filter: `negocio_id=eq.${negocio.id}` }, () => cargar())
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [negocio.id, cargar]);

  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  // Rango visible: del primer horario de apertura al último cierre del día (negocio y barberos).
  const [minIni, minFin] = useMemo(() => {
    const k = diaIso(fecha);
    const tramos = [negocio.horario, ...activos.map((b) => b.horario)].flatMap((h) => (h?.[k] || []));
    let ini = tramos.length ? Math.min(...tramos.map((t) => minutos(t[0]))) : 9 * 60;
    let fin = tramos.length ? Math.max(...tramos.map((t) => minutos(t[1]))) : 21 * 60;
    for (const c of citas) {
      const i = new Date(c.inicio), f = new Date(c.fin);
      ini = Math.min(ini, i.getHours() * 60 + i.getMinutes());
      fin = Math.max(fin, f.getHours() * 60 + f.getMinutes());
    }
    return [Math.floor(ini / 60) * 60, Math.ceil(fin / 60) * 60];
  }, [fecha, negocio.horario, activos, citas]);

  const horas: number[] = [];
  for (let m = minIni; m < minFin; m += 60) horas.push(m);
  const altura = (minFin - minIni) * PX_MIN;
  const minDe = (iso: string) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };

  function clicColumna(b: Barbero, e: React.MouseEvent<HTMLDivElement>) {
    if (!puede('agenda')) return;
    if ((e.target as HTMLElement).closest('.cita, .bloqueo')) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    const paso = negocio.intervalo_min;
    const m = minIni + Math.floor(y / PX_MIN / paso) * paso;
    const inicio = new Date(fecha);
    inicio.setHours(0, m, 0, 0);
    setBorrador({ barberoId: b.id, inicio });
  }

  const columnaMovil = visibles.find((b) => b.id === barberoMovil) || visibles[0];

  return (
    <div className="pagina agenda">
      <div className="cabecera">
        <div className="navegador-dia">
          <button className="btn-icono" onClick={() => setDia(isoDia(sumarDias(fecha, -1)))} aria-label="Día anterior">‹</button>
          <div>
            <h1 className="titulo-dia">{fechaLarga(fecha)}</h1>
            {!esHoy && <button className="btn-texto" onClick={() => setDia(isoDia(new Date()))}>Ir a hoy</button>}
          </div>
          <button className="btn-icono" onClick={() => setDia(isoDia(sumarDias(fecha, 1)))} aria-label="Día siguiente">›</button>
          <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Elegir día" />
        </div>
        <div className="cabecera-acciones">
          {miembro.barbero_id && (
            <label className="check"><input type="checkbox" checked={soloMia} onChange={(e) => setSoloMia(e.target.checked)} /> Solo mi agenda</label>
          )}
          {puede('agenda') && <button className="btn" onClick={() => setBloquear(true)}>Bloquear horario</button>}
          {puede('agenda') && <button className="btn" onClick={() => setNuevoEnFila(true)}>+ Sin cita</button>}
          {puede('agenda') && (
            <button className="btn btn-primario" onClick={() => {
              const inicio = new Date(fecha);
              const base = esHoy ? new Date() : new Date(fecha.getTime() + minIni * 60000);
              const paso = negocio.intervalo_min;
              inicio.setHours(base.getHours(), Math.ceil(base.getMinutes() / paso) * paso, 0, 0);
              setBorrador({ barberoId: columnaMovil?.id || null, inicio });
            }}>+ Cita</button>
          )}
        </div>
      </div>

      {fila.length > 0 && (
        <section className="tarjeta fila-espera">
          <h2>Fila sin cita <span className="insignia">{fila.length}</span></h2>
          <ul>
            {fila.map((c, i) => (
              <li key={c.id}>
                <span className="turno">{i + 1}</span>
                <div className="crece">
                  <strong>{c.clientes?.nombre || c.cliente_nombre || 'Cliente'}</strong>
                  <div className="tenue pequeno">
                    {servicios.find((s) => s.id === c.servicio_id)?.nombre || 'Servicio'} · llegó {hora(c.inicio)}
                    {c.barbero_id && ` · prefiere a ${barberos.find((b) => b.id === c.barbero_id)?.nombre}`}
                  </div>
                </div>
                {puede('agenda') && <button className="btn btn-chico btn-primario" onClick={() => setDetalle(c)}>Atender</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {visibles.length === 0 ? (
        <div className="vacio">Agrega barberos en Equipo para ver la agenda.</div>
      ) : (
        <>
          <div className="chips solo-movil">
            {visibles.map((b) => (
              <button key={b.id} className={`chip ${columnaMovil?.id === b.id ? 'chip-activo' : ''}`} onClick={() => setBarberoMovil(b.id)}>
                <span className="punto" style={{ background: b.color }} /> {b.nombre}
              </button>
            ))}
          </div>
          <div className="rejilla" style={{ ['--columnas' as string]: visibles.length }}>
            <div className="rejilla-cabeza">
              <div className="col-horas" />
              {visibles.map((b) => (
                <div key={b.id} className={`col-nombre ${b.id === columnaMovil?.id ? 'col-movil' : ''}`}>
                  <span className="punto" style={{ background: b.color }} /> {b.nombre}
                </div>
              ))}
            </div>
            <div className="rejilla-cuerpo" style={{ height: altura }}>
              <div className="col-horas">
                {horas.map((m) => (
                  <div key={m} className="marca-hora" style={{ top: (m - minIni) * PX_MIN }}>
                    {String(Math.floor(m / 60)).padStart(2, '0')}:00
                  </div>
                ))}
              </div>
              {visibles.map((b) => (
                <div key={b.id} className={`columna ${b.id === columnaMovil?.id ? 'col-movil' : ''}`} onClick={(e) => clicColumna(b, e)}>
                  {horas.map((m) => <div key={m} className="linea-hora" style={{ top: (m - minIni) * PX_MIN }} />)}
                  {bloqueos.filter((x) => !x.barbero_id || x.barbero_id === b.id).map((x) => {
                    const i = Math.max(minDe(x.inicio), minIni);
                    const f = new Date(x.fin) > sumarDias(fecha, 1) ? minFin : Math.min(minDe(x.fin), minFin);
                    if (f <= i) return null;
                    return (
                      <div key={x.id} className="bloqueo" style={{ top: (i - minIni) * PX_MIN, height: (f - i) * PX_MIN }}
                        title="Clic para quitar el bloqueo"
                        onClick={async () => {
                          if (!puede('agenda') || !confirm(`¿Quitar el bloqueo "${x.motivo || 'Bloqueado'}"?`)) return;
                          await supabase.from('bloqueos').delete().eq('id', x.id);
                          cargar();
                        }}>
                        {x.motivo || 'Bloqueado'}
                      </div>
                    );
                  })}
                  {citas.filter((c) => c.barbero_id === b.id).map((c) => {
                    const i = minDe(c.inicio), f = minDe(c.fin);
                    const serv = servicios.find((s) => s.id === c.servicio_id);
                    return (
                      <button key={c.id} className={`cita estado-${c.estado}${c.pago_estado === 'pendiente' ? ' apartado' : ''}`}
                        style={{ top: (i - minIni) * PX_MIN, height: Math.max((f - i) * PX_MIN - 2, 22), ['--color' as string]: b.color }}
                        onClick={() => setDetalle(c)}>
                        <strong>{c.clientes?.nombre || c.cliente_nombre || 'Cliente'}</strong>
                        <span>{hora(c.inicio)} · {serv?.nombre || 'Servicio'}</span>
                        {c.pago_estado === 'pagado' ? <span className="etiqueta-pago">pagó en línea</span>
                          : c.pago_estado === 'pendiente' ? <span className="etiqueta">esperando pago</span>
                          : c.origen === 'en_linea' && <span className="etiqueta">en línea</span>}
                      </button>
                    );
                  })}
                  {esHoy && (() => {
                    const m = ahora.getHours() * 60 + ahora.getMinutes();
                    return m >= minIni && m <= minFin ? <div className="linea-ahora" style={{ top: (m - minIni) * PX_MIN }} /> : null;
                  })()}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {borrador && (
        <FormCita borrador={borrador} onCerrar={() => setBorrador(null)} onGuardado={() => { setBorrador(null); setDetalle(null); cargar(); }} />
      )}
      {nuevoEnFila && <FormFila onCerrar={() => setNuevoEnFila(false)} onGuardado={() => { setNuevoEnFila(false); cargar(); }} />}
      {bloquear && <FormBloqueo fecha={fecha} onCerrar={() => setBloquear(false)} onGuardado={() => { setBloquear(false); cargar(); }} />}
      {detalle && (
        <DetalleCita cita={detalle} onCerrar={() => setDetalle(null)} onCambio={() => { setDetalle(null); cargar(); }}
          onEditar={() => { setBorrador({ cita: detalle, barberoId: detalle.barbero_id, inicio: new Date(detalle.inicio) }); setDetalle(null); }}
          onCobrar={() => navegar(`/cobrar?cita=${detalle.id}`)} />
      )}
    </div>
  );
}

function aHoraLocal(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function FormCita({ borrador, onCerrar, onGuardado }: { borrador: Borrador; onCerrar: () => void; onGuardado: () => void }) {
  const { negocio, barberos, servicios, session } = useNegocio();
  const c = borrador.cita;
  const activosServ = servicios.filter((s) => s.activo);
  const [cliente, setCliente] = useState<ClienteElegido>({
    id: c?.cliente_id || null, nombre: c?.clientes?.nombre || c?.cliente_nombre || '', telefono: c?.clientes?.telefono || '',
  });
  const [servicioId, setServicioId] = useState(c?.servicio_id || activosServ[0]?.id || '');
  const [barberoId, setBarberoId] = useState(borrador.barberoId || barberos.find((b) => b.activo)?.id || '');
  const [dia, setDia] = useState(isoDia(borrador.inicio));
  const [hhmm, setHhmm] = useState(aHoraLocal(borrador.inicio));
  const serv = servicios.find((s) => s.id === servicioId);
  const [duracion, setDuracion] = useState(c ? Math.round((+new Date(c.fin) - +new Date(c.inicio)) / 60000) : serv?.duracion_min || 30);
  const [notas, setNotas] = useState(c?.notas || '');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!cliente.nombre.trim()) return setError('Escribe el nombre del cliente');
    setEnviando(true);
    try {
      const clienteId = await asegurarCliente(negocio.id, cliente);
      const inicio = deIsoDia(dia);
      const [h, m] = hhmm.split(':').map(Number);
      inicio.setHours(h, m, 0, 0);
      const fin = new Date(inicio.getTime() + duracion * 60000);
      const datos = {
        negocio_id: negocio.id, cliente_id: clienteId, cliente_nombre: cliente.nombre.trim(),
        barbero_id: barberoId || null, servicio_id: servicioId || null,
        inicio: inicio.toISOString(), fin: fin.toISOString(), precio: serv?.precio ?? null, notas: notas.trim() || null,
      };
      const { error } = c
        ? await supabase.from('citas').update(datos).eq('id', c.id)
        : await supabase.from('citas').insert({ ...datos, estado: 'confirmada', origen: 'agenda', creado_por: session?.user.id });
      if (error) throw error;
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={c ? 'Editar cita' : 'Nueva cita'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <Campo etiqueta="Cliente"><ClienteBuscador negocioId={negocio.id} valor={cliente} onCambio={setCliente} /></Campo>
        <Campo etiqueta="Servicio">
          <select value={servicioId} onChange={(e) => {
            setServicioId(e.target.value);
            const s = servicios.find((x) => x.id === e.target.value);
            if (s) setDuracion(s.duracion_min);
          }}>
            {activosServ.map((s) => <option key={s.id} value={s.id}>{s.nombre} · {s.duracion_min} min · {dinero(s.precio, negocio.moneda)}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Barbero">
          <select value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
            {barberos.filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Día"><input type="date" value={dia} onChange={(e) => setDia(e.target.value)} required /></Campo>
          <Campo etiqueta="Hora"><input type="time" value={hhmm} step={300} onChange={(e) => setHhmm(e.target.value)} required /></Campo>
          <Campo etiqueta="Minutos"><input type="number" min={5} max={480} step={5} value={duracion} onChange={(e) => setDuracion(Number(e.target.value))} required /></Campo>
        </div>
        <Campo etiqueta="Notas"><textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} placeholder="Ej. degradado bajo, máquina del 1" /></Campo>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={enviando}>{c ? 'Guardar cambios' : 'Agendar'}</button>
        </div>
      </form>
    </Modal>
  );
}

function FormFila({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: () => void }) {
  const { negocio, barberos, servicios, session } = useNegocio();
  const activosServ = servicios.filter((s) => s.activo);
  const [cliente, setCliente] = useState<ClienteElegido>({ id: null, nombre: '', telefono: '' });
  const [servicioId, setServicioId] = useState(activosServ[0]?.id || '');
  const [barberoId, setBarberoId] = useState('');
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!cliente.nombre.trim()) return setError('Escribe el nombre del cliente');
    try {
      const clienteId = await asegurarCliente(negocio.id, cliente);
      const serv = servicios.find((s) => s.id === servicioId);
      const inicio = new Date();
      const { error } = await supabase.from('citas').insert({
        negocio_id: negocio.id, cliente_id: clienteId, cliente_nombre: cliente.nombre.trim(),
        barbero_id: barberoId || null, servicio_id: servicioId || null,
        inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + (serv?.duracion_min || 30) * 60000).toISOString(),
        estado: 'en_espera', origen: 'sin_cita', precio: serv?.precio ?? null, creado_por: session?.user.id,
      });
      if (error) throw error;
      onGuardado();
    } catch (err) {
      setError(mensajeError(err));
    }
  }

  return (
    <Modal titulo="Cliente sin cita" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <Campo etiqueta="Cliente"><ClienteBuscador negocioId={negocio.id} valor={cliente} onCambio={setCliente} /></Campo>
        <Campo etiqueta="Servicio">
          <select value={servicioId} onChange={(e) => setServicioId(e.target.value)}>
            {activosServ.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Barbero preferido">
          <select value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
            <option value="">El que se desocupe primero</option>
            {barberos.filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Campo>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Agregar a la fila</button>
        </div>
      </form>
    </Modal>
  );
}

function FormBloqueo({ fecha, onCerrar, onGuardado }: { fecha: Date; onCerrar: () => void; onGuardado: () => void }) {
  const { negocio, barberos } = useNegocio();
  const [barberoId, setBarberoId] = useState('');
  const [desde, setDesde] = useState(`${isoDia(fecha)}T14:00`);
  const [hasta, setHasta] = useState(`${isoDia(fecha)}T15:00`);
  const [motivo, setMotivo] = useState('Comida');
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('bloqueos').insert({
      negocio_id: negocio.id, barbero_id: barberoId || null,
      inicio: new Date(desde).toISOString(), fin: new Date(hasta).toISOString(), motivo: motivo.trim() || null,
    });
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo="Bloquear horario" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <p className="tenue pequeno">Comidas, descansos o vacaciones. Nadie podrá reservar en línea en ese rango.</p>
        <Campo etiqueta="Para">
          <select value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
            <option value="">Toda la barbería</option>
            {barberos.filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Campo>
        <div className="fila-campos">
          <Campo etiqueta="Desde"><input type="datetime-local" value={desde} onChange={(e) => setDesde(e.target.value)} required /></Campo>
          <Campo etiqueta="Hasta"><input type="datetime-local" value={hasta} onChange={(e) => setHasta(e.target.value)} required /></Campo>
        </div>
        <Campo etiqueta="Motivo"><input value={motivo} onChange={(e) => setMotivo(e.target.value)} /></Campo>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Bloquear</button>
        </div>
      </form>
    </Modal>
  );
}

function DetalleCita({ cita, onCerrar, onCambio, onEditar, onCobrar }: {
  cita: Cita; onCerrar: () => void; onCambio: () => void; onEditar: () => void; onCobrar: () => void;
}) {
  const { negocio, barberos, servicios, puede } = useNegocio();
  const [error, setError] = useState('');
  const [barberoAtiende, setBarberoAtiende] = useState(cita.barbero_id || barberos.find((b) => b.activo)?.id || '');
  const serv = servicios.find((s) => s.id === cita.servicio_id);
  const barb = barberos.find((b) => b.id === cita.barbero_id);
  const nombre = cita.clientes?.nombre || cita.cliente_nombre || 'Cliente';
  const tel = cita.clientes?.telefono;
  const editable = puede('agenda');

  async function cambiar(estado: EstadoCita, extra: Record<string, unknown> = {}) {
    setError('');
    const { error } = await supabase.from('citas').update({ estado, ...extra }).eq('id', cita.id);
    if (error) return setError(mensajeError(error));
    onCambio();
  }

  async function atenderDeFila() {
    const inicio = new Date();
    const dur = serv?.duracion_min || 30;
    await cambiar('en_curso', {
      barbero_id: barberoAtiende, inicio: inicio.toISOString(), fin: new Date(inicio.getTime() + dur * 60000).toISOString(),
    });
  }

  const textoWa = `Hola ${nombre}, te esperamos en ${negocio.nombre} el ${fechaLarga(cita.inicio)} a las ${hora(cita.inicio)} para ${serv?.nombre || 'tu servicio'}. ¿Nos confirmas?`;
  const wa = whatsapp(tel, textoWa);

  return (
    <Modal titulo={nombre} onCerrar={onCerrar}>
      <dl className="datos">
        <dt>Estado</dt><dd><span className={`insignia estado-${cita.estado}`}>{ESTADOS[cita.estado]}</span>{cita.origen === 'en_linea' && ' · reservó en línea'}</dd>
        <dt>Servicio</dt><dd>{serv?.nombre || '—'} {cita.precio != null && `· ${dinero(cita.precio, negocio.moneda)}`}</dd>
        {cita.pago_estado === 'pagado' && <><dt>Pago</dt><dd><span className="insignia insignia-pago">Pagó {dinero(cita.pago_monto, negocio.moneda)} en línea</span></dd></>}
        {cita.pago_estado === 'pendiente' && <><dt>Pago</dt><dd>Apartado mientras paga en Mercado Pago (hasta las {hora(cita.pago_expira || cita.inicio)})</dd></>}
        {(cita.pago_estado === 'reembolsar' || cita.pago_estado === 'reembolsado') && <><dt>Pago</dt><dd>Pago devuelto al cliente</dd></>}
        {cita.estado !== 'en_espera' && <><dt>Horario</dt><dd>{fechaLarga(cita.inicio)}, {hora(cita.inicio)} a {hora(cita.fin)}</dd></>}
        <dt>Barbero</dt><dd>{barb?.nombre || 'Cualquiera'}</dd>
        {tel && <><dt>Teléfono</dt><dd><a href={`tel:${tel}`}>{tel}</a></dd></>}
        {cita.notas && <><dt>Notas</dt><dd>{cita.notas}</dd></>}
      </dl>
      <Aviso>{error}</Aviso>
      {editable && (
        <div className="acciones envolver">
          {cita.estado === 'en_espera' && (
            <>
              <select value={barberoAtiende} onChange={(e) => setBarberoAtiende(e.target.value)} aria-label="Barbero que atiende">
                {barberos.filter((b) => b.activo).map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
              </select>
              <button className="btn btn-primario" onClick={atenderDeFila}>Pasar a atender</button>
              <button className="btn" onClick={() => cambiar('cancelada')}>Se fue</button>
            </>
          )}
          {cita.estado === 'pendiente' && <button className="btn btn-primario" onClick={() => cambiar('confirmada')}>Confirmar</button>}
          {(cita.estado === 'pendiente' || cita.estado === 'confirmada') && (
            <>
              <button className="btn btn-primario" onClick={() => cambiar('en_curso')}>Llegó</button>
              <button className="btn" onClick={() => cambiar('no_asistio')}>No llegó</button>
              <button className="btn" onClick={onEditar}>Mover / editar</button>
              <button className="btn btn-peligro" onClick={() => confirm(cita.pago_estado === 'pagado'
                ? `El cliente ya pagó ${dinero(cita.pago_monto, negocio.moneda)} en línea. Si cancelas, devuélvele el dinero desde tu cuenta de Mercado Pago. ¿Cancelar la cita?`
                : '¿Cancelar la cita?') && cambiar('cancelada')}>Cancelar cita</button>
            </>
          )}
          {cita.estado === 'en_curso' && <button className="btn" onClick={onEditar}>Editar</button>}
          {cita.estado === 'no_asistio' && <button className="btn" onClick={() => cambiar('confirmada')}>Deshacer</button>}
          {wa && cita.estado !== 'completada' && <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
        </div>
      )}
      {puede('cobrar') && (cita.estado === 'en_curso' || cita.estado === 'confirmada' || cita.estado === 'pendiente') && (
        <button className="btn btn-primario ancho mt" onClick={onCobrar}>Cobrar</button>
      )}
    </Modal>
  );
}
