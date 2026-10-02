import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import { ESTADOS, type Cita, type Cliente, type Venta } from '../lib/tipos';
import { dinero, fechaCorta, hora, soloDigitos, whatsapp } from '../lib/formato';
import { Aviso, Cabecera, Campo, Modal, Vacio } from '../components/ui';

export default function Clientes() {
  const { negocio, puede } = useNegocio();
  const [busca, setBusca] = useState('');
  const [lista, setLista] = useState<Cliente[]>([]);
  const [editar, setEditar] = useState<Cliente | 'nuevo' | null>(null);
  const [ver, setVer] = useState<Cliente | null>(null);

  const cargar = useCallback(async () => {
    const q = busca.trim().replace(/[%,()]/g, '');
    let consulta = supabase.from('clientes').select('*').eq('negocio_id', negocio.id).order('nombre').limit(100);
    if (q) {
      const d = soloDigitos(q);
      consulta = d.length >= 3 ? consulta.or(`nombre.ilike.%${q}%,telefono.ilike.%${d}%`) : consulta.ilike('nombre', `%${q}%`);
    }
    const { data } = await consulta;
    setLista((data as Cliente[]) || []);
  }, [busca, negocio.id]);

  useEffect(() => { const t = setTimeout(cargar, 200); return () => clearTimeout(t); }, [cargar]);

  return (
    <div className="pagina">
      <Cabecera titulo="Clientes">
        {(puede('clientes')) && <button className="btn btn-primario" onClick={() => setEditar('nuevo')}>+ Cliente</button>}
      </Cabecera>
      <input className="buscar" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nombre o teléfono" aria-label="Buscar cliente" />
      {lista.length === 0 ? <Vacio>{busca ? 'Sin resultados.' : 'Aún no hay clientes. Se crean solos al reservar en línea o al agendar con teléfono.'}</Vacio> : (
        <ul className="lista">
          {lista.map((c) => (
            <li key={c.id}>
              <button className="fila-enlace" onClick={() => setVer(c)}>
                <div className="crece">
                  <strong>{c.nombre}</strong>
                  <div className="tenue pequeno">{c.telefono || 'Sin teléfono'}{c.etiquetas.length > 0 && ` · ${c.etiquetas.join(', ')}`}</div>
                </div>
                <span aria-hidden>›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editar && <FormCliente cliente={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)}
        onGuardado={() => { setEditar(null); setVer(null); cargar(); }} />}
      {ver && <FichaCliente cliente={ver} onCerrar={() => setVer(null)} onEditar={() => { setEditar(ver); setVer(null); }} />}
    </div>
  );
}

function FormCliente({ cliente, onCerrar, onGuardado }: { cliente: Cliente | null; onCerrar: () => void; onGuardado: () => void }) {
  const { negocio } = useNegocio();
  const [f, setF] = useState({
    nombre: cliente?.nombre || '', telefono: cliente?.telefono || '', email: cliente?.email || '',
    nacimiento: cliente?.nacimiento || '', notas: cliente?.notas || '', etiquetas: cliente?.etiquetas.join(', ') || '',
  });
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const datos = {
      negocio_id: negocio.id, nombre: f.nombre.trim(), telefono: soloDigitos(f.telefono) || null, email: f.email.trim() || null,
      nacimiento: f.nacimiento || null, notas: f.notas.trim() || null,
      etiquetas: f.etiquetas.split(',').map((x) => x.trim()).filter(Boolean),
    };
    const { error } = cliente
      ? await supabase.from('clientes').update(datos).eq('id', cliente.id)
      : await supabase.from('clientes').insert(datos);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  async function borrar() {
    if (!cliente || !confirm(`¿Borrar a ${cliente.nombre}? Su historial de ventas se conserva sin nombre.`)) return;
    const { error } = await supabase.from('clientes').delete().eq('id', cliente.id);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo={cliente ? 'Editar cliente' : 'Nuevo cliente'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required maxLength={80} /></Campo>
        <div className="fila-campos">
          <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" /></Campo>
          <Campo etiqueta="Cumpleaños"><input type="date" value={f.nacimiento} onChange={(e) => setF({ ...f, nacimiento: e.target.value })} /></Campo>
        </div>
        <Campo etiqueta="Correo"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Campo>
        <Campo etiqueta="Preferencias y notas"><textarea rows={3} value={f.notas} onChange={(e) => setF({ ...f, notas: e.target.value })} placeholder="Ej. fade medio, no le gusta la navaja" /></Campo>
        <Campo etiqueta="Etiquetas" ayuda="Separadas por coma, ej. frecuente, VIP"><input value={f.etiquetas} onChange={(e) => setF({ ...f, etiquetas: e.target.value })} /></Campo>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          {cliente && <button type="button" className="btn btn-peligro" onClick={borrar}>Borrar</button>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

function FichaCliente({ cliente, onCerrar, onEditar }: { cliente: Cliente; onCerrar: () => void; onEditar: () => void }) {
  const { negocio, servicios, barberos, puede } = useNegocio();
  const [citas, setCitas] = useState<Cita[]>([]);
  const [ventas, setVentas] = useState<Venta[]>([]);

  useEffect(() => {
    supabase.from('citas').select('*').eq('negocio_id', negocio.id).eq('cliente_id', cliente.id).order('inicio', { ascending: false }).limit(30)
      .then(({ data }) => setCitas((data as Cita[]) || []));
    supabase.from('ventas').select('*').eq('negocio_id', negocio.id).eq('cliente_id', cliente.id).eq('estado', 'pagada').order('fecha', { ascending: false }).limit(50)
      .then(({ data }) => setVentas((data as Venta[]) || []));
  }, [cliente.id, negocio.id]);

  const gastado = ventas.reduce((a, v) => a + Number(v.total), 0);
  const wa = whatsapp(cliente.telefono, `Hola ${cliente.nombre}, te saludamos de ${negocio.nombre}.`);

  return (
    <Modal titulo={cliente.nombre} onCerrar={onCerrar}>
      <div className="kpis chicos">
        <div className="kpi"><span>Visitas</span><strong>{citas.filter((c) => c.estado === 'completada').length}</strong></div>
        {puede('caja') || puede('reportes') ? <div className="kpi"><span>Ha gastado</span><strong>{dinero(gastado, negocio.moneda)}</strong></div> : null}
        <div className="kpi"><span>No llegó</span><strong>{citas.filter((c) => c.estado === 'no_asistio').length}</strong></div>
      </div>
      <dl className="datos">
        {cliente.telefono && <><dt>Teléfono</dt><dd><a href={`tel:${cliente.telefono}`}>{cliente.telefono}</a></dd></>}
        {cliente.email && <><dt>Correo</dt><dd>{cliente.email}</dd></>}
        {cliente.nacimiento && <><dt>Cumpleaños</dt><dd>{new Date(cliente.nacimiento + 'T12:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'long' })}</dd></>}
        {cliente.notas && <><dt>Notas</dt><dd>{cliente.notas}</dd></>}
        <dt>Cliente desde</dt><dd>{fechaCorta(cliente.created_at)}</dd>
      </dl>
      <div className="acciones">
        {wa && <a className="btn" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
        {puede('clientes') && <button className="btn" onClick={onEditar}>Editar</button>}
      </div>
      <h3 className="mt">Historial</h3>
      {citas.length === 0 ? <p className="tenue">Sin citas.</p> : (
        <ul className="lista compacta">
          {citas.map((c) => (
            <li key={c.id}>
              <span>{fechaCorta(c.inicio)} {hora(c.inicio)}</span>
              <span className="crece">{servicios.find((s) => s.id === c.servicio_id)?.nombre || '—'} · {barberos.find((b) => b.id === c.barbero_id)?.nombre || '—'}</span>
              <span className={`insignia estado-${c.estado}`}>{ESTADOS[c.estado]}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
