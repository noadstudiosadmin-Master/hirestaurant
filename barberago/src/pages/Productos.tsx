import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import type { Producto } from '../lib/tipos';
import { dinero } from '../lib/formato';
import { Aviso, Cabecera, Campo, Modal, Vacio } from '../components/ui';

export default function Productos() {
  const { negocio, puede } = useNegocio();
  const [lista, setLista] = useState<Producto[]>([]);
  const [editar, setEditar] = useState<Producto | 'nuevo' | null>(null);

  const cargar = useCallback(async () => {
    const { data } = await supabase.from('productos').select('*').eq('negocio_id', negocio.id).order('nombre');
    setLista((data as Producto[]) || []);
  }, [negocio.id]);
  useEffect(() => { cargar(); }, [cargar]);

  const bajos = lista.filter((p) => p.activo && p.stock <= p.stock_minimo);
  const valor = lista.reduce((a, p) => a + Math.max(p.stock, 0) * Number(p.costo), 0);

  return (
    <div className="pagina">
      <Cabecera titulo="Productos">
        {puede('inventario') && <button className="btn btn-primario" onClick={() => setEditar('nuevo')}>+ Producto</button>}
      </Cabecera>
      <div className="kpis">
        <div className="kpi"><span>Productos</span><strong>{lista.filter((p) => p.activo).length}</strong></div>
        <div className="kpi"><span>Por surtir</span><strong>{bajos.length}</strong></div>
        <div className="kpi"><span>Inventario a costo</span><strong>{dinero(valor, negocio.moneda)}</strong></div>
      </div>
      {lista.length === 0 ? <Vacio>Registra ceras, shampoos, aceites para barba y lo que vendas en mostrador.</Vacio> : (
        <div className="tabla-scroll">
          <table className="tabla">
            <thead><tr><th>Producto</th><th className="num">Precio</th><th className="num">Costo</th><th className="num">Existencia</th><th /></tr></thead>
            <tbody>
              {lista.map((p) => (
                <tr key={p.id} className={p.activo ? '' : 'inactivo'}>
                  <td>{p.nombre}{p.sku && <div className="tenue pequeno">{p.sku}</div>}</td>
                  <td className="num">{dinero(p.precio, negocio.moneda)}</td>
                  <td className="num">{dinero(p.costo, negocio.moneda)}</td>
                  <td className="num">{p.stock <= p.stock_minimo ? <span className="insignia estado-no_asistio">{p.stock}</span> : p.stock}</td>
                  <td>{puede('inventario') && <button className="btn-texto" onClick={() => setEditar(p)}>Editar</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editar && <FormProducto producto={editar === 'nuevo' ? null : editar} onCerrar={() => setEditar(null)} onGuardado={() => { setEditar(null); cargar(); }} />}
    </div>
  );
}

function FormProducto({ producto, onCerrar, onGuardado }: { producto: Producto | null; onCerrar: () => void; onGuardado: () => void }) {
  const { negocio } = useNegocio();
  const [f, setF] = useState({
    nombre: producto?.nombre || '', sku: producto?.sku || '', precio: producto?.precio ?? 0, costo: producto?.costo ?? 0,
    stock: producto?.stock ?? 0, stock_minimo: producto?.stock_minimo ?? 2, activo: producto?.activo ?? true,
  });
  const [entrada, setEntrada] = useState(0);
  const [error, setError] = useState('');

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const datos = { ...f, negocio_id: negocio.id, nombre: f.nombre.trim(), sku: f.sku.trim() || null, stock: f.stock + entrada };
    const { error } = producto
      ? await supabase.from('productos').update(datos).eq('id', producto.id)
      : await supabase.from('productos').insert(datos);
    if (error) return setError(mensajeError(error));
    onGuardado();
  }

  return (
    <Modal titulo={producto ? 'Editar producto' : 'Nuevo producto'} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="formulario">
        <Campo etiqueta="Nombre"><input value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} required maxLength={80} /></Campo>
        <div className="fila-campos">
          <Campo etiqueta="Precio de venta"><input type="number" min={0} step="0.5" value={f.precio} onChange={(e) => setF({ ...f, precio: Number(e.target.value) })} /></Campo>
          <Campo etiqueta="Costo"><input type="number" min={0} step="0.5" value={f.costo} onChange={(e) => setF({ ...f, costo: Number(e.target.value) })} /></Campo>
        </div>
        <div className="fila-campos">
          <Campo etiqueta="Existencia"><input type="number" value={f.stock} onChange={(e) => setF({ ...f, stock: Number(e.target.value) })} /></Campo>
          {producto && <Campo etiqueta="Entrada de mercancía"><input type="number" min={0} value={entrada} onChange={(e) => setEntrada(Number(e.target.value))} /></Campo>}
          <Campo etiqueta="Avisar al llegar a"><input type="number" min={0} value={f.stock_minimo} onChange={(e) => setF({ ...f, stock_minimo: Number(e.target.value) })} /></Campo>
        </div>
        <Campo etiqueta="Código / SKU"><input value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} /></Campo>
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
