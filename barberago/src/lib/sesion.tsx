import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Barbero, Miembro, Negocio, Permiso, Servicio, Suscripcion } from './tipos';

const CLAVE_NEGOCIO = 'barberago.negocio';

interface Estado {
  cargando: boolean;
  session: Session | null;
  negocios: Negocio[];
  negocio: Negocio | null;
  miembro: Miembro | null;
  suscripcion: Suscripcion | null;
  barberos: Barbero[];
  servicios: Servicio[];
  puede: (p: Permiso) => boolean;
  elegirNegocio: (id: string) => void;
  recargar: () => Promise<void>;
  recargarCatalogo: () => Promise<void>;
  salir: () => Promise<void>;
}

const Ctx = createContext<Estado | null>(null);

export function useSesion(): Estado {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSesion fuera de SesionProvider');
  return v;
}

/** Igual que useSesion pero garantiza negocio y miembro (pantallas internas). */
export function useNegocio() {
  const s = useSesion();
  if (!s.negocio || !s.miembro) throw new Error('Sin negocio activo');
  return { ...s, negocio: s.negocio, miembro: s.miembro };
}

function leerGuardado(): string | null {
  try { return localStorage.getItem(CLAVE_NEGOCIO); } catch { return null; }
}

export function SesionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [listo, setListo] = useState(false);
  const [cargando, setCargando] = useState(true);
  const [negocios, setNegocios] = useState<Negocio[]>([]);
  const [miembros, setMiembros] = useState<Miembro[]>([]);
  const [suscripcion, setSuscripcion] = useState<Suscripcion | null>(null);
  const [actualId, setActualId] = useState<string | null>(leerGuardado());
  const [barberos, setBarberos] = useState<Barbero[]>([]);
  const [servicios, setServicios] = useState<Servicio[]>([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setListo(true); });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const uid = session?.user.id;
  const uidCargado = useRef<string | undefined>(undefined);

  const recargar = useCallback(async () => {
    if (!uid) { setNegocios([]); setMiembros([]); setSuscripcion(null); setCargando(false); return; }
    // Solo la primera carga de cada cuenta muestra "Cargando…"; las recargas no desmontan la pantalla
    // (así no se pierden los avisos de "Cambios guardados").
    if (uidCargado.current !== uid) setCargando(true);
    const [m, n, s] = await Promise.all([
      supabase.from('miembros').select('*').eq('usuario_id', uid).eq('activo', true),
      supabase.from('negocios').select('*').order('created_at'),
      supabase.from('suscripciones').select('plan, negocios_max, vence, origen').eq('usuario_id', uid).maybeSingle(),
    ]);
    setMiembros((m.data as Miembro[]) || []);
    setNegocios((n.data as Negocio[]) || []);
    setSuscripcion((s.data as Suscripcion) || null);
    uidCargado.current = uid;
    setCargando(false);
  }, [uid]);

  useEffect(() => { if (listo) recargar(); }, [listo, recargar]);

  const negocio = useMemo(
    () => negocios.find((n) => n.id === actualId) || negocios[0] || null,
    [negocios, actualId],
  );
  const miembro = useMemo(
    () => (negocio ? miembros.find((m) => m.negocio_id === negocio.id) || null : null),
    [miembros, negocio],
  );

  const recargarCatalogo = useCallback(async () => {
    if (!negocio) { setBarberos([]); setServicios([]); return; }
    const [b, s] = await Promise.all([
      supabase.from('barberos').select('*').eq('negocio_id', negocio.id).order('orden').order('nombre'),
      supabase.from('servicios').select('*').eq('negocio_id', negocio.id).order('orden').order('nombre'),
    ]);
    setBarberos((b.data as Barbero[]) || []);
    setServicios((s.data as Servicio[]) || []);
  }, [negocio]);

  useEffect(() => { recargarCatalogo(); }, [recargarCatalogo]);

  const valor: Estado = {
    cargando: !listo || cargando,
    session,
    negocios,
    negocio,
    miembro,
    suscripcion,
    barberos,
    servicios,
    puede: (p) => !!miembro && (miembro.rol === 'admin' || miembro.permisos.includes(p)),
    elegirNegocio: (id) => {
      setActualId(id);
      try { localStorage.setItem(CLAVE_NEGOCIO, id); } catch { /* sin almacenamiento */ }
    },
    recargar,
    recargarCatalogo,
    salir: async () => { await supabase.auth.signOut(); },
  };

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
