// BarberaGo · pagos en línea con Mercado Pago.
//
// Una sola función con varias acciones (verify_jwt = false: Mercado Pago no manda JWT y la app
// usa la llave publicable; cada acción valida lo suyo):
//   POST {accion:"crear", slug, servicio, barbero, inicio, nombre, telefono, notas}
//        Aparta el horario y devuelve la liga de pago de Mercado Pago.
//   POST {accion:"reintentar", cita}
//        Nueva liga de pago para un apartado que sigue vigente (tarjeta rechazada, ventana cerrada).
//   POST {accion:"verificar", cita}
//        Pregunta a Mercado Pago por los pagos de la cita (respaldo por si el aviso se atrasa).
//   POST {accion:"conectar", negocio, access_token}   (con la sesión del dueño)
//        Valida la llave con Mercado Pago y la guarda del lado del servidor.
//   POST ?accion=webhook&negocio=<id>
//        Aviso de Mercado Pago: consulta el pago y confirma la cita (o devuelve el dinero).
//
// La llave de cada barbería solo vive en privado.pago_cuentas; nunca llega al navegador.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SECRETA = (() => {
  try { return JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}').default as string | undefined; } catch { return undefined; }
})() || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_URL = Deno.env.get('APP_URL') || 'https://barberago.restorago.com';
const ORIGENES = (Deno.env.get('ORIGENES') || `${APP_URL},http://localhost:5173,http://localhost:4173`).split(',');
const MP = 'https://api.mercadopago.com';
const MINUTOS_APARTADO = 20;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(datos: unknown, status = 200) {
  return new Response(JSON.stringify(datos), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

class ErrorVisible extends Error {}

/** Llama una función de la base con la llave secreta (solo service_role puede usar las pago_*). */
async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const headers: Record<string, string> = { apikey: SECRETA, 'Content-Type': 'application/json' };
  if (SECRETA.startsWith('eyJ')) headers.Authorization = `Bearer ${SECRETA}`; // llave antigua (JWT)
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
  const texto = await r.text();
  const datos = texto ? JSON.parse(texto) : null;
  if (!r.ok) {
    // Los mensajes de raise exception de la base ya vienen en español para el cliente.
    if (datos?.code === 'P0001') throw new ErrorVisible(datos.message);
    throw new Error(`rpc ${fn}: ${r.status} ${texto}`);
  }
  return datos as T;
}

async function mp(token: string, ruta: string, init: RequestInit = {}) {
  const r = await fetch(`${MP}${ruta}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const datos = await r.json().catch(() => null);
  return { ok: r.ok, status: r.status, datos };
}

type Pago = { id: number; status: string; transaction_amount: number; external_reference: string | null };

/** Registra un pago de Mercado Pago en la cita y devuelve el dinero si ya no corresponde. */
async function procesarPago(token: string, negocioId: string, pago: Pago) {
  if (!pago.external_reference) return 'ignorado';
  const res = await rpc<string>('pago_registrar', {
    p_cita: pago.external_reference, p_negocio: negocioId, p_pago_id: String(pago.id),
    p_estado: pago.status, p_monto: pago.transaction_amount,
  });
  if (res === 'reembolsar') {
    const r = await mp(token, `/v1/payments/${pago.id}/refunds`, {
      method: 'POST', body: '{}', headers: { 'X-Idempotency-Key': `reembolso-${pago.id}` },
    });
    if (r.ok || r.status === 400 /* ya reembolsado */) {
      await rpc('pago_marcar_reembolso', { p_cita: pago.external_reference, p_pago_id: String(pago.id) });
    } else {
      console.error('No se pudo reembolsar', pago.id, r.status, r.datos);
    }
  }
  return res;
}

type Apartado = {
  id: string; servicio: string; servicio_id: string; monto: number; expira: string; access_token: string;
  negocio: { id: string; nombre: string; slug: string; moneda: string };
};

/** Crea la preferencia de Mercado Pago de un apartado; si falla, suelta el horario. */
async function ligaDePago(req: Request, r: Apartado, nombre: string) {
  const origen = req.headers.get('origin') || '';
  const base = ORIGENES.includes(origen) ? origen : APP_URL;
  const regreso = `${base}/r/${r.negocio.slug}/pago/${r.id}`;
  const preferencia = {
    items: [{
      id: r.servicio_id, title: `${r.servicio} · ${r.negocio.nombre}`.slice(0, 250),
      quantity: 1, unit_price: Number(r.monto), currency_id: r.negocio.moneda,
    }],
    payer: { name: nombre.slice(0, 80) },
    external_reference: r.id,
    metadata: { cita_id: r.id, negocio_id: r.negocio.id },
    notification_url: `${SUPABASE_URL}/functions/v1/pagos?accion=webhook&negocio=${r.negocio.id}`,
    back_urls: { success: regreso, failure: regreso, pending: regreso },
    ...(base.startsWith('https://') ? { auto_return: 'approved' } : {}),
    // Solo pagos al instante (tarjeta o saldo): OXXO o depósito tardarían más que el apartado.
    binary_mode: true,
    payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 },
    expires: true,
    expiration_date_from: new Date().toISOString(),
    expiration_date_to: new Date(r.expira).toISOString(),
    statement_descriptor: String(r.negocio.nombre).replace(/[^A-Za-z0-9 ]/g, '').slice(0, 13) || 'BARBERAGO',
  };
  const p = await mp(r.access_token, '/checkout/preferences', {
    method: 'POST', body: JSON.stringify(preferencia), headers: { 'X-Idempotency-Key': `pref-${r.id}-${Date.now()}` },
  });
  if (!p.ok || !p.datos?.init_point) {
    console.error('Mercado Pago rechazó la preferencia', p.status, p.datos);
    await rpc('pago_cancelar_apartado', { p_cita: r.id });
    throw new ErrorVisible('No se pudo iniciar el pago. Intenta de nuevo o avisa a la barbería.');
  }
  return json({ cita: r.id, url: p.datos.init_point, monto: r.monto, expira: r.expira });
}

async function crear(req: Request, b: Record<string, unknown>) {
  const r = await rpc<Apartado>('pago_reservar', {
    p_slug: b.slug, p_servicio: b.servicio, p_barbero: b.barbero || null, p_inicio: b.inicio,
    p_nombre: b.nombre, p_telefono: b.telefono, p_notas: b.notas || null, p_minutos: MINUTOS_APARTADO,
  });
  return ligaDePago(req, r, String(b.nombre || ''));
}

async function reintentar(req: Request, b: Record<string, unknown>) {
  const cita = String(b.cita || '');
  if (!/^[0-9a-f-]{36}$/i.test(cita)) throw new ErrorVisible('Cita no válida');
  const r = await rpc<Apartado & { nombre: string }>('pago_reintentar', { p_cita: cita });
  return ligaDePago(req, r, r.nombre || '');
}

async function verificar(b: Record<string, unknown>) {
  const cita = String(b.cita || '');
  if (!/^[0-9a-f-]{36}$/i.test(cita)) throw new ErrorVisible('Cita no válida');
  const cuenta = await rpc<{ negocio_id: string; access_token: string } | null>('pago_token', { p_cita: cita });
  if (!cuenta) return json({ ok: true });
  const r = await mp(cuenta.access_token, `/v1/payments/search?external_reference=${cita}&sort=date_created&criteria=desc`);
  for (const pago of (r.datos?.results || []) as Pago[]) {
    if (pago.external_reference === cita && pago.status === 'approved') await procesarPago(cuenta.access_token, cuenta.negocio_id, pago);
  }
  return json({ ok: true });
}

async function conectar(req: Request, b: Record<string, unknown>) {
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SECRETA, Authorization: `Bearer ${jwt}` } });
  if (!u.ok) throw new ErrorVisible('Inicia sesión de nuevo');
  const usuario = await u.json();
  const negocio = String(b.negocio || '');
  const permiso = await rpc<boolean>('pago_puede_configurar', { p_negocio: negocio, p_usuario: usuario.id });
  if (!permiso) throw new ErrorVisible('Solo quien tiene permiso de Ajustes puede conectar los pagos');

  const token = String(b.access_token || '').trim();
  if (!/^(APP_USR|TEST)-[\w-]{20,}$/.test(token)) throw new ErrorVisible('Pega el Access Token completo (empieza con APP_USR- o TEST-)');
  const yo = await mp(token, '/users/me');
  if (!yo.ok) throw new ErrorVisible('Mercado Pago no reconoce ese Access Token');
  const prueba = token.startsWith('TEST-') || /^TEST/i.test(yo.datos?.nickname || '') || (yo.datos?.tags || []).includes('test_user');
  const cuenta = String(yo.datos?.nickname || yo.datos?.email || yo.datos?.id);
  await rpc('pago_guardar_cuenta', { p_negocio: negocio, p_token: token, p_cuenta: cuenta, p_prueba: prueba });
  return json({ cuenta, prueba });
}

async function webhook(url: URL, req: Request) {
  const negocio = url.searchParams.get('negocio') || '';
  const cuerpo = await req.json().catch(() => ({} as Record<string, any>));
  const tipo = cuerpo.type || cuerpo.topic || url.searchParams.get('type') || url.searchParams.get('topic');
  const id = cuerpo.data?.id || url.searchParams.get('data.id') || url.searchParams.get('id');
  if (tipo !== 'payment' || !id || !/^[0-9a-f-]{36}$/i.test(negocio)) return json({ ok: true });
  const cuenta = await rpc<{ negocio_id: string; access_token: string } | null>('pago_token', { p_negocio: negocio });
  if (!cuenta) return json({ ok: true });
  // Nunca se confía en el cuerpo del aviso: se consulta el pago con la llave de la barbería.
  const r = await mp(cuenta.access_token, `/v1/payments/${encodeURIComponent(String(id))}`);
  if (!r.ok) return json({ ok: false }, r.status === 404 ? 200 : 500);
  await procesarPago(cuenta.access_token, negocio, r.datos as Pago);
  return json({ ok: true });
}

export async function manejar(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('accion') === 'webhook') return await webhook(url, req);
    const b = await req.json().catch(() => ({}));
    switch (b.accion) {
      case 'crear': return await crear(req, b);
      case 'reintentar': return await reintentar(req, b);
      case 'verificar': return await verificar(b);
      case 'conectar': return await conectar(req, b);
      default: return json({ error: 'Acción no válida' }, 400);
    }
  } catch (e) {
    if (e instanceof ErrorVisible) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'Ocurrió un error con el pago. Intenta de nuevo.' }, 500);
  }
}

Deno.serve(manejar);
