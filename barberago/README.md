# BarberaGo

Programa para barberías: agenda por barbero, fila de clientes sin cita, reservas en línea,
cobro con propina, comisiones, clientes, inventario y reportes. Una sola aplicación web que
se instala en el celular (PWA) y se puede empaquetar para Android e iOS con Capacitor.

Usa el proyecto de Supabase **barberaGo** (`lezysppzyzzwpqmavbyo`) y sigue los patrones de
HiRestaurant: multi-negocio, miembros con rol y permisos, suscripciones y códigos de activación.

## Correr en local

```bash
cd barberago
npm install
npm run dev        # http://localhost:5173
```

Las variables de `.env.example` ya apuntan a barberaGo; la llave publicable es pública por
diseño y la seguridad la dan las políticas RLS. Para otro proyecto, copia `.env.example` a `.env`.

## Publicar

- **Web / PWA:** `npm run build` y sube `dist/` a cualquier hosting estático (Hostinger, Netlify,
  Vercel). `public/.htaccess` ya redirige las rutas a `index.html` en Apache/Hostinger.
  En el celular se instala desde el navegador con "Agregar a pantalla de inicio".
- **Android / iOS:** `npx cap add android` (o `ios`) una vez, luego `npm run cap:android`
  (o `cap:ios`) para abrir Android Studio / Xcode y generar la app.
- En Supabase > Authentication > URL Configuration agrega el dominio publicado como Site URL
  para que funcionen los correos de confirmación y de cambio de contraseña.

## Pantallas

| Ruta | Para quién | Qué hace |
| --- | --- | --- |
| `/agenda` | Equipo | Día por barbero (columnas en escritorio, pestañas en celular), fila sin cita, bloqueos, en vivo |
| `/cobrar` | Equipo | Servicios y productos, descuento, propina, efectivo/tarjeta/transferencia, ticket |
| `/clientes` | Equipo | Fichas, notas, historial, WhatsApp |
| `/ventas` | Caja | Ventas del día por método, anular |
| `/reportes` | Dueño | Ventas, pago a barberos (comisión + propinas), top servicios |
| `/servicios`, `/productos` | Dueño | Catálogo e inventario |
| `/equipo` | Dueño | Barberos (color, horario, comisiones) y cuentas con permisos |
| `/ajustes` | Dueño | Datos, horario, reglas de reserva, enlace público, plan |
| `/r/:slug` | Clientes | Reserva en línea sin cuenta; `/r/:slug/cancelar/:cita` para cancelar |

## Base de datos

Migraciones en `supabase/migrations/` (ya aplicadas en barberaGo). Puntos clave:

- `citas_sin_empalme`: restricción de exclusión que impide dos citas activas encimadas por barbero.
- `cobrar(...)`: crea la venta con folio consecutivo, calcula comisiones, descuenta inventario y cierra la cita.
- `reserva_negocio`, `reserva_horarios`, `reservar`, `reserva_cancelar`: únicas funciones abiertas a
  visitantes anónimos; calculan huecos con el horario, las citas y los bloqueos en la zona horaria del negocio.
- `crear_negocio`: la primera barbería de una cuenta arranca con 30 días de prueba.

Para dar acceso a un empleado: que cree su cuenta y luego agrégalo en Equipo con su correo.
Para crear códigos de activación, inserta filas en `codigos_activacion` desde el panel de Supabase.
