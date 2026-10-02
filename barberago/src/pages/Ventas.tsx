import { useCallback, useEffect, useState } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import type { Venta } from '../lib/tipos';
import { deIsoDia, dinero, hora, isoDia, sumarDias } from '../lib/formato';
import { Aviso, Cabecera, Vacio } from '../components/ui';

export default function Ventas() {
  const { negocio, barberos, puede } = useNegocio();
  const [dia, setDia] = useState(isoDia(new Date()));
  const [ventas, setVentas] = useState<Venta[]>([]);
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    const desde = deIsoDia(dia);
    const { data } = await supabase.from('ventas')
      .select('*, clientes(nombre), venta_items(nombre, cantidad, importe, tipo)')
      .eq('negocio_id', negocio.id).gte('fecha', desde.toISOString()).lt('fecha', sumarDias(desde, 1).toISOString())
      .order('folio', { ascending: false });
    setVentas((data as Venta[]) || []);
  }, [dia, negocio.id]);

  useEffect(() => { cargar(); }, [cargar]);

  async function anular(v: Venta) {
    const motivo = prompt(`Motivo para anular el folio #${v.folio}:`);
    if (motivo === null) return;
    const { error } = await supabase.rpc('anular_venta', { p_negocio: negocio.id, p_venta: v.id, p_motivo: motivo });
    if (error) return setError(mensajeError(error));
    cargar();
  }

  const pagadas = ventas.filter((v) => v.estado === 'pagada');
  // Por método cuenta solo lo cobrado en la barbería; lo pagado al reservar va en "En línea".
  const suma = (m?: string) => pagadas.filter((v) => !m || v.metodo_pago === m)
    .reduce((a, v) => a + Number(v.total) - (m ? Number(v.pagado_en_linea || 0) : 0), 0);
  const enLinea = pagadas.reduce((a, v) => a + Number(v.pagado_en_linea || 0), 0);

  return (
    <div className="pagina">
      <Cabecera titulo="Ventas del día">
        <input type="date" value={dia} onChange={(e) => e.target.value && setDia(e.target.value)} aria-label="Día" />
      </Cabecera>
      <div className="kpis">
        <div className="kpi"><span>Total</span><strong>{dinero(suma(), negocio.moneda)}</strong></div>
        <div className="kpi"><span>Efectivo</span><strong>{dinero(suma('efectivo'), negocio.moneda)}</strong></div>
        <div className="kpi"><span>Tarjeta</span><strong>{dinero(suma('tarjeta'), negocio.moneda)}</strong></div>
        <div className="kpi"><span>Transferencia</span><strong>{dinero(suma('transferencia'), negocio.moneda)}</strong></div>
        {enLinea > 0 && <div className="kpi"><span>En línea</span><strong>{dinero(enLinea, negocio.moneda)}</strong></div>}
        <div className="kpi"><span>Propinas</span><strong>{dinero(pagadas.reduce((a, v) => a + Number(v.propina), 0), negocio.moneda)}</strong></div>
      </div>
      <Aviso>{error}</Aviso>
      {ventas.length === 0 ? <Vacio>No hay ventas este día.</Vacio> : (
        <div className="tabla-scroll">
          <table className="tabla">
            <thead><tr><th>Folio</th><th>Hora</th><th>Cliente</th><th>Detalle</th><th>Barbero</th><th>Método</th><th className="num">Total</th><th /></tr></thead>
            <tbody>
              {ventas.map((v) => (
                <tr key={v.id} className={v.estado === 'anulada' ? 'anulada' : ''}>
                  <td>#{v.folio}</td>
                  <td>{hora(v.fecha)}</td>
                  <td>{v.clientes?.nombre || '—'}</td>
                  <td className="pequeno">{v.venta_items?.map((i) => `${i.cantidad > 1 ? i.cantidad + '× ' : ''}${i.nombre}`).join(', ')}</td>
                  <td>{barberos.find((b) => b.id === v.barbero_id)?.nombre || '—'}</td>
                  <td>{v.metodo_pago}{Number(v.pagado_en_linea) > 0 && <div className="pequeno tenue">+ {dinero(v.pagado_en_linea, negocio.moneda)} en línea</div>}</td>
                  <td className="num">{dinero(v.total, negocio.moneda)}{v.estado === 'anulada' && <div className="pequeno">anulada</div>}</td>
                  <td>{v.estado === 'pagada' && puede('caja') && <button className="btn-texto" onClick={() => anular(v)}>Anular</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
