import { useState, type FormEvent } from 'react';
import { supabase, mensajeError, llamarPagos } from '../lib/supabase';
import { useNegocio } from '../lib/sesion';
import type { ModoPago } from '../lib/tipos';
import { Aviso, Campo } from './ui';

/** Ajustes > Pagos en línea: conectar Mercado Pago y decidir si se cobra al reservar. */
export default function PagosAjustes() {
  const { negocio, recargar } = useNegocio();
  const [token, setToken] = useState('');
  const [modo, setModo] = useState<ModoPago>(negocio.pago_en_linea);
  const [pct, setPct] = useState(negocio.anticipo_pct);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const [enviando, setEnviando] = useState(false);
  const conectada = !!negocio.pago_cuenta;

  async function conectar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk(''); setEnviando(true);
    try {
      const r = await llamarPagos<{ cuenta: string; prueba: boolean }>({ accion: 'conectar', negocio: negocio.id, access_token: token });
      setToken('');
      setOk(`Cuenta ${r.cuenta} conectada${r.prueba ? ' en modo de prueba' : ''}. Ya puedes cobrar al reservar.`);
      setModo((m) => (m === 'desactivado' ? 'opcional' : m));
      await recargar();
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(''); setOk('');
    const { error } = await supabase.from('negocios').update({ pago_en_linea: modo, anticipo_pct: pct }).eq('id', negocio.id);
    if (error) return setError(mensajeError(error));
    setOk('Cambios guardados.');
    recargar();
  }

  async function desconectar() {
    if (!confirm('¿Desconectar Mercado Pago? Tus clientes ya no podrán pagar al reservar.')) return;
    setError(''); setOk('');
    const { error } = await supabase.rpc('pago_desconectar', { p_negocio: negocio.id });
    if (error) return setError(mensajeError(error));
    setModo('desactivado');
    setOk('Mercado Pago desconectado.');
    recargar();
  }

  return (
    <section className="tarjeta formulario">
      <h2>Pagos en línea</h2>
      {!conectada ? (
        <form onSubmit={conectar} className="formulario">
          <p>Cobra el servicio o un anticipo cuando el cliente reserva. El dinero llega directo a tu cuenta de Mercado Pago.</p>
          <ol className="pasos-lista pequeno">
            <li>Entra a <a href="https://www.mercadopago.com.mx/developers/panel/app" target="_blank" rel="noreferrer">Mercado Pago Developers</a> y crea una aplicación (Checkout Pro).</li>
            <li>En <strong>Credenciales de producción</strong> copia el <strong>Access Token</strong> (empieza con APP_USR-). Para probar, usa el de una cuenta de prueba.</li>
            <li>Pégalo aquí. Se guarda solo en el servidor; nadie del equipo lo puede ver.</li>
          </ol>
          <Campo etiqueta="Access Token de Mercado Pago">
            <input value={token} onChange={(e) => setToken(e.target.value.trim())} required placeholder="APP_USR-…" autoComplete="off" spellCheck={false} />
          </Campo>
          <Aviso>{error}</Aviso>
          <Aviso tipo="ok">{ok}</Aviso>
          <button className="btn btn-primario" disabled={enviando}>{enviando ? 'Conectando…' : 'Conectar Mercado Pago'}</button>
        </form>
      ) : (
        <form onSubmit={guardar} className="formulario">
          <p>
            Conectado a Mercado Pago: <strong>{negocio.pago_cuenta}</strong>
            {negocio.pago_prueba && <span className="insignia insignia-prueba">Modo prueba</span>}
          </p>
          {negocio.pago_prueba && (
            <Aviso tipo="info">Es una cuenta de prueba: los pagos no son reales. Cuando quieras cobrar de verdad, desconecta y pega el Access Token de producción.</Aviso>
          )}
          <Campo etiqueta="Al reservar en línea">
            <select value={modo} onChange={(e) => setModo(e.target.value as ModoPago)}>
              <option value="opcional">El cliente elige: pagar ahora o en la barbería</option>
              <option value="obligatorio">Pago obligatorio para reservar</option>
              <option value="desactivado">No cobrar en línea</option>
            </select>
          </Campo>
          {modo !== 'desactivado' && (
            <Campo etiqueta="Cuánto se cobra" ayuda="Un anticipo ayuda a que no te dejen plantado; el resto se cobra en la barbería.">
              <select value={pct} onChange={(e) => setPct(Number(e.target.value))}>
                {[100, 50, 30, 20].map((n) => <option key={n} value={n}>{n === 100 ? 'El servicio completo' : `Anticipo del ${n}%`}</option>)}
              </select>
            </Campo>
          )}
          <Aviso>{error}</Aviso>
          <Aviso tipo="ok">{ok}</Aviso>
          <div className="acciones">
            <button className="btn btn-primario">Guardar</button>
            <button type="button" className="btn btn-peligro" onClick={desconectar}>Desconectar</button>
          </div>
        </form>
      )}
    </section>
  );
}
