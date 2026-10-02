import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, mensajeError, llamarPagos } from '../lib/supabase';
import type { ModoPago } from '../lib/tipos';
import { dinero } from '../lib/formato';
import { Aviso, Campo, Cargando } from '../components/ui';
import ProductosTienda, { lineasDelCarrito, type Carrito, type ProductoEnLinea } from '../components/ProductosTienda';

interface Info {
  negocio: { nombre: string; slug: string; telefono: string | null; direccion: string | null; logo_url: string | null; moneda: string; pago_en_linea: ModoPago };
  productos?: ProductoEnLinea[];
}

/** Página pública: comprar productos sin reservar y recogerlos en la sucursal. */
export default function Tienda() {
  const { slug = '' } = useParams();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [carrito, setCarrito] = useState<Carrito>({});
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const cargar = useCallback(() => supabase.rpc('reserva_negocio', { p_slug: slug }).then(({ data }) => {
    setInfo((data as Info) || null);
    if (data) document.title = `Productos de ${(data as Info).negocio.nombre}`;
  }), [slug]);
  useEffect(() => { cargar(); }, [cargar]);

  async function pagar(e: FormEvent) {
    e.preventDefault();
    setError(''); setEnviando(true);
    try {
      const r = await llamarPagos<{ url: string }>({
        accion: 'pedir', slug, nombre, telefono, notas: notas || null, productos: lineasDelCarrito(carrito),
      });
      window.location.href = r.url;
    } catch (err) {
      setEnviando(false);
      setError(mensajeError(err));
      cargar(); // la existencia pudo cambiar
    }
  }

  if (info === undefined) return <Cargando />;
  const productos = info && info.negocio.pago_en_linea !== 'desactivado' ? info.productos || [] : [];
  if (!info || productos.length === 0) {
    return (
      <div className="pantalla-centro">
        <div className="tarjeta acceso centro">
          <h2>Por ahora no hay productos en línea</h2>
          <p className="tenue">Esta barbería todavía no vende productos por internet.</p>
          {info && <Link className="btn btn-primario" to={`/r/${info.negocio.slug}`}>Reservar una cita</Link>}
        </div>
      </div>
    );
  }

  const { negocio } = info;
  const m = (n: number) => dinero(n, negocio.moneda);
  const elegidos = productos.filter((p) => (carrito[p.id] || 0) > 0);
  const total = elegidos.reduce((a, p) => a + p.precio * carrito[p.id], 0);

  return (
    <div className="publica">
      <header className="publica-cabeza">
        <img src={negocio.logo_url || '/icon.svg'} alt="" width={48} height={48} />
        <div>
          <h1>{negocio.nombre}</h1>
          <p className="tenue pequeno">Productos para recoger en la sucursal</p>
        </div>
      </header>

      <section className="paso tienda">
        <h2><span className="num-paso">1</span> Elige tus productos</h2>
        <ProductosTienda productos={productos} carrito={carrito} moneda={negocio.moneda}
          onCambiar={(id, n) => setCarrito((c) => ({ ...c, [id]: n }))} />
      </section>

      {elegidos.length > 0 && (
        <form className="paso tarjeta formulario" onSubmit={pagar}>
          <h2><span className="num-paso">2</span> Tus datos</h2>
          <Campo etiqueta="Nombre"><input value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={2} maxLength={80} autoComplete="name" /></Campo>
          <Campo etiqueta="WhatsApp o teléfono"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} required inputMode="tel" autoComplete="tel" placeholder="10 dígitos" /></Campo>
          <Campo etiqueta="Comentario (opcional)"><input value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
          <div className="recoger">
            <p><strong>Recoger en sucursal</strong></p>
            <p className="pequeno">{negocio.direccion || negocio.nombre}</p>
            <p className="tenue pequeno">Cuando pagues te damos un número de pedido; muéstralo en la barbería para recoger.</p>
          </div>
          <div className="pago-resumen">
            <table className="resumen-tabla">
              <tbody>
                {elegidos.map((p) => (
                  <tr key={p.id}><td>{carrito[p.id]} × {p.nombre}</td><td className="num">{m(p.precio * carrito[p.id])}</td></tr>
                ))}
                <tr className="total"><td>Total a pagar</td><td className="num">{m(total)}</td></tr>
              </tbody>
            </table>
            <p className="tenue pequeno">Pago seguro con Mercado Pago. Tus productos quedan apartados 20 minutos mientras pagas.</p>
          </div>
          <Aviso>{error}</Aviso>
          <button className="btn btn-primario ancho grande" disabled={enviando}>
            {enviando ? 'Abriendo Mercado Pago…' : `Pagar ${m(total)}`}
          </button>
        </form>
      )}
      {elegidos.length === 0 && <Aviso>{error}</Aviso>}

      <footer className="publica-pie tenue pequeno">
        <Link to={`/r/${negocio.slug}`}>Reservar una cita</Link>
        {negocio.telefono && <> · ¿Dudas? Llama al <a href={`tel:${negocio.telefono}`}>{negocio.telefono}</a></>}
      </footer>
    </div>
  );
}
