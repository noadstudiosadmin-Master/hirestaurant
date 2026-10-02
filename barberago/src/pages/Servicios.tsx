import { useState, type FormEvent } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import type { Servicio } from '../lib/tipos';
import { dinero } from '../lib/formato';
import { Aviso, Cabecera, Campo, Modal, Vacio } from '../components/ui';

export default function Servicios() {
  const { negocio, servicios, recargarCatalogo, puede } = useNegocio();
  const [editar, setEditar] = useState<Servicio | 'nuevo' | null>(null);

  return (
    <div className="pagina">
      <Cabecera titulo="Servicios">
        {puede('catalogo') && <button className="btn btn-primario" onClick={() => setEditar('nuevo')}>+ Servicio</button>}
      </Cabecera>
      {servicios.length === 0 ? <Vacio>Agrega tus servicios: corte, barba, cejas, tinte…</Vacio> : (
        <ul className="lista">
          {servicios.map((s) => (
            <li key={s.id} className={s.activo ? '' : 'inactivo'}>
              <button className="fila-enlace" onClick={() => puede('catalogo') && setEditar(s)}>
                <div className="crece">
                  <strong>{s.nombre}</strong>
                  <div className="tenue pequeno">{s.duracion_min} min{s.categoria && ` · ${s.categoria}`}{!s.en_linea && ' · no se reserva en línea'}{!s.activo && ' · inactivo'}</div>
                </div>
                <strong>{dinero(s.precio, negocio.moneda)}</strong>
              </button>
            </li>
          ))}
        </ul>
      )}
      {editar && <FormServicio servicio={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)}
        onGuardado={() => { setEditar(null); recargarCatalogo(); }} />}
    </div>
  );
}

function FormServicio({ servicio, onCerrar, onGuardado }: { servicio: Servicio | null; onCerrar: () => void; onGuardado: () => void }) {
  const { negocio, servicios } = useNegocio();
  const [f, setF] = useState({
    nombre: servicio?.nombre || '', descripcion: servicio?.descripcion || '', categoria: servicio?.categoria || '',
    duracion_min: servicio?.duracion_min || 30, precio: servicio?.precio ?? 0,
    en_linea: servicio?.en_linea ?? true, activo: servicio?.activo ?? true, orden: servicio?.orden ?? servicios.length + 1,
  });
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const datos = { ...f, negocio_id: negocio.id, nombre: f.nombre.trim(), descripcion: f.descripcion.trim() || null, categoria: f.categoria.trim() || null };
    const { error } = servicio
      ? await supabase.from('servicios').update(datos).eq('id', servicio.id)
      : await supabase.from('servicios').insert(datos);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  async function borrar() {
    if (!servicio || !confirm(`¿Borrar "${servicio.nombre}"? Si ya tiene ventas, mejor desactívalo.`)) return;
    const { error } = await supabase.from('servicios').delete().eq('id', servicio.id);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo={servicio ? 'Editar servicio' : 'Nuevo servicio'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required maxLength={80} /></Campo>
        <div className="fila-campos">
          <Campo etiqueta="Precio"><input type="number" min={0} step="0.5" value={f.precio} onChange={(e) => setF({ ...f, precio: Number(e.target.value) })} required /></Campo>
          <Campo etiqueta="Duración (min)"><input type="number" min={5} max={480} step={5} value={f.duracion_min} onChange={(e) => setF({ ...f, duracion_min: Number(e.target.value) })} required /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Categoría"><input value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} placeholder="Cabello, barba…" /></Campo>
          <Campo etiqueta="Orden"><input type="number" value={f.orden} onChange={(e) => setF({ ...f, orden: Number(e.target.value) })} /></Campo>
        </div>
        <Campo etiqueta="Descripción (se ve al reservar)"><textarea rows={2} value={f.descripcion} onChange={(e) => setF({ ...f, descripcion: e.target.value })} /></Campo>
        <label className="check"><input type="checkbox" checked={f.en_linea} onChange={(e) => setF({ ...f, en_linea: e.target.checked })} /> Se puede reservar en línea</label>
        <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo</label>
        <Aviso>{error}</Aviso>
        <div className="acciones">
          {servicio && <button type="button" className="btn btn-peligro" onClick={borrar}>Borrar</button>}
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}
