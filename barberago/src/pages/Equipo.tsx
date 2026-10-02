import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import { PERMISOS, type Barbero, type Miembro, type Permiso } from '../lib/tipos';
import { Aviso, Cabecera, Campo, Modal } from '../components/ui';
import HorarioEditor from '../components/HorarioEditor';

const ROLES = { admin: 'Administrador', recepcion: 'Recepción', barbero: 'Barbero' } as const;
const COLORES = ['#c8102e', '#1d4ed8', '#047857', '#b45309', '#7c3aed', '#0e7490', '#be185d', '#4b5563'];

export default function Equipo() {
  const { negocio, barberos, recargarCatalogo, session, recargar } = useNegocio();
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [editarBarbero, setEditarBarbero] = useState<Barbero | 'nuevo' | null>(null);
  const [editarMiembro, setEditarMiembro] = useState<Miembro | null>(null);
  const [invitar, setInvitar] = useState(false);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('miembros').select('*').eq('negocio_id', negocio.id).order('created_at');
    setMiembros((data as Miembro[]) || []);
  }, [negocio.id]);
  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className="pagina">
      <Cabecera titulo="Barberos">
        <button className="btn btn-primario" onClick={() => setEditarBarbero('nuevo')}>+ Barbero</button>
      </Cabecera>
      <p className="tenue pequeno">Cada barbero tiene su columna en la agenda, su horario y sus comisiones. No necesita cuenta para aparecer.</p>
      <ul className="lista">
        {barberos.map((b) => (
          <li key={b.id} className={b.activo ? '' : 'inactivo'}>
            <button className="fila-enlace" onClick={() => setEditarBarbero(b)}>
              <span className="avatar" style={{ background: b.color }}>{b.nombre.slice(0, 1).toUpperCase()}</span>
              <div className="crece">
                <strong>{b.nombre}</strong>
                <div className="tenue pequeno">
                  {b.comision_servicios}% servicios · {b.comision_productos}% productos
                  {b.horario ? ' · horario propio' : ''}{!b.en_linea && ' · oculto en reservas'}{!b.activo && ' · inactivo'}
                </div>
              </div>
              <span aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ul>

      <Cabecera titulo="Cuentas con acceso">
        <button className="btn" onClick={() => setInvitar(true)}>+ Agregar persona</button>
      </Cabecera>
      <ul className="lista">
        {miembros.map((m) => (
          <li key={m.usuario_id} className={m.activo ? '' : 'inactivo'}>
            <button className="fila-enlace" onClick={() => setEditarMiembro(m)}>
              <div className="crece">
                <strong>{m.nombre || m.email}</strong>{m.usuario_id === session?.user.id && <span className="tenue"> (tú)</span>}
                <div className="tenue pequeno">
                  {ROLES[m.rol]} · {m.email}
                  {m.barbero_id && ` · agenda de ${barberos.find((b) => b.id === m.barbero_id)?.nombre}`}
                </div>
              </div>
              <span aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ul>

      {editarBarbero && <FormBarbero barbero={editarBarbero === 'nuevo' ? null : editarBarbero} onCerrar={() => setEditarBarbero(null)}
        onGuardado={() => { setEditarBarbero(null); recargarCatalogo(); }} />}
      {invitar && <FormInvitar onCerrar={() => setInvitar(false)} onGuardado={() => { setInvitar(false); cargar(); }} />}
      {editarMiembro && <FormMiembro miembro={editarMiembro} onCerrar={() => setEditarMiembro(null)}
        onGuardado={() => { setEditarMiembro(null); cargar(); recargar(); }} />}
    </div>
  );
}

function FormBarbero({ barbero, onCerrar, onGuardado }: { barbero: Barbero | null; onCerrar: () => void; onGuardado: () => void }) {
  const { negocio, barberos } = useNegocio();
  const [f, setF] = useState({
    nombre: barbero?.nombre || '', telefono: barbero?.telefono || '', color: barbero?.color || COLORES[barberos.length % COLORES.length],
    comision_servicios: barbero?.comision_servicios ?? 50, comision_productos: barbero?.comision_productos ?? 10,
    en_linea: barbero?.en_linea ?? true, activo: barbero?.activo ?? true, orden: barbero?.orden ?? barberos.length,
  });
  const [propio, setPropio] = useState(!!barbero?.horario);
  const [horario, setHorario] = useState(barbero?.horario || negocio.horario);
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const datos = { ...f, negocio_id: negocio.id, nombre: f.nombre.trim(), telefono: f.telefono.trim() || null, horario: propio ? horario : null };
    const { error } = barbero
      ? await supabase.from('barberos').update(datos).eq('id', barbero.id)
      : await supabase.from('barberos').insert(datos);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo={barbero ? 'Editar barbero' : 'Nuevo barbero'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <div className="fila-campos">
          <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required maxLength={60} /></Campo>
          <Campo etiqueta="Teléfono"><input value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} inputMode="tel" /></Campo>
        </div>
        <div className="campo">
          <span>Color en la agenda</span>
          <div className="colores">
            {COLORES.map((c) => (
              <button type="button" key={c} className={`color ${f.color === c ? 'elegido' : ''}`} style={{ background: c }}
                onClick={() => setF({ ...f, color: c })} aria-label={`Color ${c}`} />
            ))}
          </div>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Comisión servicios %"><input type="number" min={0} max={100} value={f.comision_servicios} onChange={(e) => setF({ ...f, comision_servicios: Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Comisión productos %"><input type="number" min={0} max={100} value={f.comision_productos} onChange={(e) => setF({ ...f, comision_productos: Number(e.target.value) })} /></Campo>
        </div>
        <label className="check"><input type="checkbox" checked={propio} onChange={(e) => setPropio(e.target.checked)} /> Tiene horario distinto al de la barbería</label>
        {propio && <HorarioEditor valor={horario} onCambio={setHorario} />}
        <label className="check"><input type="checkbox" checked={f.en_linea} onChange={(e) => setF({ ...f, en_linea: e.target.checked })} /> Aparece en reservas en línea</label>
        <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo</label>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

function FormInvitar({ onCerrar, onGuardado }: { onCerrar: () => void; onGuardado: () => void }) {
  const { negocio, barberos } = useNegocio();
  const [email, setEmail] = useState('');
  const [rol, setRol] = useState<Miembro['rol']>('barbero');
  const [barberoId, setBarberoId] = useState('');
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.rpc('agregar_miembro', { p_negocio: negocio.id, p_email: email, p_rol: rol, p_barbero: barberoId || null });
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo="Agregar persona" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <p className="tenue pequeno">La persona primero crea su cuenta en BarberaGo con su correo. Después la agregas aquí y al entrar verá esta barbería.</p>
        <Campo etiqueta="Correo"><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></Campo>
        <Campo etiqueta="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as Miembro['rol'])}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Su agenda">
          <select value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
            <option value="">No atiende clientes</option>
            {barberos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Campo>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Agregar</button>
        </div>
      </form>
    </Modal>
  );
}

function FormMiembro({ miembro, onCerrar, onGuardado }: { miembro: Miembro; onCerrar: () => void; onGuardado: () => void }) {
  const { barberos } = useNegocio();
  const [rol, setRol] = useState(miembro.rol);
  const [permisos, setPermisos] = useState<Permiso[]>(miembro.permisos);
  const [barberoId, setBarberoId] = useState(miembro.barbero_id || '');
  const [activo, setActivo] = useState(miembro.activo);
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('miembros')
      .update({ rol, permisos, barbero_id: barberoId || null, activo })
      .eq('negocio_id', miembro.negocio_id).eq('usuario_id', miembro.usuario_id);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  async function quitar() {
    if (!confirm(`¿Quitar el acceso de ${miembro.nombre || miembro.email}?`)) return;
    const { error } = await supabase.from('miembros').delete().eq('negocio_id', miembro.negocio_id).eq('usuario_id', miembro.usuario_id);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo={miembro.nombre || miembro.email || 'Persona'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <Campo etiqueta="Rol">
          <select value={rol} onChange={(e) => setRol(e.target.value as Miembro['rol'])}>
            {Object.entries(ROLES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        {rol !== 'admin' && (
          <div className="campo">
            <span>Puede usar</span>
            <div className="permisos">
              {PERMISOS.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" checked={permisos.includes(p.id)}
                    onChange={(e) => setPermisos(e.target.checked ? [...permisos, p.id] : permisos.filter((x) => x !== p.id))} />
                  {p.nombre}
                </label>
              ))}
            </div>
          </div>
        )}
        <Campo etiqueta="Su agenda">
          <select value={barberoId} onChange={(e) => setBarberoId(e.target.value)}>
            <option value="">No atiende clientes</option>
            {barberos.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </select>
        </Campo>
        <label className="check"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Acceso activo</label>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          <button type="button" className="btn btn-peligro" onClick={quitar}>Quitar acceso</button>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
