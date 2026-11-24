# 📋 Seguimiento de Tareas - Tienda de Ropa

## 🚦 Estado Actual
- **Base de Datos:** Dexie.js con esquema v22 (22 migraciones). Capa de datos modularizada en `src/db/` (`schema.js`, `helpers.js`, `seed.js`, `audit.js`).
- **Frontend:** React 19 + Tailwind CSS. POS ya dividido en `components/pos/` (CartPanel, ProductSearch, PaymentPanel). ProductList y POS ya refactorizados.
- **Tests:** 171 tests en verde (`src/__tests__/`) cubriendo lógica crítica: cierres retroactivos, cripto, validaciones, permisos, anti-manipulación de fecha, abonos, integridad referencial.
- **Seguridad:** PBKDF2-SHA256 (100k iteraciones), permisos granulares, logout por inactividad, detección de manipulación de reloj, auditoría de cierres.
- **Estado general:** Sistema maduro y en producción. La deuda restante es de mantenimiento, no de funcionalidad.

## ✅ Completado desde la última revisión
- [x] Dividir `src/db.js` → modularizado en `src/db/`.
- [x] Dividir `src/components/POS.jsx` → modularizado en `src/components/pos/`.
- [x] Dividir `src/components/ProductList.jsx` (620 → 312 líneas).
- [x] Centralizar lógica de `reservedMap` → hook `useAvailableStock` creado.
- [x] Implementar carpeta de tests → `src/__tests__/` con 171 tests.

## 🛠 Tareas Pendientes

### 1. Refactorización (Prioridad Alta)
- [ ] Dividir `src/components/Reservations.jsx` (1.867 líneas — el módulo más grande). Extraer lógica de grupos/abonos, UI y generación de PDF.
- [ ] Dividir `src/components/CashClose.jsx` (982 líneas).

### 2. Funcionalidad (Prioridad Media)
- [x] Resolver la dependencia `xlsx`: se usa solo para ESCRIBIR Excel en `Sync.jsx` (exportación de stock); el aviso de seguridad (lectura) está mitigado y protegido por test. Ver `docs/SEGURIDAD.md` §5.
- [ ] Eliminar o reintegrar `src/components/DataIntegrity.jsx`: su ruta (`/data-integrity`) siempre redirige; la lógica vive en `CashClose.jsx`.
- [ ] Añadir tests de componentes React (actualmente solo hay tests de lógica pura).

### 3. Seguridad (Prioridad Media)
- [x] Proteger el borrado, la limpieza y la restauración con contraseña de admin en `Backup.jsx` (reaplicado sobre SQLite, 24/11/2026).
- [x] Credenciales de fábrica: cambio obligatorio en el primer login (reaplicado sobre SQLite, 24/11/2026).
- [ ] Revisar validaciones de entrada en formularios para prevenir XSS (React escapa por defecto; `Barcode.jsx` ya sanitiza con `escapeHtml` — extender ese criterio donde se genere HTML manual).

### 4. Mantenimiento (Prioridad Baja)
- [ ] Versionar `package.json` (sigue en `0.0.0` pese a estar en producción).
- [ ] Revisar enfoque *Mobile First* en el catálogo.
- [ ] Añadir micro-animaciones en transiciones de formularios.

---
*Última actualización: 2026-07-27 (revisión completa contra el código real)*
