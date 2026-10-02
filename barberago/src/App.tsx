import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { SesionProvider, useSesion } from './lib/sesion';
import Layout, { Mas } from './components/Layout';
import { Cargando } from './components/ui';
import Entrar from './pages/Entrar';
import Bienvenida from './pages/Bienvenida';
import Agenda from './pages/Agenda';
import Cobrar from './pages/Cobrar';
import Clientes from './pages/Clientes';
import Ventas from './pages/Ventas';
import Reportes from './pages/Reportes';
import Servicios from './pages/Servicios';
import Productos from './pages/Productos';
import Equipo from './pages/Equipo';
import Ajustes from './pages/Ajustes';
import Reservar from './pages/Reservar';
import CancelarReserva from './pages/CancelarReserva';

function Interno() {
  const { cargando, session, negocio, miembro, puede } = useSesion();
  if (cargando) return <Cargando />;
  if (!session) return <Entrar />;
  if (!negocio || !miembro) return <Bienvenida />;
  const inicio = puede('agenda') ? '/agenda' : puede('cobrar') ? '/cobrar' : '/mas';
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/cobrar" element={<Cobrar />} />
        <Route path="/clientes" element={<Clientes />} />
        <Route path="/ventas" element={<Ventas />} />
        <Route path="/reportes" element={<Reportes />} />
        <Route path="/servicios" element={<Servicios />} />
        <Route path="/productos" element={<Productos />} />
        <Route path="/equipo" element={<Equipo />} />
        <Route path="/ajustes" element={<Ajustes />} />
        <Route path="/mas" element={<Mas />} />
        <Route path="/nueva-barberia" element={<Bienvenida />} />
        <Route path="*" element={<Navigate to={inicio} replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Páginas públicas para clientes: no requieren cuenta. */}
        <Route path="/r/:slug" element={<Reservar />} />
        <Route path="/r/:slug/cancelar/:cita" element={<CancelarReserva />} />
        <Route path="/*" element={<SesionProvider><Interno /></SesionProvider>} />
      </Routes>
    </BrowserRouter>
  );
}
