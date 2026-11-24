# Tienda de Ropas

Sistema de gestión de tienda de ropas con funcionalidades de inventario, códigos de barras, reportes y cierre de caja.

## Características

- Gestión de productos y stock.
- Asignación y seguimiento de códigos de barras.
- Reportes mensuales y cierre de caja.
- Sistema de roles y permisos.
- Exportación a Excel y generación de PDF.
- Almacenamiento local mediante IndexedDB (Dexie).

## Tecnologías

- React 19
- Vite
- Tailwind CSS
- Recharts
- Dexie
- JsBarcode
- jsPDF
- XLSX
- TensorFlow.js (en evaluación)

## Documentación

Para ver el avance del sistema, consulta [docs/avance.md](docs/avance.md).

## Scripts disponibles

- `npm run dev` – Inicia el servidor de desarrollo (solo para desarrollar).
- `npm run start` – Sirve el build de `dist/` (`vite preview`, puerto 3001): es lo que usa producción.
- `npm run build` – Compila la aplicación para producción.
- `npm run lint` – Ejecuta ESLint.
- `npm run test` – Ejecuta las pruebas con Vitest.
- `npm run format` – Formatea el código con Prettier.

## Instalación

```bash
npm install
npm run build   # genera dist/ (ya viene versionado)
npm run start   # produccion: http://localhost:3001
```

En el primer ingreso (`admin` / `admin123`) el sistema obliga a elegir una contraseña nueva.
Para configurar el token de la BD SQLite en red y demás medidas, ver
[docs/SEGURIDAD.md](docs/SEGURIDAD.md).

## Licencia

Este proyecto es de uso interno.
