import { useState, type FormEvent } from 'react';
import { supabase, mensajeError } from '../lib/supabase';
import { Aviso, Campo } from '../components/ui';

type Modo = 'entrar' | 'registro' | 'recuperar';

export default function Entrar() {
  const [modo, setModo] = useState<Modo>('entrar');
  const [nombre, setNombre] = useState('');
  const [email, setEmail] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk(''); setEnviando(true);
    try {
      if (modo === 'entrar') {
        const { error } = await supabase.auth.signInWithPassword({ email, password: clave });
        if (error) throw error;
      } else if (modo === 'registro') {
        const { data, error } = await supabase.auth.signUp({
          email, password: clave,
          options: { data: { nombre }, emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (!data.session) setOk('Te enviamos un correo para confirmar tu cuenta. Ábrelo y luego inicia sesión.');
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
        if (error) throw error;
        setOk('Si el correo existe, te llegará un enlace para cambiar tu contraseña.');
      }
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="pantalla-centro">
      <form className="tarjeta acceso" onSubmit={enviar}>
        <div className="marca grande">
          <img src="/icon.svg" alt="" width={44} height={44} />
          <span>BarberaGo</span>
        </div>
        <p className="tenue">Agenda, reservas en línea, cobro y comisiones para tu barbería.</p>
        {modo === 'registro' && (
          <Campo etiqueta="Tu nombre">
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} required autoComplete="name" />
          </Campo>
        )}
        <Campo etiqueta="Correo">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        </Campo>
        {modo !== 'recuperar' && (
          <Campo etiqueta="Contraseña">
            <input type="password" value={clave} onChange={(e) => setClave(e.target.value)} required minLength={6}
              autoComplete={modo === 'registro' ? 'new-password' : 'current-password'} />
          </Campo>
        )}
        <Aviso>{error}</Aviso>
        <Aviso tipo="ok">{ok}</Aviso>
        <button className="btn btn-primario ancho" disabled={enviando}>
          {modo === 'entrar' ? 'Entrar' : modo === 'registro' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
        <div className="enlaces-acceso">
          {modo !== 'entrar' && <button type="button" className="btn-texto" onClick={() => setModo('entrar')}>Ya tengo cuenta</button>}
          {modo !== 'registro' && <button type="button" className="btn-texto" onClick={() => setModo('registro')}>Crear cuenta nueva</button>}
          {modo === 'entrar' && <button type="button" className="btn-texto" onClick={() => setModo('recuperar')}>Olvidé mi contraseña</button>}
        </div>
      </form>
    </div>
  );
}
