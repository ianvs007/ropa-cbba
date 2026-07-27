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
- [ ] Resolver la dependencia `xlsx`: está instalada pero no se importa en ningún archivo. Implementar la exportación a Excel o eliminar la dependencia.
- [ ] Eliminar o reintegrar `src/components/DataIntegrity.jsx`: su ruta (`/data-integrity`) siempre redirige; la lógica vive en `CashClose.jsx`.
- [ ] Añadir tests de componentes React (actualmente solo hay tests de lógica pura).

### 3. Seguridad (Prioridad Media)
- [ ] Proteger el borrado/reset de datos con contraseña de admin (hoy solo tiene doble confirmación en `Backup.jsx`).
- [ ] Cambiar credenciales por defecto débiles del seed (`admin123` / `cajera123`).
- [ ] Revisar validaciones de entrada en formularios para prevenir XSS (React escapa por defecto; `Barcode.jsx` ya sanitiza con `escapeHtml` — extender ese criterio donde se genere HTML manual).

### 4. Mantenimiento (Prioridad Baja)
- [ ] Versionar `package.json` (sigue en `0.0.0` pese a estar en producción).
- [ ] Revisar enfoque *Mobile First* en el catálogo.
- [ ] Añadir micro-animaciones en transiciones de formularios.

---
*Última actualización: 2026-07-27 (revisión completa contra el código real)*
