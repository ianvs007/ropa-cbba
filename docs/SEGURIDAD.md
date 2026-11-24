# Seguridad del POS — configuración y operación

Resumen de las medidas de seguridad vigentes y cómo configurarlas. Reaplica, sobre el motor
**SQLite** de `main` (24/11/2026), lo que el PR #4 proponía para el motor JSON. La
autenticación de usuarios sigue siendo 100 % del lado cliente (POS offline): estas medidas
protegen la **red local** y las **acciones destructivas**, no sustituyen un backend.

## 1. BD central en disco (`/__local_db/*`, SQLite)

El servidor (Vite preview en producción) expone `datos-pos/pos.sqlite` para que los
navegadores de la central y de otras PCs de la red la compartan. Las fotos viven aparte, en
`datos-pos/imagenes/`, y se sirven en `/__local_media/`. Sin autenticación, cualquier equipo
de la red podía leer o reemplazar la base completa (usuarios y hashes incluidos) y además
`/status` publicaba las rutas del disco.

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

Además:

- `GET /__local_db/token` solo responde a la propia máquina (403 al resto).
- `status` y `backup-now` no revelan `dbPath`, `imagesDir`, `backupsDir` ni `fullPath` a
  clientes remotos.
- `POST /__local_db/sync` y `POST /__local_media/upload` tienen tope de 256 MB (413).
- `POST /__local_db/import-backup` tiene tope de 1 GB: el backup JSON histórico pesa ~300 MB
  porque todavía trae las fotos en Base64. El sync del día a día no usa ese camino.
- `GET /__local_media/<archivo>` sigue público. El `<img>` del POS no puede mandar cabeceras
  y el nombre del archivo es un hash, no una ruta del disco. Quien no tiene el nombre no
  adivina la foto.

### Configurar el token

- **Automático (recomendado):** la primera petición genera un token aleatorio de 48 hex y lo
  guarda en `datos-pos/.local-db-token` (carpeta ignorada por git; permisos 600 en POSIX).
  La central no tiene que pegarlo.
- **Fijo por variable de entorno:** `POS_LOCAL_DB_TOKEN=<mínimo 16 caracteres>` antes de
  lanzar el servidor (tiene prioridad sobre el archivo).
- **Ver el token:** en la central, pantalla **Copias de Seguridad** → tarjeta de SQLite →
  "Token para conectar otras PCs de la red" → *Mostrar*.
- **Conectar otra PC:** abrir `http://IP-DE-LA-CENTRAL:3001`, ir a **Copias de Seguridad**;
  aparece "La PC central pide un token de acceso": pegar el token y *Guardar y reconectar*
  (se guarda en `localStorage` de esa PC). Hasta entonces esa PC queda en modo solo navegador
  y reintenta al reconectar.
- **Rotar el token:** borrar `datos-pos/.local-db-token` y reiniciar el servidor (o cambiar
  `POS_LOCAL_DB_TOKEN`); las otras PCs deberán ingresar el nuevo.
- **Exigir token también en la central:** `POS_LOCAL_DB_TRUST_LOOPBACK=0`.

### Escuchar solo en localhost

Por defecto el servidor escucha en la red local (necesario si hay otras PCs que comparten la
BD). Si **solo** se usa la central, definir `POS_HOST=127.0.0.1` antes de lanzar el servidor
y el puerto 3001 deja de ser alcanzable desde la red. Complemento recomendado: regla de
Firewall de Windows que limite el puerto 3001 a la subred de la tienda.

## 2. Producción: build estático, no servidor de desarrollo

`iniciar-servicio-silencioso.bat`, `iniciar-servicio.bat` e `iniciar-servicio.ps1` ya no
ejecutan `npm run dev`: sirven el build de `dist/` con **`npm run start`** (`vite preview`,
mismo puerto 3001 y el mismo plugin de SQLite). Si `dist/index.html` no existe, el script lo
genera antes con `npm run build`.

`ACTUALIZAR_SISTEMA.bat` sigue cerrando Node, copiando `pos.sqlite` y haciendo
`git pull --ff-only`; al final llama al bat silencioso, que ahora arranca `npm run start`.

Consecuencias operativas:

- **`dist/` es lo que corre.** Cualquier cambio de código llega a la tienda solo si se
  regeneró `dist/` (commit `build: regenerar dist ...`).
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
  La migración corre otra vez después de bajar SQLite, por si el disco todavía traía texto plano.
- Una BD vacía nace por `seed.js`, con esas cuentas hasheadas y `mustChangePassword`.
  Un backup JSON con `password: '***'` (o una copia sin secretos) conserva el hash que ya
  está en esta máquina. Si no hay hash previo, ese usuario no se restaura: no se le inventa
  `admin123` ni `123456`.

## 4. Acciones destructivas en Copias de Seguridad

**Borrar toda la base de datos**, **Limpiar para producción** y **Restaurar backup** piden la
contraseña del administrador en sesión. Se verifica contra el registro actual en la BD
(`confirmarContrasenaAdmin`): un usuario desactivado o que ya no sea admin no puede confirmar.
El respaldo previo automático en disco (`.sqlite`) se mantiene.

La tarjeta **Exportar Backup** no pide esa contraseña. El archivo completo guarda el hash real
y puede incluir el token de sincronización. **Copia sin secretos** omite hashes y `syncToken`
y lo avisa dentro del archivo; la caja y los embeddings van en las dos copias.

## 5. Dependencias

`xlsx` 0.18.5 no tiene parche en npm. Los avisos (prototype pollution y ReDoS) se explotan
**al leer** libros de terceros. El POS solo **escribe** Excel (exportación de stock en
`Sync.jsx`, vía `writeFile`). El test `xlsxSoloEscritura.test.js` falla si alguien agrega
`XLSX.read` / `readFile`. El resto de dependencias se actualiza con `npm audit` cuando el
arreglo no cambia el comportamiento del POS.

## Límites

- Un acceso físico a DevTools o a IndexedDB de la máquina sigue pudiendo leer la sesión.
- El token viaja en claro por HTTP en la LAN (sin TLS) y, para el stream SSE, en la query.
  Protege contra equipos curiosos de esa red, no contra alguien que pueda espiar el tráfico.
  Si eso importa, usar `POS_HOST=127.0.0.1` o una VPN/TLS delante.
- Las fotos ya publicadas en `/__local_media/` se pueden pedir sin token si se conoce el
  nombre (hash). No exponen la base ni las contraseñas.
