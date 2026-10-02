import { dinero } from '../lib/formato';

export type ProductoEnLinea = { id: string; nombre: string; descripcion: string | null; precio: number; disponible: number };
export type Carrito = Record<string, number>;

/** Lista de productos con botón Agregar y contador −/+ (página de reservas y tienda). */
export default function ProductosTienda({ productos, carrito, onCambiar, moneda }: {
  productos: ProductoEnLinea[]; carrito: Carrito; onCambiar: (id: string, n: number) => void; moneda: string;
}) {
  return (
    <>
      {productos.map((p) => {
        const n = carrito[p.id] || 0;
        return (
          <div key={p.id} className={`producto-tienda ${n ? 'elegida' : ''}`}>
            <div className="crece">
              <strong>{p.nombre}</strong>
              <div className="tenue pequeno">{dinero(p.precio, moneda)}{p.descripcion && ` · ${p.descripcion}`}</div>
            </div>
            {n === 0 ? (
              <button type="button" className="btn" onClick={() => onCambiar(p.id, 1)}>Agregar</button>
            ) : (
              <div className="contador" role="group" aria-label={`Cantidad de ${p.nombre}`}>
                <button type="button" className="btn-icono" aria-label="Quitar uno" onClick={() => onCambiar(p.id, n - 1)}>−</button>
                <span aria-live="polite">{n}</span>
                <button type="button" className="btn-icono" aria-label="Agregar uno" disabled={n >= p.disponible} onClick={() => onCambiar(p.id, n + 1)}>+</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Productos del carrito con su cantidad, listos para mandar a la función de pagos. */
export function lineasDelCarrito(carrito: Carrito) {
  return Object.entries(carrito).filter(([, n]) => n > 0).map(([id, cantidad]) => ({ id, cantidad }));
}
