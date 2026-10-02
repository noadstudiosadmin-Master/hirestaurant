import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { useSesion } from '../lib/sesion';
import { Aviso, Campo } from '../components/ui';
import { fechaCorta } from '../lib/formato';

/** Alta de barbería (primera o adicional) y canje de códigos de activación. */
export default function Bienvenida() {
  const { session, suscripcion, negocios, recargar, elegirNegocio, salir } = useSesion();
  const navegar = useNavigate();
  const [nombre, setNombre] = useState('');
  const [codigo, setCodigo] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function crear(e: FormEvent) {
    e.preventDefault();
    setError(''); setEnviando(true);
    const { data, error } = await supabase.rpc('crear_negocio', { p_nombre: nombre });
    setEnviando(false);
    if (error) return setError(mensajeError(error));
    elegirNegocio(data as string);
    await recargar();
    navegar('/agenda');
  }

  async function canjear(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk('');
    const { error } = await supabase.rpc('canjear_codigo', { p_codigo: codigo });
    if (error) return setError(mensajeError(error));
    setCodigo('');
    setOk('Código aplicado.');
    await recargar();
  }

  const dentro = negocios.length > 0;
  return (
    <div className={dentro ? 'pagina angosta' : 'pantalla-centro'}>
      <div className="tarjeta acceso">
        {!dentro && (
          <div className="marca grande">
            <img src="/icon.svg" alt="" width={44} height={44} />
            <span>BarberaGo</span>
          </div>
        )}
        <h2>{dentro ? 'Agregar otra barbería' : 'Crea tu barbería'}</h2>
        <p className="tenue">
          {suscripcion
            ? `Plan ${suscripcion.plan}: hasta ${suscripcion.negocios_max} sucursal(es), vence el ${fechaCorta(suscripcion.vence)}.`
            : 'Tu primera barbería incluye 30 días de prueba gratis.'}
        </p>
        <form onSubmit={crear}>
          <Campo etiqueta="Nombre de la barbería">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={60} required placeholder="Ej. Barbería Don Pepe" />
          </Campo>
          <button className="btn btn-primario ancho" disabled={enviando}>Crear barbería</button>
        </form>
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{ok}</Aviso>
        <details className="plegable">
          <summary>Tengo un código de activación</summary>
          <form onSubmit={canjear} className="fila">
            <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="CÓDIGO" required aria-label="Código" />
            <button className="btn">Canjear</button>
          </form>
        </details>
        {!dentro && (
          <>
            <p className="tenue pequeno">
              ¿Trabajas en una barbería? Pide al administrador que te agregue con tu correo <strong>{session?.user.email}</strong> y vuelve a entrar.
            </p>
            <button className="btn-texto" onClick={() => recargar()}>Ya me agregaron</button>
            <button className="btn-texto" onClick={salir}>Cerrar sesión</button>
          </>
        )}
      </div>
    </div>
  );
}
