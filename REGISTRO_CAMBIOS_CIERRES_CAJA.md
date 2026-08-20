# Registro de Cambios — Historial de Cierres de Caja (Admin)

**Fecha:** 2026-08-18  
**Autor:** Sistema  
**Módulo:** Historial de Caja — Pestaña "Cierres de Caja" (rol Admin)

---

## 1. Resumen

Se implementó una nueva pestaña **"Cierres de Caja"** dentro del módulo **Historial de Caja**, visible exclusivamente para usuarios con rol `admin`. Esta funcionalidad permite visualizar todos los cierres de caja realizados por los vendedores, con información detallada de cada cierre y la capacidad de generar informes en PDF.

---

## 2. Archivos Modificados

### 2.1 `src/components/SalesHistory.jsx`
**Cambios realizados:**

- **Renombrado del título:** El encabezado pasó de *"Historial de ventas y gastos"* a **"Historial de Caja"**.
- **Nueva pestaña "Cierres de Caja":**
  - Visible solo para usuarios con `user.role === 'admin'`.
  - Icono: `DollarSign`.
  - Se limpian los filtros al cambiar de pestaña.
- **Consulta de datos:** Se agregó el hook `useLiveQuery` para obtener los registros de la tabla `cashClosures` ordenados por fecha de cierre descendente.
- **Filtros implementados:**
  - **Rango de fechas:** Inputs `dateFrom` y `dateTo` (ya existentes, ahora aplicados también a cierres).
  - **Filtro por vendedor:** Dropdown `<select>` que lista dinámicamente todos los vendedores que tienen al menos un cierre registrado. Se muestra solo en la pestaña de cierres.
  - **Búsqueda de texto:** Permite buscar por número de cierre, nombre del vendedor o contenido de los comentarios/observaciones.
- **Grilla de datos (tabla de cierres):** Se agregó una tabla con las siguientes columnas:
  - `#` — ID del cierre.
  - `Fecha Cierre` — Fecha y hora del cierre. Muestra badge "RETROACTIVO" si aplica.
  - `Vendedor` — Nombre del usuario que cerró la caja (`closedBy` o `username`).
  - `Inicio / Cierre` — Desglose de: efectivo inicial (`cashStart`), efectivo contado (`cashOnHand`), ventas totales (`totalSales`) y gastos totales (`totalExpenses`).
  - `Pagos` — Desglose de pagos por: efectivo (`totalCashIn`), QR/banco (`totalQrIn`) y cantidad de transacciones (`transactionCount`).
  - `Diferencia` — Valor de `cashDifference` con indicador visual:
    - 🟢 Verde = Excedente (positivo)
    - 🔴 Rojo = Faltante (negativo)
    - ⚪ Neutral = Cuadrado (cero)
  - `Comentarios` — Observaciones/notes que el vendedor dejó al cerrar la caja.
  - `Acciones` — Botón para imprimir el informe individual del cierre.
- **Botón de impresión masiva:** Al pie de la tabla aparece el botón **"Imprimir Informe Completo de Cierres"** que genera un PDF con todos los cierres actualmente filtrados.

### 2.2 `src/components/Layout.jsx`
**Cambios realizados:**

- **Renombrado del menú de navegación:**
  - `NAV_ADMIN` y `NAV_SELLER`: el item con `path: '/sales'` cambió su etiqueta de *"Historial de ventas y gastos"* a **"Historial de Caja"**.

### 2.3 `src/utils.js`
**Cambios realizados:**

- **Nueva función exportada:** `printCashClosuresReport(closures, currency)`
  - Genera un informe PDF en formato carta (letter) con encabezado de la tienda (logo, nombre, teléfono).
  - Lista cada cierre con los siguientes datos:
    - Efectivo Inicial (`cashStart`)
    - Efectivo en Caja al cierre (`cashOnHand`)
    - Ventas Totales (`totalSales`)
    - Gastos Totales (`totalExpenses`)
    - Ingreso Neto (`netIncome`)
    - Efectivo Esperado (`totalCashIn - cashExpenses`)
    - Diferencia de Arqueo (`cashDifference`)
    - Ventas en Efectivo (`cashSales`)
    - Ventas QR/Banco (`qrSales`)
    - Abonos en Efectivo (`cashReservations`)
    - Abonos QR/Banco (`qrReservations`)
    - Cantidad de Transacciones (`transactionCount`)
    - Prendas Vendidas (`itemsSold`)
    - Comentarios / Observaciones (`notes`)
  - Soporta múltiples páginas (salto de página automático si `y > 250`).
  - Señala cierres retroactivos con advertencia visual.
  - Pie de página con fecha de generación.

---

## 3. Estructura de Datos Utilizada

La funcionalidad consume registros de la tabla **`cashClosures`** (IndexedDB / Dexie.js), cuya estructura incluye los siguientes campos relevantes:

| Campo | Descripción |
|-------|-------------|
| `id` | Identificador único del cierre |
| `date` | Fecha del cierre (YYYY-MM-DD) |
| `userId` | ID del usuario que cerró |
| `username` | Nombre de usuario del vendedor |
| `closedBy` | Nombre mostrado del vendedor |
| `closedAt` | Fecha/hora exacta del cierre (ISO) |
| `openingId` | ID de la apertura de caja vinculada |
| `cashStart` | Monto inicial de la caja |
| `cashOnHand` | Monto contado físicamente al cerrar |
| `cashDifference` | Diferencia entre lo esperado y lo contado |
| `totalSales` | Total de ventas del turno |
| `totalExpenses` | Total de gastos del turno |
| `netIncome` | Ingreso neto (ventas - gastos) |
| `cashSales` | Ventas pagadas en efectivo |
| `qrSales` | Ventas pagadas por QR/banco |
| `cashReservations` | Abonos de reserva en efectivo |
| `qrReservations` | Abonos de reserva por QR/banco |
| `totalCashIn` | Total efectivo recibido |
| `totalQrIn` | Total QR/banco recibido |
| `transactionCount` | Número total de transacciones |
| `itemsSold` | Cantidad de prendas vendidas |
| `notes` | Comentarios del vendedor |
| `retroactive` | Flag de cierre retroactivo |

---

## 4. Permisos y Visibilidad

| Rol | Puede ver pestaña Cierres de Caja | Puede imprimir informes |
|-----|-----------------------------------|------------------------|
| `admin` | ✅ Sí | ✅ Sí |
| `seller` | ❌ No | ❌ No |

---

## 5. Notas Técnicas

- Se utilizó `React.useMemo` para el cálculo de `filteredClosures` y `closureSellers`, optimizando el rendimiento de filtros.
- El dropdown de vendedores se construye dinámicamente a partir de los datos reales de `cashClosures`, por lo que solo muestra vendedores que efectivamente han registrado cierres.
- El filtro por vendedor hace comparación case-insensitive (`toLowerCase()`).
- Los filtros son combinables: fecha + vendedor + búsqueda de texto funcionan de forma simultánea.

---

## 6. Próximos Posibles Mejoras (sugerencias)

- Agregar filtro por tipo de diferencia: "Solo excedentes", "Solo faltantes", "Cuadrados".
- Agregar filtro por método de pago predominante.
- Exportar la grilla de cierres a Excel/CSV además de PDF.
- Gráfico de evolución de diferencias de arqueo por vendedor.

---

*Fin del registro de cambios.*
