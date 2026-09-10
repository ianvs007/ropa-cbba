# CLAUDE.md — ropa-cbba (Tienda de Ropa)

POS **offline** para tienda de ropa en Cochabamba: React 19 + Vite + Dexie.js
(IndexedDB, schema **v23**) + Tailwind. Corre en 3 máquinas de producción como
ventana de navegador lanzada por `iniciar-servicio-silencioso.bat`; cada máquina
tiene su propia base de datos local (sin servidor). Desde el 27/07/2026 existe
sincronización manual vía Excel con la tienda virtual (pantalla `/sync`); desde
el 22/08/2026 la identidad de cruce con la nube es el `globalId` (UUID estable).

## Convenciones de trabajo

- **Idioma**: código, commits, tests y UI en español. Commits `tipo(ámbito): ...`
  separados por unidad lógica. Sin comillas dobles dentro de mensajes de commit
  (PowerShell 5.1 las rompe al pasarlas a git).
- **NUNCA hacer push** sin revisión de Alain. Los merges a main se hacen solo
  cuando él lo pide.
- **dist/ está versionado**: se commitea SOLO en commits de build para despliegue
  (`build: regenerar dist ...`). Los builds de verificación se descartan con
  `git checkout -- dist; git clean -fd dist`.
- **Despliegue**: zip en `D:\software\MisProyectos\` (`ropa-cbba-*-YYYYMMDD.zip`)
  excluyendo `node_modules`, `.git`, `.claude` y `backup_tienda_ropa_*.json`;
  se copia a mano a las 3 máquinas (no hacen git pull).
- **Tests**: `npx vitest run` (entorno node, funciones puras — la lógica testeable
  se extrae a `src/utils/` o se exporta del hook). Toda la suite en verde +
  `npm run build` antes de commitear. **218 tests** versionados al 2026-09-07
  (243 en el working tree: 25 más del planificador de alineación, sin versionar).
- **ESLint**: hay falsos positivos preexistentes (`Icon` en Layout/CashClose,
  vars sin usar); no arreglarlos de pasada — verificar con stash que no se
  agregan problemas nuevos.
- Los imports `from '../db'` resuelven a `src/db.js` (barrel), no a `src/db/index.js`.

## Decisiones de negocio vigentes (módulo de caja)

- **Seguridad de fecha**: solo se detecta/bloquea el RETROCESO de reloj (>10 min
  contra `lastKnownTimestamp`); adelantar NO se bloquea. El cambio natural de día
  re-congela la fecha solo (rollover a medianoche con la app abierta).
- **Cierre retroactivo**: lo puede hacer CUALQUIER vendedor; queda auditado con
  `retroactive: true` + nota automática "CIERRE RETROACTIVO — regularización" +
  `closedAt` real. Fechas futuras SIEMPRE bloqueadas (`canCloseCashDate`).
- **Un cierre retroactivo regulariza el día COMPLETO** (modo `allUsers`): limpia
  la fecha para todos los usuarios, porque los movimientos pendientes pueden ser
  de vendedoras antiguas/recreadas. El cierre normal sigue siendo por usuario.
- **Aviso al salir** con caja abierta o días pendientes: es AVISO con "Salir de
  todos modos", NO bloqueo. El bloqueo progresivo del POS se descartó por ahora.
- **El admin NO opera caja**: la ruta `/cash` le redirige a `/dashboard`
  (App.jsx); por eso ni el botón del banner ni el aviso de salida aplican a admins.
- **Contabilidad**: los reportes calculan ingresos de las tablas `sales`/
  `expenses`/`reservationPayments` directamente — un día sin cierre nunca pierde
  ventas; el cierre es el control de caja (arqueo). La "diferencia" de un cierre
  retroactivo es regularización formal, no descuadre real.
- **Reservas agrupadas**: hasta 5 prendas por operación, una fila en
  `reservations` por prenda con `groupId` compartido (campo NO indexado, sin
  migración de schema). Abono único repartido proporcionalmente al centavo
  (`splitProportional`). Entrega/anulación/abonos siguen por prenda individual.
  La LISTA, el DETALLE y la IMPRESIÓN se agrupan por cliente + fecha
  (`reservationGroups.js`: una tarjeta por grupo, vista grupal con comprobante
  consolidado); las reservas son visibles para TODOS los vendedores y admin
  (sin filtro por vendedor — la trazabilidad va en `registeredBy` de cada pago).

## Registro de actualizaciones — Julio 2026

### ✅ En producción (main, zips v1, v2 y v3 — 08/07/2026)

1. **Fix fecha congelada y falsas alertas de manipulación**
   (`03bb727`..`d8af5b4`, zip `ropa-cbba-fix-fecha-20260708.zip`):
   rollover diario de la fecha congelada; manipulación solo por retroceso;
   evidencia sobrevive recargas; un intento/log por episodio.
   Lógica pura: `evaluateDateChange` / `processDateCheck` en `useSecureDate.js`.
2. **Reservas multi-prenda** (`d5631f1`..`d478b4c`, zip
   `ropa-cbba-v2-fecha-reservas-20260708.zip`): formulario hasta 5 prendas,
   abono proporcional con cuadre exacto, badge "Grupo de N prendas",
   retrocompatibilidad total con reservas de una prenda.

Los items 3-5 (rama `feature/aviso-cierres-pendientes`, validada en prueba
manual) se consolidaron en main con el build `43c8358` y se despliegan con el
zip **`ropa-cbba-v3-cierres-pendientes-20260708.zip`**:

3. **Banner persistente de cierres pendientes** (`9db6944`, `bf77d7a`):
   banner rojo no descartable en todas las pantallas; detección por movimientos
   (ventas/abonos sin cierre, aperturas huérfanas), ventana 60 días por índice
   `date`, reactivo con `useLiveQuery`, "hoy" siempre de `useSecureDate`.
   Helpers: `findPendingClosureDates` + hook `usePendingClosureDates`.
4. **Cierre retroactivo** (`959c22a`, `70efbee`, `c0db95d`): panel "Días
   pendientes de cierre" en CashClose; el banner navega con el día más antiguo
   preseleccionado; días con apertura reutilizan el flujo de turno, días sin
   apertura cierran a nivel día (`dayLevelRetro`).
   - Fix `e0103b8`: el retroactivo limpia el día para TODOS los usuarios en el
     detector (movimientos de vendedoras que ya no existen).
   - Fix `d2c45d2`: el arqueo retroactivo calcula con TODOS los usuarios
     (`filterClosureMovements` modo `allUsers`, también en
     `syncClosureIfDateExists`); campo FECHA DEL CIERRE con locale `es`
     explícito (el input date nativo mostraba MM/DD en Windows en-US).
5. **Aviso al salir con caja sin cerrar** (`3789bb6`, `716f77d`): modal al
   Cerrar Sesión (Ir a Cierre / Salir de todos modos / Volver); `beforeunload`
   para el botón X (diálogo genérico del navegador — límite sin Electron);
   admin exento. Helper puro: `getExitWarning`.

### ✅ En producción (main, zip v4 — 09/07/2026)

Merges `03b5f98` + `bf493f6` + fix de banner/rename (`73313fc`, `31a70e4`),
build final `556177b`, zip **`ropa-cbba-v4-cliente-caja-20260709.zip`**
(regenerado el 09/07 con los items 6-9; reemplaza al zip v4 anterior):

6. **Cliente opcional en la venta** (`07dd13d`..`2844624`, rama
   `feature/cliente-en-venta`): botón "➕ Añadir cliente (opcional)" en el POS;
   la venta guarda `clientName`/`clientPhone` como campos NO indexados (sin
   migración — sigue schema v22, `undefined` cuando no hay cliente); el ticket
   imprime "Cliente: ... Cel: ..." bajo el vendedor; el historial muestra el
   cliente en el detalle y lo incluye al reimprimir. 100% opcional: vacío =
   comportamiento idéntico al anterior.
7. **Limpieza y claridad del cierre de caja** (`4f317ad`..`5afdc66`, rama
   `feature/limpieza-cierre-caja`, solo CashClose.jsx, sin cambios de lógica):
   sin badge V-FINAL ni comentarios de debug; pill y confirm "✏️ CORREGIR"
   (edición de arqueo) diferenciados de "Reabrir Caja" (reabrir turno); pasos
   del indicador ARQUEO → COMPLETADO; eliminado el botón "Ver Siguiente Día"
   (`handleNewDate` podía caer en fecha futura bloqueada); formulario de arqueo
   deduplicado en el subcomponente `ArqueoFisicoCard` (prop `showEditPill`).

8. **Eliminado el banner naranja legacy del Dashboard** (`73313fc`): su
   "Detector de Cierres Olvidados" recorría toda la historia sin ventana de
   60 días, con `new Date()` en vez de la fecha segura y sin la semántica
   retroactiva — le reclamaba al admin días viejos imposibles de regularizar.
   La detección queda SOLO en `findPendingClosureDates`/`usePendingClosureDates`.
   ⚠️ PENDIENTE de validar visualmente: que el banner rojo aparezca en el rol
   cajero cuando exista un día realmente pendiente (en las pruebas de escritorio
   no había pendientes dentro de la ventana y no se pudo confirmar en pantalla).
9. **Menú del vendedor renombrado** "Cierre de Caja" → "Abrir/Cerrar Caja"
   (`31a70e4`); el badge de pendientes del menú ahora se ancla a la ruta
   `/cash` (no al texto del label) para sobrevivir futuros renames.

### 🔧 Sin commitear (27/07/2026): Sincronización con la tienda virtual

10. **Sync de stock por Excel con la tienda virtual** — pantalla `/sync` (solo
    admin, entrada "Sincronización" en `NAV_ADMIN`), lado POS del ritual diario
    de cierre de caja con la tienda web (`tienda virtual - compra de ropa`):
    - **Exportar stock**: Excel `stock-para-tienda-virtual-YYYY-MM-DD.xlsx` con
      columnas `codigo|nombre|talla|color|stock` (codigo = `shortCode`), una
      fila por producto activo; se sube en el admin web → Sincronizar.
    - **Importar ventas en línea**: lee el Excel `ventas-en-linea-*.xlsx` que
      genera la nube, vista previa con cruce por `shortCode` y avisos
      (no encontrado / stock insuficiente / ya importada), y al confirmar
      aplica en UNA transacción Dexie: descuenta `product.stock`, marca unidades
      `barcodes.used` (FIFO), kardex `salida` con nota `VENTA EN LÍNEA #ref`.
      **No crea registros en `sales` ni toca caja** (decisión del dueño: el
      dinero de la web va al banco por QR, no a la caja física).
    - Guard contra doble importación: `settings.ultimaImportacionVentas`.
    - Archivos: `src/components/Sync.jsx`, `src/utils/syncExcel.js` (lógica
      pura), `src/__tests__/syncExcel.test.js` (13 tests), rutas en `App.jsx`,
      menú en `Layout.jsx`. 184 tests en verde + build OK.
    - ⚠️ OPERATIVO: el ritual se hace SOLO en la máquina principal (central) —
      decidido por Alain el 27/07/2026; las demás máquinas no sincronizan
      (cada una tiene su propia BD local).
    - Ampliación 27/07/2026 (v6): la exportación de stock incluye la columna
      `precio` para alimentar la importación inicial de catálogo en la nube
      (tarjeta ④ del admin web: crea las prendas que no existen, sin foto ni
      categoría, editables después). 185 tests en verde.

## Registro de actualizaciones — Agosto 2026

### ✅ En producción (main, 29/07 al 19/08/2026)

11. **Sincronización directa con la tienda virtual por lotes** (`7ecb6dc`):
    el POS ya no depende solo del Excel. El botón "Sincronizar ahora" (tarjeta ③
    de `/sync`) hace POST a `/api/sync` en **lotes de 250 filas** con barra de
    avance; solo el último lote va con `finalizar: true` (la nube recién ahí
    cierra la ventana de ventas y las devuelve). Aplica las ventas web devueltas
    con la MISMA lógica que la importación por Excel (`aplicarVentas`: UNA
    transacción Dexie que descuenta `product.stock` + unidades FIFO + kardex;
    no toca caja). Archivos: `Sync.jsx`, `syncExcel.js` (`ventasDesdeApi`,
    `cruzarVentas`), `syncAplicar.js`; tests `syncExcel.test.js`.

12. **Fix cierres retroactivos incerrables** (`3bc6be3`, 04/08/2026): evita
    días pendientes que no se podían cerrar y añade herramientas de
    diagnóstico/regularización (`regularizar-cierres-masivo.js`,
    `diagnostico-caja.js`, `analizar-diagnostico.cjs`, `INSTRUCCIONES.txt`).
    Toca `CashClose.jsx`, `usePendingClosureDates.js`, `Users.jsx`, `Layout.jsx`.

13. **Fix de shortCodes duplicados — causa raíz del cruce POS↔nube**
    (`cb20eab`, 18/08/2026): el shortCode se pre-generaba al abrir el formulario
    (`generateShortCode` = max+1, sin transacción) y dos pestañas podían guardar
    el mismo código, cruzando la información de prendas distintas en la tienda
    virtual (`products.codigo = shortCode`). Ahora:
    - `src/utils/duplicateShortCodes.js` + `findDuplicateProductShortCodes` /
      `fixDuplicateProductShortCodes` en `db/helpers.js` (conserva el código en
      la prenda más antigua, reasigna las demás, UNA transacción).
    - La sync directa y la exportación Excel se **BLOQUEAN** si hay duplicados
      (panel rojo + botón "Reparar códigos duplicados").
    - `ProductForm` re-verifica unicidad al guardar (regenera si hay carrera).
    - 18 tests nuevos (`duplicateShortCodes.test.js`).

14. **Pestaña "Cierres de Caja" en el Historial de Caja (solo admin)**
    (`62c4a86`, `0e22a67`, 19/08/2026): el módulo `/sales` se renombró a
    "Historial de Caja" y ganó una pestaña "Cierres de Caja" visible solo para
    `admin`: lista los `cashClosures` con filtros (fecha, vendedor, búsqueda),
    indicador visual de diferencia (excedente/faltante/cuadrado) y exportación
    PDF individual y masiva (`printCashClosuresReport` en `utils.js`). Archivos:
    `SalesHistory.jsx`, `Layout.jsx`, `utils.js` + `REGISTRO_CAMBIOS_CIERRES_CAJA.md`.

### 🔧 Diagnóstico y herramientas (19/08/2026, sin commitear)

15. **Diagnóstico del cruce de códigos POS↔nube** — se identificó por qué algunas
    prendas "no se guardan" en la tienda virtual: la nube cruza por `codigo` y
    compara el `nombre`; si difieren (`nubeDifiere` en `functions/lib/sincronizar.js`)
    marca `cruce: true` y **NO actualiza el stock**, y nunca se reconcilia solo
    (la nube jamás actualiza `products.nombre`). Causas: (a) shortCodes duplicados
    o reasignados en el POS (fix item 13), (b) el código se reutiliza al borrar+
    reimportar (el UNIQUE de la nube se libera), (c) renombrar una prenda en el
    POS después de que ya está en la nube. Evidencia en D1: `00075` ("CONJT DEPORT
    2PZ" → "BODY") y `02253` ("CHAMARRA" → "BLAISER VESTIDO").
    - **Comparador POS↔nube** (solo lectura, para listar las desincronizadas):
      `comparar-pos-nube.cjs` (consulta D1 con wrangler y cruza contra el JSON del
      POS) + `public/volcar-pos.html` (extrae los productos del IndexedDB del POS
      desde `http://localhost:3001/volcar-pos.html`) + `volcar-pos.bat`. Reporta
      duplicados, cruces, cruces por tilde, solo-POS, solo-nube, variante sin
      coincidencia y coincidencias con diferencia de stock.

16. **Comparador ejecutado — diagnóstico cerrado (21-22/08/2026)**: se volcaron
    los 2408 productos del POS (IndexedDB, vía Chrome headless + CDP, sin
    depender del `volcar-pos.bat` manual) y se cruzaron contra D1 (2410 códigos).
    Resultado LIMPIO: 0 duplicados, 0 cruces de nombre, 0 cruces por tilde,
    0 solo-POS, 0 variante sin coincidencia; 2408 coinciden con stock idéntico.
    Los cruces históricos `00075` y `02253` ya no existen (resueltos).
    - **Decisión de negocio (Alain, 22/08/2026)**: la nube (tienda virtual) es
      DESCARTABLE; los datos canónicos viven en la BD del POS offline y la nube
      SIEMPRE se re-sincroniza desde el POS. Los 2 huérfanos "solo en la nube"
      (`02418` FALDA TABLEADO, `02818` VESTIDO VICTORIANO) NO requieren acción.
    - **Validación visual**: pestaña "Cierres de Caja" (Historial de Caja, solo
      admin) renderiza correctamente (columnas, buscador, estado vacío). Falta
      solo confirmar con `cashClosures` reales del perfil de producción.

### 🔜 Posibles siguientes pasos (no comprometidos)

- Vista admin de cierres retroactivos / abrir `/cash` a admins.
- Bloqueo progresivo del POS con >N días pendientes (descartado por ahora).
- Pasada de consistencia de `toLocaleDateString()` sin locale en
  Reservations/Expenses (solo visual, preexistente).

### ✅ Sync por identidad estable — `globalId` (22/08/2026)

17. **`globalId` como identidad de cruce con la nube** (`2c6896cc`, `05788fbf`):
    el cruce POS↔nube deja de depender del `shortCode` (mutable: se libera al
    borrar y se reasigna al reimportar). Cada producto lleva un `globalId`
    (UUID v4) que lo identifica de forma estable en ambos sistemas:
    - Schema **v23** (`src/db/schema.js`): `products` gana `globalId` (indexado)
      y `updatedAt`; el upgrade backfillea ambos campos a productos existentes.
    - `src/db/helpers.js`: altas, normalización e importación de backups
      garantizan `globalId` (`crypto.randomUUID()`).
    - `src/utils/syncExcel.js`: la exportación de stock incluye `globalId`; el
      cruce de ventas en línea busca primero por `globalId` con fallback a
      `codigo`.
    - `src/components/Sync.jsx`: las filas de la sync directa llevan `globalId`.
    - Lado nube (ianvs007/tienda-virtual): migración `005_global_id.sql` +
      commits `65e4cee` (cruce por global_id), `d5f335f` (upsert batcheado),
      `1f058ff` (conflictos → registro canónico del POS) y `f049d84` (vaciado
      total del catálogo desde el admin). Detalle en la BITÁCORA de allá.
    - 1 test nuevo (`syncExcel.test.js`).

### 🔎 Auditoría integral POS↔nube (04/09/2026)

Verificación en frío de ambos proyectos desde Qwen Code local:
- POS: 210/210 tests (17 archivos) + `npm run build` OK; el `dist` regenerado
  resultó idéntico al versionado (build determinista).
- Nube: 8/8 tests (`node --test "functions/**/*.test.js"`) + build OK; el último
  commit `f049d84` ESTÁ desplegado en Cloudflare Pages (el build automático al
  push volvió a funcionar).
- BD viva (D1 remoto): columna `products.global_id` presente, backfill completo
  (2410/2410) e índice único parcial `idx_products_global_id` OK.
- ✅ DRIFT de migraciones RESUELTO (04/09/2026): la 005 se había aplicado a
  mano sin registrar en el ledger `d1_migrations` remoto (solo 001–004). Se
  insertó el registro con aprobación de Alain y
  `wrangler d1 migrations list --remote` vuelve a dar "No migrations to apply";
  `migrations apply` es seguro de nuevo.
- ⚠️ DESPLIEGUE POS: zip `ropa-cbba-v5-globalid-20260904.zip` armado en
  `D:\software\MisProyectos` (1.36 MB, 138 entradas; dist con globalId, sin
  node_modules/.git/.claude/backups ni basura de agentes). PENDIENTE: copiarlo
  a mano a las 3 máquinas.
- ⏸️ Pendiente visual: pestaña "Cierres de Caja" con `cashClosures` reales de
  producción.

### 🔎 Diagnóstico etiquetas↔nube (noche del 04/09/2026) — EN CURSO

Síntoma reportado por Alain: los códigos de las etiquetas físicas de las
prendas no coinciden con los de la tienda virtual, aunque el POS sí coincide
con las etiquetas.

**Causa estructural CONFIRMADA en código** (no es corrupción ni máquinas
divergentes):
- El POS maneja DOS sistemas de códigos de 5 dígitos en el mismo espacio
  numérico:
  - `products.shortCode` (por modelo) → la nube lo usa como `products.codigo`;
  - `barcodes[].shortCode` (por prenda física; `generateBarcodesForProduct`
    los genera DISTINTOS al del producto) → es lo que imprime la etiqueta
    (`MassLabeling.jsx`).
- La búsqueda del POS (`findProductByBarcode`) resuelve AMBAS tablas, por eso
  POS↔etiqueta siempre funciona; la nube solo conoce shortCodes de producto →
  etiqueta↔nube nunca coincide.
- `planificarReasignacionDuplicados` (reparación de duplicados) solo reasigna
  shortCodes de producto; las etiquetas ya impresas no se tocan.

**Evidencia** (dump de DESARROLLO — esta máquina, no la tienda):
`pos-productos.json` del 04/09 23:57, 2185 productos / 2781 unidades,
analizado con `comparar-dump-nube.cjs` (requiere `nube-productos.json`,
snapshot de la nube descargado con wrangler):
- 2004 números son shortCode de producto Y de unidad a la vez (ambigüedad).
- Ejemplos de Alain resueltos: 01952 = etiqueta del producto 01951 (VESTIDO
  MOÑO); 02418 = etiqueta del producto 02923 (FALDA TABLEADO); 02797 =
  producto VESTIDO VICTORIANO y a la vez etiqueta de un VESTIDO BRILLO
  (producto 02786) — explica exactamente lo que veía.
- 03303 y 02969 no existen en el dump de desarrollo.
- OJO: contra ese dump (desarrollo) salieron 4 cruces de nombre reales
  (01377, 02954, 02955, 02956) y 225 códigos fantasma en la nube; esos
  números hay que REMEDIRLOS con el dump de la tienda.

**Próximo paso (corte de la sesión):**
1. Alain ejecuta el volcado extendido (`public/volcar-pos.html`, ya vuelca
   productos + unidades + globalId) EN LA MÁQUINA DE LA TIENDA y trae el
   `pos-productos.json`. El volcado es compatible con el POS viejo (lee
   IndexedDB directo; `globalId` saldrá vacío si el esquema es v22).
2. Correr `node comparar-dump-nube.cjs` con ese dump (refrescar antes
   `nube-productos.json` con wrangler).
3. Fix acordado en principio: instalar zip v5 (`globalId`) en la máquina
   central → sincronizar (corrige cruces por autoridad POS) → vaciado total
   del catálogo cloud + re-sync (limpia los fantasmas) → alinear en el POS
   shortCode de producto = shortCode de unidad para prendas únicas (mandan
   las etiquetas ya impresas; el catálogo web es 100% prendas únicas).

Archivos de trabajo sin versionar (scratch, como `antes_sync.json` en la
nube): `pos-productos.json` (dump de desarrollo) y `nube-productos.json`.

### 🛠️ Fixes de identidad del shortCode (07/09/2026, commit `a2bc695`)

Los tres estaban vivos en el código y **viajaban dentro del zip v5**. Se
detectaron al preparar el despliegue; `git log -L` ubica el origen del primero
en `ff3eeeb5` (2026-08-20), o sea que producción probablemente corre un build
anterior donde `generateShortCode()` aún devolvía un string.

18. **`generateShortCode()` devuelve `{ shortCode, globalId }` y dos llamadores
    lo usaban como string**: `ProductList.openNew` lo guardaba crudo en
    `formData.shortCode` (y `openNew` es el botón "Nuevo") y el blindaje de
    `ProductForm.handleSave` lo reasignaba igual. En el alta nueva fallaba de
    una de dos formas: o `where('shortCode').equals(objeto)` lanzaba `DataError`
    y el producto no se guardaba (sin toast — la excepción escapaba de
    `handleSave`), o se guardaba un objeto como `shortCode`, registro no
    indexable → invisible a la búsqueda por código y fuera de la sync. Ahora se
    desestructura en los dos sitios.
    **Dato de fondo**: el `globalId` que genera la función **no lo consumía
    nadie** (ningún `.jsx`; solo el upgrade v23, `exportDatabase` —al vuelo y sin
    persistir— e `importDatabase` lo garantizaban). Las altas manuales viajaban a
    la nube con `globalId: ''`, fuera del cruce por identidad estable. Ahora el
    `globalId` pre-generado llega al producto y `EMPTY` lo declara.
19. **`GUARDAR Y NUEVO` dejaba el producto siguiente sin identidad**: el bloque
    `keepOpen` reseteaba con `setForm({ ...EMPTY })` y `EMPTY.shortCode = ''`;
    como el blindaje solo actúa `if (shortCodeFinal)`, el segundo producto se
    guardaba **sin `shortCode` y sin `barcode` de modelo** (ningún `useEffect`
    los regenera y el formulario no los muestra: quedan fuera de la búsqueda por
    código y de la sync). Ahora el reset asigna EAN (`generateUniqueBarcode`),
    `shortCode` y `globalId` nuevos, igual que `openNew`.
20. **La guarda anti-duplicados deshacía la alineación al editar**:
    `tomadoPorUnidad` contaba CUALQUIER unidad con ese código, incluidas las del
    propio producto. Una prenda única alineada comparte a propósito el código con
    su etiqueta impresa, así que editarle el precio le asignaba un código nuevo
    (y de paso disparaba el item 18). La decisión pasa a la función pura
    `codigoTomadoPorOtro` en `utils/duplicateShortCodes.js` (excluye
    `productId === editing`), con 8 tests reales en `duplicateShortCodes.test.js`.

⚠️ Cobertura: los items 18 y 19 son wiring de React/Dexie y **no tienen cobertura
automática posible en este entorno** (vitest en node, sin React DOM ni
IndexedDB); su garantía es `npm run build` + revisión del diff. El item 20 sí
queda cubierto por tests sobre la función pura. 218 tests versionados en verde +
build OK + eslint sin problemas nuevos en los archivos tocados (los 4 warnings de
`ProductList.jsx:19-23` son preexistentes).

### 🔎 Alineación etiqueta↔producto: planificador listo, SIN cablear (07/09/2026)

- `src/utils/alinearCodigosEtiqueta.js` + `src/__tests__/alinearCodigosEtiqueta.test.js`
  (25 tests) — **SIN VERSIONAR**. Lógica PURA: `planificarAlineacionEtiquetas` y
  `aplicarPlanEnSeco`. Regla de negocio (decisión de Alain): en una **prenda
  única** el producto adopta el `shortCode` de su etiqueta, que es el número que
  el cliente tiene en la mano. Si ese código lo tiene otro producto que no es
  candidata, se le da uno nuevo max+1 (motivo `desalojo`).
- Resuelve cadenas e intercambios (ciclos de 2) **sin códigos temporales**,
  porque `shortCode` no es índice único en Dexie: lo que debe cumplirse es que el
  estado FINAL sea único entre productos (la nube sí tiene `idx_products_codigo`
  UNIQUE y `codigosDuplicadosEnFilas` bloquea la sync). **No rellena huecos
  libres**: un hueco puede ser una etiqueta vieja ya impresa cuya prenda se
  vendió. Bloquea en vez de adivinar ante etiquetas duplicadas (→ correr antes
  `fixMissingShortCodes()`) o códigos de producto duplicados (→
  `fixDuplicateProductShortCodes()`).
- Simulación sobre el dump de DESARROLLO (`analizar-alineacion.cjs` y
  `simular-alineacion.mjs`, scratch sin versionar): 190 alineaciones + 21
  desalojos, 3 bloqueos (etiquetas duplicadas `00001` y `02506`), 0 códigos
  duplicados al final. Búsqueda web por código de etiqueta sobre 2132 prendas sin
  vender: prenda correcta 64.4% → 71.8%, **otra prenda 7.1% → 2.0%**,
  inexistente 607 → 559. Residuo: 601 etiquetas, y **598 son de productos con
  varias unidades** (245 productos, uno con 64) → no alineables 1:1, es
  estructural; este fix NO lo resuelve.
- **PENDIENTE (paso siguiente)**: cablear `alinearCodigosEtiquetas()` en
  `db/helpers.js` + botón en `Sync.jsx` (misma forma que
  `fixDuplicateProductShortCodes`, cuyo UI es `handleRepararDuplicados`), y
  **remedir todo con el dump de la MÁQUINA DE LA TIENDA** (los números de arriba
  son del dump de desarrollo del 04/09 23:57: 2185 productos / 2781 unidades, y
  esa BD viene de un backup IMPORTADO, no de altas por `openNew`).

### 🔴 Bloqueadores de despliegue (07/09/2026)

1. **El zip v5 trae el `volcar-pos.html` VIEJO.**
   `ropa-cbba-v5-globalid-20260904.zip` se armó a las 14:30 del 04/09 y el
   volcado extendido (productos + unidades + globalId) se commiteó en `da86fc02`
   a las 19:53. Verificado dos veces: extrayendo el archivo del zip (su
   `dist/volcar-pos.html` no contiene `unidades`/`barcodes`/`globalId`) y por git
   — al regenerar el dist el 07/09, `dist/volcar-pos.html` cambia 19 líneas, o
   sea que **el `dist` versionado está desactualizado respecto de `public/`**.
   El dump del 04/09 salió del dev server de esta máquina (Vite sirve `public/`
   directo), no de un dist. → Regenerar dist (commit `build:`) y rearmar el zip
   ANTES de pedir el volcado en la tienda: sin unidades no se puede medir ni
   alinear.
2. Los items 18-19 **están dentro del zip v5**: o se rearma el zip con `a2bc695`
   incluido, o se verifica el alta de un producto nuevo en la tienda ANTES de
   desplegar.
3. La nube no recibió código nuevo desde el 04/09: `origin/main` sigue en
   `f049d84` (el desplegado en Cloudflare Pages) y el clon local
   (`tienda virtual - compra de ropa`) va **2 commits por delante SIN pushear**
   (`32e496b` y `e80067a`, ambos solo de bitácora, sin código). El D1 remoto
   tenía 2410 productos activos con `global_id` (verificado con wrangler el
   04/09 y el 07/09 en la sesión anterior; no re-verificado en este corte). El
   ritual de sync no cambió: falta solo el dump de la MÁQUINA DE LA TIENDA.

**Punto de retomar (07/09):** (a) regenerar dist con commit `build:` y rearmar el
zip v5 con el volcado extendido + los fixes de `a2bc695`; (b) cablear el botón de
alineación en `Sync.jsx`; (c) recién entonces el ritual en la tienda — zip a la
central → sync → vaciado total del catálogo cloud + re-sync → alinear → re-sync →
volcado nuevo y `node comparar-dump-nube.cjs` + `node simular-alineacion.mjs`
para remedir.

### ✅ Sincronización v2 por eventos — implementada, SIN desplegar (10/09/2026)

Diseño en `docs/DISENO_SYNC_EVENTOS.md` (aprobado por Alain). Reemplaza el
protocolo de cutoff por fecha: la nube registra cada venta/cancelación/expiración
web como evento con id creciente; el POS los baja, los aplica con idempotencia
por id (tabla `webEventos`) y confirma (`ack`); el snapshot de stock cruza SOLO
por `globalId` y la nube publica `stock_pos + Σ eventos sin ack`. Cualquier corte
se resuelve volviendo a sincronizar.

21. **POS** (`55671d3e`..`c3b1757f`): schema **v24** (`webEventos: 'id, tipo,
 productId, pedidoRef, aplicadoEn'`, sin upgrade; viaja en backup/restore);
 `utils/syncV2.js` (puro: `armarFilasSnapshot`, `planificarAplicacionEventos`,
 `debeSincronizarAuto`, 18 tests); `utils/syncV2Cliente.js` (`sincronizarV2`:
 pull→push 250/lote→finalizar→pull corto, reintentos en red/5xx, mutex,
 `syncV2.ultimaOk/ultimoError`); helpers Dexie `garantizarGlobalIds`,
 `obtenerConfigSyncV2`, `idsEventosYaAplicados`, `aplicarPlanEventos` (UNA
 transacción; marca `barcodes.usedRef = 'WEB #REF'` para poder liberar la
 unidad correcta al cancelar); `Sync.jsx` reescrito (estado, fases, resultado,
 toggle de **sync automática** + intervalo); hook `useSyncAutomatica` en
 `Layout` (solo admin, tick por minuto, indicador en el menú). RETIRADOS:
 `syncGuard.js`, `syncAplicar.js`, importación Excel de ventas
 (`parsearVentasEnLinea`/`cruzarVentas`/`ventasDesdeApi`) y
 `ultimaImportacionVentas`. **245 tests** + build OK. Zip
 **`ropa-cbba-v8-sync-eventos-20260910.zip`** (1.39 MB, 164 entradas, desde
 `git archive` del árbol versionado, sin backup JSON).
22. **Nube** (`932f961`..`99761de`, en `main` local, **SIN push**): migración
 `006_sync_eventos.sql` (`stock_eventos`, `sync_dispositivos`,
 `products.sesion_snapshot`); `lib/eventos.js` (evento en el MISMO batch que el
 stock en checkout/expiración/cancelación); `lib/syncV2.js`
 (`planificarSnapshot` pura + `aplicarSnapshot`/`confirmarEventos`/
 `finalizarSesion`); endpoints `/api/sync/v2/{eventos,snapshot,ack,finalizar}`.
 34/34 tests + build OK. Los endpoints viejos siguen vivos.

**Orden de despliegue OBLIGATORIO** (Alain decide cuándo):
1. Aplicar la migración 006 en D1 remoto ANTES del push (si el código nuevo
 llega sin `stock_eventos`, el INSERT del checkout falla y nadie puede
 comprar). `wrangler d1 migrations apply tienda-virtual-db --remote`, o el SQL
 por MCP + `INSERT INTO d1_migrations (name) VALUES ('006_sync_eventos.sql')`.
2. Push de la nube → Cloudflare Pages despliega.
3. Zip v8 a la máquina CENTRAL (lanzar el POS v8 completo, no copiar archivos
 sueltos: el volcado del 10/09 dio 0/2592 `global_id`, señal de que la central
 corre una BD v22). Primera sync: el bootstrap adopta por `codigo` los
 productos de la nube sin `global_id`; luego todo cruza por identidad.
4. Encender la sync automática en `/sync` (solo la central).
Pendiente conocido (no resuelto por diseño): prendas multi-unidad — la etiqueta
física no coincide con el código web (598 etiquetas del dump de desarrollo).
