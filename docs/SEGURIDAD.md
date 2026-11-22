# Seguridad del POS — configuración y operación

Resumen de las medidas de seguridad vigentes y cómo configurarlas. Origen: informe de estado
del 22/11/2026 (secciones 6-7 y prioridades). La autenticación de usuarios sigue siendo 100 %
del lado cliente (POS offline): estas medidas protegen la **red local** y las **acciones
destructivas**, no sustituyen un backend.

## 1. BD central en disco (`/__local_db/*`)

El servidor (Vite) expone la BD central (`datos-pos/pos-db.json`) para que los navegadores de
la central y de otras PCs de la red la compartan. Antes no pedía autenticación y escuchaba en
todas las interfaces: cualquier equipo de la red podía leer o reemplazar la BD completa
(usuarios y hashes incluidos).

### Reglas de acceso (`src/utils/localDiskDbAuth.js`)

1. **Sin token configurado → se niega todo** (falla cerrado, 503).
2. Si la petición trae `Origin` y no coincide con el `Host` → **403** (anti CSRF: otra página
   web abierta en la central no puede llamar a `localhost:3001/__local_db`).
3. **Petición desde la propia máquina** (socket loopback **y** `Host` = `localhost`/`127.x`/`[::1]`)
   → permitida **sin token**. El chequeo de `Host` evita el DNS rebinding. Esto mantiene
   intacto el flujo de la central (`iniciar-servicio-silencioso.bat` abre `http://localhost:3001`).
4. **Cualquier otra PC de la red** → exige el token: cabecera `X-POS-Token`,
   `Authorization: Bearer <token>` o `?token=` (el stream SSE usa query porque `EventSource`
   no admite cabeceras). Sin token o con token inválido → **401**.

Además: `GET /__local_db/token` solo responde a la propia máquina (403 al resto); `status` y
`backup-now` no revelan rutas del disco a clientes remotos; el cuerpo de `POST /sync` tiene
tope de 256 MB (413).

### Configurar el token

- **Automático (recomendado):** la primera vez que llega una petición, el servidor genera un
  token aleatorio de 48 hex y lo guarda en `datos-pos/.local-db-token` (carpeta ignorada por
  git; permisos 600 en sistemas POSIX). No hay que hacer nada en la central.
- **Fijo por variable de entorno:** `POS_LOCAL_DB_TOKEN=<mínimo 16 caracteres>` antes de
  lanzar el servidor (tiene prioridad sobre el archivo).
- **Ver el token:** en la central, pantalla **Copias de Seguridad** → tarjeta "Base de Datos
  Central en Disco Local" → "Token para conectar otras PCs de la red" → *Mostrar*.
- **Conectar otra PC:** abrir `http://IP-DE-LA-CENTRAL:3001`, ir a **Copias de Seguridad**;
  aparece "La PC central pide un token de acceso": pegar el token y *Guardar y reconectar*
  (se guarda en `localStorage` de esa PC).
- **Rotar el token:** borrar `datos-pos/.local-db-token` y reiniciar el servidor (o cambiar
  `POS_LOCAL_DB_TOKEN`); las otras PCs deberán ingresar el nuevo.
- **Exigir token también en la central:** `POS_LOCAL_DB_TRUST_LOOPBACK=0` (la central tendría
  que guardar el token como cualquier otra PC).

### Escuchar solo en localhost

Por defecto el servidor escucha en la red local (necesario si hay otras PCs que comparten la
BD). Si **solo** se usa la central, definir `POS_HOST=127.0.0.1` antes de lanzar el servidor
y el puerto 3001 deja de ser alcanzable desde la red. Complemento recomendado: regla de
Firewall de Windows que limite el puerto 3001 a la subred de la tienda.

## 2. Producción: build estático, no servidor de desarrollo

`iniciar-servicio-silencioso.bat`, `iniciar-servicio.bat` e `iniciar-servicio.ps1` ya no
ejecutan `npm run dev`: sirven el build de `dist/` con **`npm run start`** (`vite preview`,
mismo puerto 3001 y mismo plugin de BD en disco). Si `dist/index.html` no existe, el script
lo genera antes con `npm run build`.

Consecuencias operativas:

- **`dist/` es lo que corre.** Antes el servidor de desarrollo servía `src/` en vivo y el
  `dist/` versionado era irrelevante; ahora cualquier cambio de código llega a la tienda solo
  si se regeneró `dist/` (commit `build: regenerar dist ...`).
- `npm run dev` queda solo para desarrollo.

## 3. Credenciales iniciales y contraseñas

- `admin/admin123` y `cajera/cajera123` se siguen sembrando en una BD vacía, pero **hasheadas**
  (PBKDF2) y con `mustChangePassword: true`: el primer login muestra una pantalla de cambio
  obligatorio y no deja entrar hasta elegir una contraseña nueva.
- **Políticas** (`src/utils/passwordPolicy.js`): mínimo 8 caracteres, distinta de la actual,
  no una contraseña de fábrica/común (`admin123`, `cajera123`, `123456`, ...), distinta del
  usuario y confirmada.
- **BD existentes:** si un usuario entra con una contraseña de fábrica conocida (aunque no
  tenga la marca), también se le obliga a cambiarla.
- **Texto plano eliminado:** `verifyPassword` ya no acepta contraseñas sin formato `salt:hash`.
  Al abrir la BD, `migrarContrasenasLegacy` convierte a hash cualquier contraseña en texto
  plano (también las que contenían `:`). Login espera a esa migración antes de verificar.

## 4. Acciones destructivas en Copias de Seguridad

**Borrar toda la base de datos**, **Limpiar para producción** y **Restaurar backup** piden la
contraseña del administrador en sesión. Se verifica contra el registro actual en la BD
(`confirmarContrasenaAdmin`): un usuario desactivado o que ya no sea admin no puede confirmar.
Ya existían la doble confirmación y el respaldo previo automático en disco.

## 5. Dependencias

`npm audit` pasó de 23 vulnerabilidades (1 crítica, 12 altas) a **1** (`xlsx`, sin parche en npm):
jspdf 4.2.1, react-router 7.18.6, vite 7.3.8, vitest 4.1.12 y transitivas actualizadas.

### xlsx 0.18.5 (sin corrección en npm)

Los avisos (prototype pollution y ReDoS, GHSA-4r6h-8v6p-xvw6 / GHSA-5pgg-2g8v-p4x9) se
explotan **al leer** libros de terceros. El POS solo **escribe** Excel (exportación de stock
en `Sync.jsx`, vía `writeFile`); la importación de Excel fue retirada con la sync v2. El
riesgo está mitigado por diseño y lo protege el test `xlsxSoloEscritura.test.js`, que falla si
alguien agrega `XLSX.read`/`readFile`. Si algún día se necesita leer Excel, usar el paquete
oficial de SheetJS desde su CDN (`https://cdn.sheetjs.com/`, 0.20.x) o validar tamaño/origen
del archivo antes de parsearlo.
