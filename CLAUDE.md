# CLAUDE.md — ropa-cbba (Tienda de Ropa)

POS **offline** para tienda de ropa en Cochabamba: React 19 + Vite + Dexie.js
(IndexedDB, schema **v22**) + Tailwind. Corre en 3 máquinas de producción como
ventana de navegador lanzada por `iniciar-servicio-silencioso.bat`; cada máquina
tiene su propia base de datos local (sin servidor, sin sincronización).

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
  `npm run build` antes de commitear. **157 tests** al 2026-07-08.
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

### 🔜 Posibles siguientes pasos (no comprometidos)

- Vista admin de cierres retroactivos / abrir `/cash` a admins.
- Bloqueo progresivo del POS con >N días pendientes (descartado por ahora).
- Pasada de consistencia de `toLocaleDateString()` sin locale en
  Reservations/Expenses (solo visual, preexistente).
