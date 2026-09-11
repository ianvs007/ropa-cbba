# Diseño — Sincronización POS ↔ Tienda virtual por eventos (v2)

Estado: **PROPUESTA para revisión de Alain** (10/09/2026). Sin código todavía.
Reemplaza al protocolo actual de `/api/sync` (una fase, cutoff por fecha).

## 0. Hallazgo previo que condiciona todo

Tras el "vaciar + re-sync" del 10/09 a las 20:00, D1 tiene **2592 productos y 0 con
`global_id`**. El zip v7 sí incluye el schema Dexie v23 (backfill de `globalId`
verificado dentro del bundle), así que la máquina central está sincronizando con
una BD **v22**: o se copió solo `Sync.jsx` dentro de la carpeta vieja, o el acceso
directo sigue lanzando la carpeta anterior. Mientras eso no se corrija, ninguna
versión de la sync es confiable: todo cruce cae al `codigo`, que es mutable.

**Paso 0 (antes de cualquier código nuevo):** en la central, lanzar el POS desde la
carpeta v7 completa, abrir Sincronización y verificar en un volcado
(`volcar-pos.html`) que `globalId` viene lleno. La primera sync v2 adopta los
`global_id` en la nube por `codigo` una única vez (ver §3.2, *bootstrap*).

## 1. Principios

1. **Identidad = `globalId`** (UUID del POS). El `codigo` corto es un atributo
   visible, nunca llave de cruce. Filas sin `globalId` se rechazan.
2. **El POS es la autoridad del stock.** La nube solo resta lo que vendió y aún
   no le confirmó al POS.
3. **Nada se cierra por fecha.** Cada movimiento web es un evento con id
   creciente; el POS confirma (`ack`) hasta qué id aplicó. No hay cutoff.
4. **Idempotencia en la BD**, no en la memoria: el POS guarda el id de cada evento
   aplicado; repetir una página de eventos no descuenta dos veces.
5. **Cualquier corte se resuelve repitiendo la sync.** No hay estados intermedios
   que requieran botones especiales ("vaciar", "reintentar descuento").
6. La sync **corre sola** (temporizador en la central) y también a demanda.

## 2. Nube (Cloudflare D1) — migración `006_sync_eventos.sql`

```sql
-- Movimientos de stock originados en la web, en orden total.
CREATE TABLE stock_eventos (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo          TEXT NOT NULL CHECK (tipo IN ('venta','cancelacion','expiracion')),
    order_id      INTEGER NOT NULL,
    order_item_id INTEGER NOT NULL,
    product_id    INTEGER,
    variant_id    INTEGER,
    global_id     TEXT NOT NULL DEFAULT '',
    codigo        TEXT NOT NULL DEFAULT '',
    nombre        TEXT NOT NULL DEFAULT '',
    talla         TEXT NOT NULL DEFAULT '',
    color         TEXT NOT NULL DEFAULT '',
    delta         INTEGER NOT NULL,          -- venta: -cantidad · cancelación/expiración: +cantidad
    precio_unit   REAL NOT NULL DEFAULT 0,
    pedido_ref    TEXT NOT NULL DEFAULT '',  -- substr(orders.codigo,1,8)
    creado_en     TEXT NOT NULL DEFAULT (datetime('now')),
    aplicado_pos_en TEXT                     -- NULL hasta que el POS haga ack
);
CREATE INDEX idx_stock_eventos_variant ON stock_eventos(variant_id, id);
CREATE UNIQUE INDEX idx_stock_eventos_unico ON stock_eventos(order_item_id, tipo);

-- Un registro por dispositivo POS que sincroniza (hoy: la central).
CREATE TABLE sync_dispositivos (
    id                 TEXT PRIMARY KEY,     -- uuid que el POS genera y guarda en settings
    nombre             TEXT NOT NULL DEFAULT '',
    ultimo_evento_ack  INTEGER NOT NULL DEFAULT 0,
    sesion_snapshot    TEXT,                 -- id de la sesión de snapshot en curso
    ultimo_snapshot_en TEXT,
    ultima_actividad   TEXT
);

-- Marca de "visto en el snapshot X" para desactivar ausentes al finalizar.
ALTER TABLE products ADD COLUMN sesion_snapshot TEXT;
```

Quién escribe eventos (explícito, no triggers, para poder testearlo en node):

- `functions/api/pedidos.js` (checkout): un evento `venta` por `order_item`, en el
  **mismo batch** que el descuento de stock.
- `functions/lib/expirar.js`: evento `expiracion` por ítem, solo si ganó la carrera
  del `UPDATE` de estado (ya implementado así).
- `functions/api/admin/pedidos/[codigo].js` (cancelar): evento `cancelacion`.
- `idx_stock_eventos_unico` impide dos eventos del mismo tipo para el mismo ítem
  (doble cancelación imposible aunque falle la guarda de estado).

Ediciones manuales de stock en el admin web **no** generan eventos: la nube no es
autoridad y el siguiente snapshot las pisa. Se documenta en la UI del admin.

## 3. Endpoints nuevos (`/api/sync/v2/*`, Bearer `sync_token`, CORS igual que hoy)

Todos responden JSON siempre (try/catch con CORS, como `/api/sync`).

### 3.1 `GET /api/sync/v2/eventos?dispositivo=<id>&desde=<n>&limite=500`

Devuelve `{ eventos: [...], ultimoId, hayMas }` con `id > desde` ordenados por
`id`. Cada evento: `id, tipo, globalId, codigo, nombre, talla, color, delta,
precioUnit, pedidoRef, creadoEn`. Si `desde` es menor que el ack registrado del
dispositivo, se respeta `desde` (permite re-pull tras restaurar un backup).

### 3.2 `POST /api/sync/v2/snapshot`

Body: `{ dispositivo, sesion, filas: [{ globalId, codigo, nombre, talla, color,
stock, precio }] }` (máx 250 filas por llamada; el POS trocea).

Por fila:
1. Buscar producto por `global_id`.
2. **Bootstrap (una sola vez por producto):** si no hay match por `global_id` y
   existe un producto con ese `codigo` **y `global_id IS NULL`**, adoptarlo
   (`UPDATE products SET global_id = ?`). Productos con `global_id` ya asignado
   nunca se re-vinculan por código.
3. Si no existe: crear producto + variante.
4. Si existe: actualizar `nombre`, `precio`, `activo = 1`, `sesion_snapshot`.
   Si el `codigo` cambió y otro producto lo tiene, al otro se le pone
   `codigo = NULL` (su fila, si llega en esta sesión, se lo devuelve; si no
   llega, se desactiva al finalizar). Se reporta en `detalle`.
5. Variante por `talla|color`; si falta, se crea.
6. **Stock:**
   `stock_nube = max(0, stock_pos + Σ delta de stock_eventos de esa variante con
   id > ultimo_evento_ack del dispositivo)`.
   Es la fórmula exacta: lo que el POS aún no aplicó se resta (ventas) o se suma
   (cancelaciones). No hay ventana de tiempo.

Respuesta: `{ ok, creadas, actualizadas, detalle, codigosReasignados }`.

### 3.3 `POST /api/sync/v2/ack`

Body `{ dispositivo, hastaId }`. `ultimo_evento_ack = max(actual, hastaId)`;
`aplicado_pos_en = now` en eventos `<= hastaId` sin marcar. Idempotente.

### 3.4 `POST /api/sync/v2/finalizar`

Body `{ dispositivo, sesion, desactivarAusentes: true }`. Desactiva
(`activo = 0`) los productos con `sesion_snapshot != sesion` que no tengan
pedidos en curso; los que tengan pedidos solo se ocultan. Devuelve el conteo.
**Reemplaza "Vaciar nube".** Actualiza `settings.ultima_sincronizacion` (solo
informativo para el admin).

### 3.5 Compatibilidad

`/api/sync`, `/api/sync/start`, `/api/sync/commit` y `/api/sync/ventas` siguen
vivos hasta que la central corra el POS v8; después se eliminan.

## 4. POS (Dexie) — schema **v24**

```js
// Nueva tabla: un registro por evento web aplicado. La PK es el id del evento
// de la nube: aplicar dos veces es imposible por construcción.
webEventos: 'id, tipo, productId, pedidoRef, aplicadoEn'
```

Settings nuevas: `syncV2.dispositivoId` (uuid, se genera la primera vez),
`syncV2.ultimoEventoAck` (int), `syncV2.auto` (bool), `syncV2.intervaloMin`
(default 10), `syncV2.ultimaOk`, `syncV2.ultimoError`.

### 4.1 Algoritmo `sincronizarV2()` (`src/utils/syncV2.js` puro + `db/helpers.js`)

```
0. Mutex: si hay una sync en curso, salir.
1. Precondiciones locales:
   a. garantizarGlobalId(): todo producto activo con globalId (backfill, sin preguntar).
   b. codigosDuplicadosEnFilas() vacío; si no, bloquear con botón de reparación (ya existe).
2. PULL (repetir hasta hayMas = false):
   a. GET eventos desde = settings.ultimoEventoAck
   b. UNA transacción Dexie (products, barcodes, kardex, webEventos, settings):
        para cada evento: si webEventos.get(id) existe → saltar;
        venta      → stock -= |delta|; marcar |delta| unidades used=true (FIFO);
                     kardex 'salida' nota 'VENTA EN LÍNEA #ref';
        cancelación/expiración → stock += delta; liberar unidades marcadas con
                     ese #ref (o las últimas usadas si no hay nota); kardex 'entrada'
                     nota 'CANCELACIÓN WEB #ref';
        producto no encontrado por globalId → evento se registra igual en webEventos
                     con estado 'huerfano' y se lista en avisos (no bloquea).
        webEventos.put({ id, tipo, productId, pedidoRef, aplicadoEn });
        settings.ultimoEventoAck = ultimoId de la página.
   c. POST ack hastaId = ultimoId. Si el ack falla, no importa: el próximo pull
      repite la página y la tabla webEventos la neutraliza.
3. PUSH: filasStockParaExportar() → lotes de 250 → POST snapshot con `sesion` nuevo.
   Progreso en pantalla por lote. Un lote fallido se reintenta 2 veces con espera;
   si sigue fallando, se aborta la sesión (sin finalizar: nada queda desactivado).
4. POST finalizar (desactivarAusentes: true).
5. PULL corto (paso 2 una vez más) para recoger ventas ocurridas durante el push.
6. Guardar syncV2.ultimaOk; limpiar syncV2.ultimoError.
```

No toca `sales` ni caja (igual que hoy: el dinero web va al banco).

### 4.2 Sync automática

Hook `useSyncAutomatica` montado en `Layout` solo si `syncV2.auto` y el usuario es
admin (la central). Ejecuta `sincronizarV2()` al abrir y cada `intervaloMin`;
silencioso si OK; si falla, badge rojo en el menú "Sincronización" con el error y
próximo intento. El botón manual sigue en `/sync`.

### 4.3 Qué desaparece del POS

- `syncGuard.js` y el banner "Reintentar descuento local" (la idempotencia por
  `webEventos` lo vuelve innecesario).
- `ultimaImportacionVentas` como guarda por fecha.
- Importación de ventas por Excel (no tiene ids de evento → rompe la
  idempotencia). La **exportación** de stock a Excel se mantiene como respaldo
  de solo lectura.
- En el admin web: botón "Vaciar nube" (lo sustituye `finalizar`).

## 5. Matriz de fallos

| Situación | Resultado con v2 |
|---|---|
| Corte de red en medio del pull, antes del ack | Siguiente sync repite la página; `webEventos` salta lo ya aplicado |
| Se aplicó la página pero falló el ack | Igual que arriba; la nube lo verá en el próximo ack |
| Corte durante el push (lotes parciales) | Los lotes aplicados ya tienen stock correcto por la fórmula; se repite el push completo; nada se desactivó |
| Nube 500 / HTML por timeout | Lote ≤ 250 filas + JSON siempre; el POS reintenta 2 veces y aborta sin finalizar |
| Venta web mientras corre el push | Queda como evento pendiente; la fórmula la resta en el snapshot y el pull final la trae |
| Cancelación web después de que el POS descontó | Llega como evento `+1`; el POS repone stock y unidad |
| Doble clic / dos pestañas | Mutex local; snapshot idempotente por `global_id`; ack con `max()` |
| Se restaura un backup viejo del POS | `webEventos` y `ultimoEventoAck` retroceden con el backup; el pull vuelve desde ese punto y re-aplica sobre un stock que también es viejo → coherente. Riesgo residual: backup con stock actual pero tabla `webEventos` vacía (import parcial); se documenta "tras restaurar, revisar avisos de la primera sync" |
| Producto en POS con `codigo` que la nube tiene en otro producto | El otro pierde el `codigo`; se reporta; el legítimo lo recupera en la misma sesión o se desactiva al finalizar |
| Fila sin `globalId` | Rechazada por la nube (400) y bloqueada antes en el POS |

## 6. Lo que este diseño NO resuelve (y se acepta)

- ~~**Etiqueta ≠ código de modelo en prendas multi-unidad**~~ → resuelto en la
  §8 (11/09/2026): las etiquetas viajan como alias de búsqueda vinculados por
  `globalId`; la web busca primero por etiqueta. Lo que sigue sin resolver es lo
  que la §8 acota: identificar la prenda NO reserva esa unidad física.
- **Ventana de sobreventa entre syncs**: baja de "hasta que alguien pulse el botón"
  a `intervaloMin` (10 min por defecto), pero no es cero. Cero exige POS en línea
  en cada venta (Opción C, descartada).

## 7. Plan de implementación (unidades de commit)

Nube (`tienda virtual - compra de ropa`):
1. `feat(db): migracion 006 stock_eventos + sync_dispositivos`
2. `feat(stock): emitir eventos en checkout, expiracion y cancelacion` (+ tests node)
3. `feat(sync): endpoints v2 eventos/snapshot/ack/finalizar` (+ tests con DB simulada)
4. `docs(bitacora): protocolo v2`

POS (`tienda de ropas`):
5. `feat(db): schema v24 webEventos + settings syncV2`
6. `feat(sync): syncV2.js puro (plan de aplicación de eventos, fórmula, troceo) + tests`
7. `feat(sync): helpers Dexie sincronizarV2 + UI en /sync (progreso, avisos)`
8. `feat(sync): sync automatica en Layout (admin) con badge de error`
9. `refactor(sync): retirar syncGuard, importacion Excel de ventas y ultimaImportacionVentas`
10. `build: regenerar dist` → zip **v8**.

Despliegue:
- A. Paso 0 en la central (POS v7 completo, verificar `globalId`).
- B. Push nube (compatible con el POS v7: los endpoints viejos siguen).
- C. Instalar POS v8 en la central; primera sync v2 hace el bootstrap de `global_id`.
- D. Verificar en D1: `con_global_id = total`, `stock_eventos` recibiendo ventas.
- E. Retirar endpoints viejos y "Vaciar nube" (commit aparte, cuando Alain lo pida).

Pruebas automáticas: nube `node --test functions/**/*.test.js` (patrón de DB
simulada ya existente en `sincronizar.test.js`); POS `npx vitest run` sobre
`syncV2.js` (fórmula de stock, plan de aplicación idempotente, troceo, manejo de
huérfanos). El wiring React/Dexie se valida con `npm run build` + prueba manual
contra `wrangler pages dev` con D1 local, nunca contra producción.

## 8. Etiquetas físicas como alias de búsqueda (11/09/2026)

### 8.1 Problema (probado con el dump del POS del 09/09/2026)

El POS maneja DOS códigos de 5 dígitos en el mismo espacio numérico:
`products.shortCode` (código de MODELO, el que la nube usa como `products.codigo`)
y `barcodes[].shortCode` (código de UNIDAD, lo que imprime la etiqueta física).
Caso real: producto 2087 **VESTIDO BRILLO** (código `02786`, stock 2, etiquetas
`02796` y `02797` disponibles, `02798` vendida) y producto 2098 **VESTIDO
VICTORIANO** (código `02797`, stock 1, etiqueta `02818`). El POS
(`findProductByBarcode`) prioriza unidades → `02797` es BRILLO; la nube solo
conocía códigos de modelo → `02797` era VICTORIANO. La sync v2 transmitía solo
`products.shortCode`, nunca las etiquetas. En prendas con varias unidades la
etiqueta no coincide con nada en la web.

### 8.2 Modelo de datos (nube, migración `007_etiquetas.sql`)

- `product_etiquetas (etiqueta, product_id → products.id ON DELETE CASCADE,
  global_id, disponible 0|1, actualizado_en, PK (etiqueta, product_id))`.
  Separado de `products.codigo`: una etiqueta es un ALIAS de búsqueda vinculado
  al producto por su identidad (`global_id`); el código de modelo no cambia.
  La misma etiqueta puede estar en varios productos (PK compuesta): eso es un
  CONFLICTO que se muestra, nunca se resuelve en silencio.
- `sync_etiquetas_pendientes (sesion, etiqueta, global_id, disponible,
  creado_en, PK (sesion, etiqueta, global_id))`: zona de aterrizaje por sesión.
- `disponible` es INFORMATIVO: refleja `!barcodes.used` al último snapshot
  completo. **No suma ni reemplaza el stock**, que sigue siendo
  `stock_pos + Σ eventos sin ack` (§1). Una etiqueta vendida sigue identificando
  su prenda (la web avisa "esa unidad ya se vendió").

### 8.3 Protocolo (misma sesión que el snapshot)

```
pull eventos → snapshot ×N (250) → etiquetas ×M (500) → finalizar{ etiquetas:{esperadas} } → pull corto
```

- `POST /api/sync/v2/etiquetas { dispositivo, sesion, etiquetas:[{ etiqueta,
  globalId, disponible }] }` (1..500 por lote). Aterriza en
  `sync_etiquetas_pendientes` con `INSERT ... ON CONFLICT DO UPDATE` (20 filas
  por sentencia = 80 parámetros < 100 de D1). **Idempotente**: repetir un lote
  tras un corte no duplica nada. NO toca lo publicado.
- `POST /api/sync/v2/finalizar` gana el campo opcional `etiquetas: { esperadas }`:
  - **omitido** (POS anterior): lo publicado NO se toca. Omitir ≠ lista vacía y
    no autoriza borrar.
  - `esperadas > vistas` en la sesión → **409 `etiquetas_incompletas`**, y NO se
    publica ni se desactiva nada (todo el cierre se rechaza).
  - `esperadas: 0` sin lotes = retiro explícito de todas las asociaciones.
  - Publicación en el MISMO batch que la desactivación de ausentes: `DELETE` de
    las asociaciones que no están en la sesión + `INSERT ... SELECT ... JOIN
    products ON global_id ... ON CONFLICT(etiqueta, product_id) DO UPDATE` + limpieza
    del aterrizaje (esta sesión y restos > 2 días). Un corte nunca deja lo
    publicado a medias ni borra lo previo. Al abrir una sesión nueva del mismo
    dispositivo se descarta el aterrizaje cortado de la anterior.
  - Etiquetas cuyo `global_id` no existe en la nube (lote de snapshot perdido)
    no se publican y se cuentan en `sinProducto`.
- Normalización **idéntica** en ambos lados (`normalizarEtiqueta`): `^\d{1,5}$`
  → `padStart(5,'0')`; cualquier otra cosa → `null` (se omite y se lista, nunca
  se "arregla"). Conserva ceros a la izquierda; `2797` → `02797`; `027970`,
  `2797a` y los EAN de 13 dígitos NO son etiquetas.

### 8.4 POS (`utils/syncV2.js::armarFilasEtiquetas`, puro)

Una fila por `(etiqueta, globalId)` a partir de `products` + `barcodes`:
- solo unidades de productos que VAN en el snapshot (activos, con `shortCode` y
  `globalId`); las de archivados/sin publicar se omiten y la nube las retira al
  finalizar;
- unidades vendidas (`used`) viajan con `disponible: false`;
- misma etiqueta repetida en el MISMO producto → una fila (`disponible` = OR);
- misma etiqueta en productos DISTINTOS → se envían ambas (la nube marca
  conflicto) y se listan en `duplicadas` (panel rojo en `/sync`; se repara con
  `fixMissingShortCodes()` en el POS);
- códigos que no son 1–5 dígitos → `invalidas` (panel ámbar), no viajan.

`syncV2Cliente.js`: sube los lotes con los mismos reintentos (red/5xx, nunca
4xx); un 404 en `/api/sync/v2/etiquetas` = nube sin migración 007 → sigue sin
etiquetas y NO manda el campo en finalizar (`soportado:false`, aviso en UI).

### 8.5 Búsqueda (nube, `lib/busqueda.js`, misma cadena en público y admin)

1. **Etiqueta exacta** (`product_etiquetas`). Si existe, la búsqueda TERMINA
   aquí: una prenda → `coincidencia: { tipo:'etiqueta', etiqueta, disponible,
   prendas }`; varias → `etiqueta_conflicto` con todas marcadas; la prenda está
   inactiva → sin resultados (el público no cae al código de modelo, que sería
   OTRA prenda). El admin (`/api/admin/etiquetas?q=`) resuelve incluyendo
   inactivas y muestra `Inactiva` / `VENDIDA`.
2. **Código de modelo exacto** (`products.codigo`) → `coincidencia: { tipo:'codigo' }`.
3. **Texto** tolerante a tildes/errores (lo que ya existía).

La UI distingue los tres casos (banner verde etiqueta / rojo conflicto / nota
gris código; badges `🏷` `⚠` `Cód.` en las tarjetas).

### 8.6 Límite explícito: identificar ≠ reservar

Identificar una prenda por su etiqueta NO reserva esa unidad física. La web
vende "1 unidad del producto"; el evento llega al POS y `aplicarPlanEventos`
marca la primera unidad libre (FIFO, `usedRef = 'WEB #REF'`), que puede no ser
la etiqueta que el cliente miró. Coherencia:
- venta web pendiente de ack → el stock publicado ya la resta (fórmula §1);
  `disponible` de las etiquetas queda como estaba hasta el siguiente snapshot
  completo (informativo);
- venta en mostrador → siguiente snapshot publica esa etiqueta `disponible: 0`;
- cancelación web → el POS libera la unidad con ese `usedRef` y el siguiente
  snapshot la vuelve a publicar disponible;
- unidad eliminada / producto archivado → la asociación se retira al finalizar.

### 8.7 Orden de despliegue (estado al 11/09/2026 13:45)

1. ✅ **D1 remoto**: `migrations/007_etiquetas.sql` aplicada con
   `wrangler d1 migrations apply --remote` (queda registrada en `d1_migrations`)
   en una sesión posterior, con autorización de Alain.
2. ✅ **Nube**: push `9ff2cfb..4d92e6b` a `main` → Pages desplegó `4d92e6b`.
   `/api/productos?q=02797` responde 200 JSON. Compatible con el POS actual de la
   central (que no manda etiquetas): hasta que sincronice el POS nuevo, la tabla
   `product_etiquetas` está vacía y la búsqueda cae al código de modelo.
3. ⏳ **POS**: commit `build: regenerar dist` y push de `main` (los commits
   `5941354..a47fec6` están solo en local); instalar `main` en la máquina
   CENTRAL (lanzar el POS completo).
4. ⏳ **Primera sync en la central** (`/sync` → Sincronizar ahora): la tarjeta
   "Etiquetas físicas" muestra N; el resultado reporta "Etiquetas publicadas"
   (no `n/d`); revisar paneles rojo (`duplicadas`) y ámbar (`invalidas`).
5. ⏳ **Verificación en vivo**: en la web pública buscar `02797` → VESTIDO BRILLO
   con banner "🏷 Etiqueta 02797"; buscar `02818` → VESTIDO VICTORIANO; `02798`
   → BRILLO con aviso de unidad vendida; en el admin, `Prendas` → buscar `02797`
   → banner etiqueta → ficha con chips de etiquetas. En D1:
   `SELECT COUNT(*) FROM product_etiquetas` ≈ unidades publicables del POS.

Hasta completar el paso 5 NO se puede afirmar que el problema esté resuelto en
producción.
