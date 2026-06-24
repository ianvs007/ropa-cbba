# 📋 Seguimiento de Tareas - Tienda de Ropa

## 🚦 Estado Actual
- **Base de Datos:** Dexie.js v10 implementada con esquemas para productos, ventas, gastos, reservas y códigos de barras.
- **Frontend:** React 19 + Tailwind CSS. Componente `ProductList` robusto con gestión de stock atómicao y validaciones.
- **Pendiente según ADN:** Refactorización de archivos que superan las 400 líneas (`db.js` y `ProductList.jsx`).

## 🛠 Tareas del Proyecto

### 1. Refactorización y Limpieza (Prioridad Alta)
- [ ] Dividir `src/db.js` (Actual: 539 líneas). Extraer esquemas y semillas.
- [ ] Dividir `src/components/ProductList.jsx` (Actual: 620 líneas). Modularizar UI y lógica.
- [ ] Dividir `src/components/POS.jsx` (Actual: 525 líneas).
- [ ] Centralizar lógica de `reservedMap` (Principio DRY). Crear un hook `useAvailableStock`.
- [ ] Implementar carpeta `/tests` para validaciones críticas de stock y ventas.

### 2. Mejoras de Seguridad (El Centinela)
- [ ] Revisar validaciones de entrada en formularios para prevenir XSS.
- [ ] Asegurar que el borrado de datos (reset) sea protegido por contraseña de admin.

### 3. Experiencia de Usuario (El Estetea)
- [ ] Revisar el enfoque *Mobile First* en el catálogo.
- [ ] Añadir micro-animaciones en las transiciones de formularios.

---
*Última actualización: 2026-03-23*
