export type Permiso = 'agenda' | 'clientes' | 'cobrar' | 'caja' | 'catalogo' | 'inventario' | 'reportes' | 'equipo' | 'ajustes';
export const PERMISOS: { id: Permiso; nombre: string }[] = [
  { id: 'agenda', nombre: 'Agenda' },
  { id: 'clientes', nombre: 'Clientes' },
  { id: 'cobrar', nombre: 'Cobrar' },
  { id: 'caja', nombre: 'Ventas y caja' },
  { id: 'catalogo', nombre: 'Servicios' },
  { id: 'inventario', nombre: 'Productos' },
  { id: 'reportes', nombre: 'Reportes' },
  { id: 'equipo', nombre: 'Equipo' },
  { id: 'ajustes', nombre: 'Ajustes' },
];

/** Horario semanal: día ISO ("1" = lunes … "7" = domingo) → tramos [abre, cierra] en "HH:MM". */
export type Horario = Record<string, [string, string][]>;

export interface Negocio {
  id: string;
  nombre: string;
  slug: string;
  telefono: string | null;
  direccion: string | null;
  logo_url: string | null;
  zona_horaria: string;
  moneda: string;
  horario: Horario;
  intervalo_min: number;
  anticipacion_min: number;
  reserva_online: boolean;
  creado_por: string | null;
  pago_en_linea: ModoPago;
  anticipo_pct: number;
  pago_cuenta: string | null;
  pago_prueba: boolean;
}

/** Cobro al reservar en línea: sin pago, el cliente elige, o pago obligatorio. */
export type ModoPago = 'desactivado' | 'opcional' | 'obligatorio';
export type EstadoPago = 'pendiente' | 'pagado' | 'expirado' | 'fallido' | 'reembolsar' | 'reembolsado';

export interface Miembro {
  negocio_id: string;
  usuario_id: string;
  rol: 'admin' | 'recepcion' | 'barbero';
  permisos: Permiso[];
  activo: boolean;
  nombre: string;
  email: string | null;
  barbero_id: string | null;
}

export interface Barbero {
  id: string;
  negocio_id: string;
  nombre: string;
  telefono: string | null;
  color: string;
  foto_url: string | null;
  horario: Horario | null;
  comision_servicios: number;
  comision_productos: number;
  en_linea: boolean;
  activo: boolean;
  orden: number;
}

export interface Servicio {
  id: string;
  negocio_id: string;
  nombre: string;
  descripcion: string | null;
  categoria: string | null;
  duracion_min: number;
  precio: number;
  en_linea: boolean;
  activo: boolean;
  orden: number;
}

export interface Producto {
  id: string;
  negocio_id: string;
  nombre: string;
  sku: string | null;
  precio: number;
  costo: number;
  stock: number;
  stock_minimo: number;
  activo: boolean;
}

export interface Cliente {
  id: string;
  negocio_id: string;
  nombre: string;
  telefono: string | null;
  email: string | null;
  nacimiento: string | null;
  notas: string | null;
  etiquetas: string[];
  created_at: string;
}

export type EstadoCita = 'pendiente' | 'confirmada' | 'en_espera' | 'en_curso' | 'completada' | 'cancelada' | 'no_asistio';
export const ESTADOS: Record<EstadoCita, string> = {
  pendiente: 'Por confirmar',
  confirmada: 'Confirmada',
  en_espera: 'En fila',
  en_curso: 'Atendiendo',
  completada: 'Cobrada',
  cancelada: 'Cancelada',
  no_asistio: 'No llegó',
};

export interface Cita {
  id: string;
  negocio_id: string;
  cliente_id: string | null;
  cliente_nombre: string | null;
  barbero_id: string | null;
  servicio_id: string | null;
  inicio: string;
  fin: string;
  estado: EstadoCita;
  origen: 'agenda' | 'en_linea' | 'sin_cita';
  precio: number | null;
  notas: string | null;
  pago_estado: EstadoPago | null;
  pago_monto: number | null;
  pago_expira: string | null;
  clientes?: { nombre: string; telefono: string | null } | null;
}

export interface Bloqueo {
  id: string;
  negocio_id: string;
  barbero_id: string | null;
  inicio: string;
  fin: string;
  motivo: string | null;
}

export interface Venta {
  id: string;
  folio: number;
  fecha: string;
  cliente_id: string | null;
  barbero_id: string | null;
  subtotal: number;
  descuento: number;
  propina: number;
  total: number;
  metodo_pago: 'efectivo' | 'tarjeta' | 'transferencia';
  pagado_en_linea: number;
  estado: 'pagada' | 'anulada';
  notas: string | null;
  clientes?: { nombre: string } | null;
  venta_items?: { nombre: string; cantidad: number; importe: number; tipo: string }[];
}

export interface Suscripcion {
  plan: string;
  negocios_max: number;
  vence: string;
  origen: string;
}

/** Apartado en línea que venció sin pagarse: ya no ocupa el horario. */
export function apartadoVencido(c: Pick<Cita, 'pago_estado' | 'pago_expira'>): boolean {
  return c.pago_estado === 'pendiente' && !!c.pago_expira && new Date(c.pago_expira) < new Date();
}
