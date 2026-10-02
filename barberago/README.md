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
| `/r/:slug` | Clientes | Reserva en línea sin cuenta, con pago opcional u obligatorio; `/r/:slug/cancelar/:cita` para cancelar |
| `/r/:slug/pago/:cita` | Clientes | Regreso de Mercado Pago: confirma el pago, permite reintentar |

## Base de datos

Migraciones en `supabase/migrations/` (ya aplicadas en barberaGo). Puntos clave:

- `citas_sin_empalme`: restricción de exclusión que impide dos citas activas encimadas por barbero.
- `cobrar(...)`: crea la venta con folio consecutivo, calcula comisiones, descuenta inventario y cierra la cita.
- `reserva_negocio`, `reserva_horarios`, `reservar`, `reserva_cancelar`: únicas funciones abiertas a
  visitantes anónimos; calculan huecos con el horario, las citas y los bloqueos en la zona horaria del negocio.
- `crear_negocio`: la primera barbería de una cuenta arranca con 30 días de prueba.

## Pagos en línea (Mercado Pago)

Cada barbería conecta **su propia** cuenta en Ajustes > Pagos en línea pegando su Access Token
(producción `APP_USR-…` o de una cuenta de prueba). El dinero le llega directo; BarberaGo no lo toca.
La llave se guarda en `privado.pago_cuentas` y solo la lee la Edge Function `pagos`.

Opciones por barbería: no cobrar, que el cliente elija (pagar ahora o en la barbería) u obligar el pago,
cobrando el servicio completo o un anticipo (50, 30 o 20 %). Al conectar la cuenta queda en "pago obligatorio".

Flujo: el cliente elige horario → `pagos` (`crear`) aparta la cita 20 min con `pago_reservar` y crea la
preferencia de Checkout Pro → el cliente paga → Mercado Pago avisa al webhook
(`/functions/v1/pagos?accion=webhook&negocio=<id>`), la función consulta el pago con la llave de la
barbería y `pago_registrar` confirma la cita. Si el apartado venció y alguien más tomó el horario, el
pago se devuelve solo. La página de regreso también pregunta a Mercado Pago (`verificar`) por si el
aviso se atrasa. En Cobrar, lo pagado en línea se descuenta y se reporta aparte (`ventas.pagado_en_linea`).

Edge Function: `supabase/functions/pagos/index.ts` (desplegada con `verify_jwt = false`; cada acción
valida lo suyo). Variables opcionales: `APP_URL` (por defecto https://barberago.restorago.com) y `ORIGENES`.

Para dar acceso a un empleado: que cree su cuenta y luego agrégalo en Equipo con su correo.
Para crear códigos de activación, inserta filas en `codigos_activacion` desde el panel de Supabase.
