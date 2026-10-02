import type { Horario } from '../lib/tipos';
import { DIAS } from '../lib/formato';

/** Edita un horario semanal con un tramo por día (abre–cierra) o cerrado. */
export default function HorarioEditor({ valor, onCambio }: { valor: Horario; onCambio: (h: Horario) => void }) {
  return (
    <div className="horario">
      {DIAS.map((nombre, i) => {
        const k = String(i + 1);
        const tramos = valor[k] || [];
        const abierto = tramos.length > 0;
        const [abre, cierra] = tramos[0] || ['10:00', '20:00'];
        const poner = (t: [string, string][]) => onCambio({ ...valor, [k]: t });
        return (
          <div className="horario-dia" key={k}>
            <label className="check">
              <input type="checkbox" checked={abierto} onChange={(e) => poner(e.target.checked ? [[abre, cierra]] : [])} />
              {nombre}
            </label>
            {abierto ? (
              <span className="horario-horas">
                <input type="time" value={abre} onChange={(e) => poner([[e.target.value, cierra], ...tramos.slice(1)])} aria-label={`${nombre} abre`} />
                <span>a</span>
                <input type="time" value={cierra} onChange={(e) => poner([[abre, e.target.value], ...tramos.slice(1)])} aria-label={`${nombre} cierra`} />
              </span>
            ) : <span className="tenue">Cerrado</span>}
          </div>
        );
      })}
    </div>
  );
}
