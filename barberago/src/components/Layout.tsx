import { NavLink, Outlet } from 'react-router-dom';
import { useNegocio } from '../lib/sesion';
import type { Permiso } from '../lib/tipos';
import { fechaCorta } from '../lib/formato';

const MENU: { a: string; nombre: string; icono: string; permiso: Permiso; movil?: boolean }[] = [
  { a: '/agenda', nombre: 'Agenda', icono: '📅', permiso: 'agenda', movil: true },
  { a: '/cobrar', nombre: 'Cobrar', icono: '💵', permiso: 'cobrar', movil: true },
  { a: '/pedidos', nombre: 'Pedidos', icono: '🛍️', permiso: 'cobrar' },
  { a: '/clientes', nombre: 'Clientes', icono: '👥', permiso: 'clientes', movil: true },
  { a: '/ventas', nombre: 'Ventas', icono: '🧾', permiso: 'caja' },
  { a: '/reportes', nombre: 'Reportes', icono: '📊', permiso: 'reportes', movil: true },
  { a: '/servicios', nombre: 'Servicios', icono: '✂️', permiso: 'catalogo' },
  { a: '/productos', nombre: 'Productos', icono: '🧴', permiso: 'inventario' },
  { a: '/equipo', nombre: 'Equipo', icono: '💈', permiso: 'equipo' },
  { a: '/ajustes', nombre: 'Ajustes', icono: '⚙️', permiso: 'ajustes' },
];

export default function Layout() {
  const { negocio, negocios, elegirNegocio, puede, salir, suscripcion, session } = useNegocio();
  const menu = MENU.filter((m) => puede(m.permiso));
  const movil = menu.filter((m) => m.movil).slice(0, 4);
  const vencida = suscripcion && negocio.creado_por === session?.user.id && new Date(suscripcion.vence) < new Date();
  const porVencer = suscripcion && !vencida && negocio.creado_por === session?.user.id
    && new Date(suscripcion.vence).getTime() - Date.now() < 5 * 864e5;

  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca">
          <img src="/icon.svg" alt="" width={32} height={32} />
          <span>BarberaGo</span>
        </div>
        {negocios.length > 1 ? (
          <select className="selector-negocio" value={negocio.id} onChange={(e) => elegirNegocio(e.target.value)} aria-label="Barbería">
            {negocios.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
        ) : (
          <div className="nombre-negocio">{negocio.nombre}</div>
        )}
        <nav>
          {menu.map((m) => (
            <NavLink key={m.a} to={m.a} className={({ isActive }) => (isActive ? 'activo' : '')}>
              <span aria-hidden>{m.icono}</span> {m.nombre}
            </NavLink>
          ))}
        </nav>
        <button className="btn-texto salir" onClick={salir}>Cerrar sesión</button>
      </aside>

      <main className="contenido">
        <div className="barra-movil">
          <img src="/icon.svg" alt="" width={26} height={26} />
          {negocios.length > 1 ? (
            <select value={negocio.id} onChange={(e) => elegirNegocio(e.target.value)} aria-label="Barbería">
              {negocios.map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
            </select>
          ) : <strong>{negocio.nombre}</strong>}
        </div>
        {vencida && <div className="aviso aviso-error banda">Tu suscripción venció el {fechaCorta(suscripcion!.vence)}. Las reservas en línea están pausadas. <NavLink to="/ajustes">Renovar</NavLink></div>}
        {porVencer && <div className="aviso aviso-info banda">Tu plan ({suscripcion!.plan}) vence el {fechaCorta(suscripcion!.vence)}. <NavLink to="/ajustes">Ver plan</NavLink></div>}
        <Outlet />
      </main>

      <nav className="nav-movil">
        {movil.map((m) => (
          <NavLink key={m.a} to={m.a} className={({ isActive }) => (isActive ? 'activo' : '')}>
            <span aria-hidden>{m.icono}</span>
            <small>{m.nombre}</small>
          </NavLink>
        ))}
        <NavLink to="/mas" className={({ isActive }) => (isActive ? 'activo' : '')}>
          <span aria-hidden>☰</span>
          <small>Más</small>
        </NavLink>
      </nav>
    </div>
  );
}

/** Menú completo para celular. */
export function Mas() {
  const { puede, salir, negocio } = useNegocio();
  return (
    <div className="pagina">
      <h1>{negocio.nombre}</h1>
      <div className="lista-mas">
        {MENU.filter((m) => puede(m.permiso)).map((m) => (
          <NavLink key={m.a} to={m.a} className="tarjeta fila-enlace">
            <span aria-hidden>{m.icono}</span> {m.nombre}
          </NavLink>
        ))}
        <button className="tarjeta fila-enlace" onClick={salir}>↩ Cerrar sesión</button>
      </div>
    </div>
  );
}
