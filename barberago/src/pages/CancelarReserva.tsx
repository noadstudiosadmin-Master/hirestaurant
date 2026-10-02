import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase, mensajeError } from '../lib/supabase';
import { Aviso, Campo } from '../components/ui';

export default function CancelarReserva() {
  const { slug = '', cita = '' } = useParams();
  const [telefono, setTelefono] = useState('');
  const [error, setError] = useState('');
  const [hecho, setHecho] = useState(false);

  async function cancelar(e: FormEvent) {
    e.preventDefault();
    setError('');
    const { error } = await supabase.rpc('reserva_cancelar', { p_cita: cita, p_telefono: telefono });
    if (error) return setError(mensajeError(error));
    setHecho(true);
  }

  return (
    <div className="pantalla-centro">
      <div className="tarjeta acceso">
        {hecho ? (
          <>
            <h2>Cita cancelada</h2>
            <p>Gracias por avisar. Cuando quieras, vuelve a reservar.</p>
            <Link className="btn btn-primario" to={`/r/${slug}`}>Reservar otra vez</Link>
          </>
        ) : (
          <form onSubmit={cancelar} className="formulario">
            <h2>Cancelar mi cita</h2>
            <p className="tenue">Escribe el teléfono con el que reservaste.</p>
            <Campo etiqueta="Teléfono"><input value={telefono} onChange={(e) => setTelefono(e.target.value)} required inputMode="tel" /></Campo>
            <Aviso>{error}</Aviso>
            <button className="btn btn-peligro ancho">Cancelar cita</button>
            <Link to={`/r/${slug}`} className="btn-texto">Volver</Link>
          </form>
        )}
      </div>
    </div>
  );
}
