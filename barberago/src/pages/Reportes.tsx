import { useEffect, useState } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import { dinero, isoDia, sumarDias } from '../lib/formato';
import { Aviso, Cabecera, Cargando } from '../components/ui';

interface Reporte {
  ventas: number; total: number; propinas: number; descuentos: number; servicios: number; productos: number; ticket_promedio: number;
  por_metodo: Record<string, number>;
  por_dia: { dia: string; total: number }[];
  por_barbero: { barbero_id: string; nombre: string; servicios: number; productos: number; comision: number; propinas: number; atenciones: number }[];
  top_servicios: { nombre: string; cantidad: number; importe: number }[];
  citas: { total: number; completadas: number; canceladas: number; no_asistio: number; en_linea: number; pagadas_en_linea?: number; anticipos?: number };
}

const PERIODOS = [
  { id: 'hoy', nombre: 'Hoy' },
  { id: 'semana', nombre: '7 días' },
  { id: 'mes', nombre: 'Este mes' },
  { id: 'mes_pasado', nombre: 'Mes pasado' },
];

function rango(p: string): [string, string] {
  const hoy = new Date();
  if (p === 'semana') return [isoDia(sumarDias(hoy, -6)), isoDia(hoy)];
  if (p === 'mes') return [isoDia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)), isoDia(hoy)];
  if (p === 'mes_pasado') return [isoDia(new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1)), isoDia(new Date(hoy.getFullYear(), hoy.getMonth(), 0))];
  return [isoDia(hoy), isoDia(hoy)];
}

export default function Reportes() {
  const { negocio } = useNegocio();
  const [periodo, setPeriodo] = useState('semana');
  const [[desde, hasta], setRango] = useState(rango('semana'));
  const [r, setR] = useState<Reporte | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setR(null); setError('');
    supabase.rpc('reporte', { p_negocio: negocio.id, p_desde: desde, p_hasta: hasta }).then(({ data, error }) => {
      if (error) setError(mensajeError(error)); else setR(data as Reporte);
    });
  }, [negocio.id, desde, hasta]);

  const m = (n: number) => dinero(n, negocio.moneda);
  const maxDia = r ? Math.max(1, ...r.por_dia.map((d) => Number(d.total))) : 1;

  return (
    <div className="pagina">
      <Cabecera titulo="Reportes">
        <div className="segmentado">
          {PERIODOS.map((p) => (
            <button key={p.id} className={periodo === p.id ? 'activo' : ''} onClick={() => { setPeriodo(p.id); setRango(rango(p.id)); }}>{p.nombre}</button>
          ))}
        </div>
        <span className="fila">
          <input type="date" value={desde} onChange={(e) => { setPeriodo(''); setRango([e.target.value, hasta]); }} aria-label="Desde" />
          <input type="date" value={hasta} onChange={(e) => { setPeriodo(''); setRango([desde, e.target.value]); }} aria-label="Hasta" />
        </span>
      </Cabecera>
      <Aviso>{error}</Aviso>
      {!r ? (!error && <Cargando />) : (
        <>
          <div className="kpis">
            <div className="kpi"><span>Ventas</span><strong>{m(r.total)}</strong><small>{r.ventas} cobros</small></div>
            <div className="kpi"><span>Ticket promedio</span><strong>{m(r.ticket_promedio)}</strong></div>
            <div className="kpi"><span>Servicios</span><strong>{m(r.servicios)}</strong></div>
            <div className="kpi"><span>Productos</span><strong>{m(r.productos)}</strong></div>
            <div className="kpi"><span>Propinas</span><strong>{m(r.propinas)}</strong></div>
            <div className="kpi"><span>Citas</span><strong>{r.citas.total}</strong>
              <small>{r.citas.en_linea} en línea{r.citas.pagadas_en_linea ? ` (${r.citas.pagadas_en_linea} pagadas)` : ''} · {r.citas.no_asistio} no llegaron</small></div>
          </div>

          {r.por_dia.length > 1 && (
            <section className="tarjeta">
              <h2>Ventas por día</h2>
              <div className="barras" role="img" aria-label="Ventas por día">
                {r.por_dia.map((d) => (
                  <div key={d.dia} className="barra" title={`${d.dia}: ${m(d.total)}`}>
                    <div style={{ height: `${(Number(d.total) / maxDia) * 100}%` }} />
                    <small>{new Date(d.dia + 'T12:00').toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}</small>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="tarjeta">
            <h2>Pago a barberos</h2>
            <p className="tenue pequeno">Comisión según el porcentaje de cada barbero, ya con descuentos. Las propinas son íntegras para el barbero.</p>
            <div className="tabla-scroll">
              <table className="tabla">
                <thead><tr><th>Barbero</th><th className="num">Atenciones</th><th className="num">Servicios</th><th className="num">Productos</th><th className="num">Comisión</th><th className="num">Propinas</th><th className="num">A pagar</th></tr></thead>
                <tbody>
                  {r.por_barbero.map((b) => (
                    <tr key={b.barbero_id}>
                      <td>{b.nombre}</td>
                      <td className="num">{b.atenciones}</td>
                      <td className="num">{m(b.servicios)}</td>
                      <td className="num">{m(b.productos)}</td>
                      <td className="num">{m(b.comision)}</td>
                      <td className="num">{m(b.propinas)}</td>
                      <td className="num"><strong>{m(Number(b.comision) + Number(b.propinas))}</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="dos-columnas">
            <section className="tarjeta">
              <h2>Servicios más vendidos</h2>
              {r.top_servicios.length === 0 ? <p className="tenue">Sin ventas en el periodo.</p> : (
                <table className="tabla">
                  <tbody>
                    {r.top_servicios.map((s) => <tr key={s.nombre}><td>{s.nombre}</td><td className="num">{s.cantidad}</td><td className="num">{m(s.importe)}</td></tr>)}
                  </tbody>
                </table>
              )}
            </section>
            <section className="tarjeta">
              <h2>Por método de pago</h2>
              <table className="tabla">
                <tbody>
                  {['efectivo', 'tarjeta', 'transferencia'].map((k) => <tr key={k}><td>{k}</td><td className="num">{m(r.por_metodo[k] || 0)}</td></tr>)}
                  {(r.por_metodo.en_linea || 0) > 0 && <tr><td>en línea (al reservar)</td><td className="num">{m(r.por_metodo.en_linea)}</td></tr>}
                  {r.descuentos > 0 && <tr><td>Descuentos dados</td><td className="num">{m(r.descuentos)}</td></tr>}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
