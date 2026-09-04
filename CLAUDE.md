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
  `npm run build` antes de commitear. **210 tests** al 2026-09-04.
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
