import { createClient } from '@supabase/supabase-js';

// Valores por defecto: proyecto Supabase "barberaGo". La llave publicable es pública por diseño;
// la seguridad la dan las políticas RLS de la base.
const url = import.meta.env.VITE_SUPABASE_URL || 'https://lezysppzyzzwpqmavbyo.supabase.co';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_KvLKLJ1eQqs1DYml3CKijw_PjMUqika';

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Mensaje legible de un error de Supabase/Postgres. */
export function mensajeError(e: unknown): string {
  if (!e) return 'Ocurrió un error';
  const m = (e as { message?: string }).message || String(e);
  if (m.includes('citas_sin_empalme')) return 'Ese barbero ya tiene una cita en ese horario';
  if (m.includes('negocios_slug_key')) return 'Ese enlace ya lo usa otra barbería';
  if (m.includes('clientes_telefono_uidx')) return 'Ya existe un cliente con ese teléfono';
  if (m.includes('Invalid login credentials')) return 'Correo o contraseña incorrectos';
  if (m.includes('Email not confirmed')) return 'Confirma tu correo antes de entrar (revisa tu bandeja)';
  if (m.includes('User already registered')) return 'Ese correo ya tiene cuenta. Inicia sesión';
  return m;
}

/** Llama la Edge Function de pagos (Mercado Pago) y devuelve su respuesta o lanza el error legible. */
export async function llamarPagos<T>(cuerpo: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('pagos', { body: cuerpo });
  if (error) {
    const ctx = (error as { context?: Response }).context;
    const detalle = ctx && typeof ctx.json === 'function' ? await ctx.json().catch(() => null) : null;
    throw new Error(detalle?.error || 'No se pudo conectar con el sistema de pagos. Intenta de nuevo.');
  }
  return data as T;
}
