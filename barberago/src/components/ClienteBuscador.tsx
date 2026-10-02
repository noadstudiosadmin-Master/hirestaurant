import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Cliente } from '../lib/tipos';

export type ClienteElegido = { id: string | null; nombre: string; telefono: string };

/**
 * Busca clientes por nombre o teléfono. Si no existe, deja escribir nombre y teléfono
 * para crear la ficha al guardar (ver asegurarCliente).
 */
export default function ClienteBuscador({ negocioId, valor, onCambio }: {
  negocioId: string; valor: ClienteElegido; onCambio: (c: ClienteElegido) => void;
}) {
  const [resultados, setResultados] = useState<Cliente[]>([]);
  const [abierto, setAbierto] = useState(false);
  const texto = valor.nombre;

  useEffect(() => {
    if (valor.id || texto.trim().length < 2) { setResultados([]); return; }
    const t = setTimeout(async () => {
      const q = texto.trim().replace(/[%,()]/g, '');
      const digitos = q.replace(/\D/g, '');
      let consulta = supabase.from('clientes').select('*').eq('negocio_id', negocioId).limit(6);
      consulta = digitos.length >= 3
        ? consulta.or(`nombre.ilike.%${q}%,telefono.ilike.%${digitos}%`)
        : consulta.ilike('nombre', `%${q}%`);
      const { data } = await consulta;
      setResultados((data as Cliente[]) || []);
    }, 200);
    return () => clearTimeout(t);
  }, [texto, valor.id, negocioId]);

  return (
    <div className="buscador">
      <div className="fila">
        <input
          value={valor.nombre}
          onChange={(e) => { onCambio({ id: null, nombre: e.target.value, telefono: valor.telefono }); setAbierto(true); }}
          onFocus={() => setAbierto(true)}
          onBlur={() => setTimeout(() => setAbierto(false), 150)}
          placeholder="Nombre o teléfono del cliente"
          aria-label="Cliente"
        />
        {valor.id && <button type="button" className="btn-icono" onClick={() => onCambio({ id: null, nombre: '', telefono: '' })} aria-label="Quitar cliente">✕</button>}
      </div>
      {abierto && resultados.length > 0 && (
        <ul className="sugerencias">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" onMouseDown={() => { onCambio({ id: c.id, nombre: c.nombre, telefono: c.telefono || '' }); setAbierto(false); }}>
                <strong>{c.nombre}</strong> <span className="tenue">{c.telefono}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!valor.id && valor.nombre.trim().length > 1 && (
        <input
          className="mt"
          value={valor.telefono}
          onChange={(e) => onCambio({ ...valor, telefono: e.target.value })}
          placeholder="Teléfono (opcional, crea su ficha)"
          inputMode="tel"
          aria-label="Teléfono del cliente"
        />
      )}
    </div>
  );
}

/** Devuelve el id del cliente; crea la ficha si se dio teléfono y no existe. */
export async function asegurarCliente(negocioId: string, c: ClienteElegido): Promise<string | null> {
  if (c.id) return c.id;
  const tel = c.telefono.replace(/\D/g, '');
  if (!c.nombre.trim() || tel.length < 8) return null;
  const { data: existente } = await supabase.from('clientes').select('id').eq('negocio_id', negocioId).eq('telefono', tel).maybeSingle();
  if (existente) return existente.id as string;
  const { data, error } = await supabase.from('clientes')
    .insert({ negocio_id: negocioId, nombre: c.nombre.trim(), telefono: tel }).select('id').single();
  if (error) throw error;
  return data.id as string;
}
