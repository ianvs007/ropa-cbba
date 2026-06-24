# 🔍 ANÁLISIS EXHAUSTIVO: SISTEMA DE VENTAS "TIENDA DE ROPAS"

**Fecha**: 26 de marzo de 2026  
**Stack**: React 19 + Dexie.js (IndexedDB) + TailwindCSS (sin backend)  
**Base de Datos**: Completamente local en IndexedDB del navegador

---

## 📋 TABLA DE CONTENIDOS

1. [Arquitectura del Sistema](#-arquitectura-del-sistema)
2. [Flujo de Negocios](#-flujo-de-negocios)
3. [Anulación de Ventas - Análisis Detallado](#-anulación-de-ventas---análisis-detallado)
4. [Cierre de Caja](#-cierre-de-caja)
5. [Reportes y Dashboard](#-reportes-y-dashboard)
6. [Problemas Identificados](#-problemas-identificados)
7. [Análisis de Integridad de Datos](#-análisis-de-integridad-de-datos)
8. [Control de Acceso](#-control-de-acceso)
9. [Recomendaciones de Arquitectura](#-recomendaciones-de-arquitectura)
10. [Archivos Clave](#-archivos-clave)

---

## 🏗️ ARQUITECTURA DEL SISTEMA

### Estructura de Base de Datos

#### Tabla: `products`
```
Índices: ↑id, name, barcode, category, brand, size, color, stock, cost, price, shortCode, active, createdAt
Campos clave:
  - stock: cantidad disponible (descontado por ventas y reservas)
  - cost: costo unitario
  - price: precio de venta
  - active: archivado lógico (v10+)
  - shortCode: código de 5 dígitos único
  - barcode: EAN-13 único por modelo
```

#### Tabla: `sales` ✅ CON STATUS
```
Índices: ↑id, date, total, sellerId, paymentMethod, status
Campos clave:
  - items: Array<{productId, qty, price, originalPrice, cost, name, size, color}>
  - total: monto de la venta
  - status: "normal" (implícito) | "annulled" ← CRÍTICO PARA FILTROS
  - paymentMethod: "efectivo" | "qr" | "reserva"
  - sellerId, sellerName: trazabilidad del vendedor
  - date: ISO timestamp
  - received, change: para transacciones en efectivo
  - discount: descuento total aplicado (si aplica)
  - reservationId: si proviene de completar una reserva
```

#### Tabla: `kardex`
```
Índices: ↑id, productId, date, type
Campos clave:
  - type: "entrada" | "salida"
  - qty: cantidad movida
  - notes: descripción del movimiento
  - balanceAfter: stock resultante (para auditoría)
```

#### Tabla: `reservations`
```
Índices: ↑id, clientName, clientPhone, productId, status, createdAt, sellerId
Campos clave:
  - status: "pending" | "completed" | "cancelled" | "annulled"
  - totalPrice: precio de la prenda
  - expiryDate: fecha de vencimiento de la reserva
  - Notes: información adicional
```

#### Tabla: `reservationPayments`
```
Índices: ↑id, reservationId, date
Campos clave:
  - amount: monto abonado
  - paymentMethod: "efectivo" | "qr"
  - status: "normal" (implícito) | "annulled" ← IMPORTANTE PARA REPORTES
  - registeredBy: quién registró el pago
```

#### Tabla: `cashClosures` (v15)
```
Índices: ↑id, date
Campos clave:
  - date: YYYY-MM-DD (ÚNICO - previene cierres duplicados)
  - cashStart: efectivo inicial
  - cashOnHand: efectivo contado
  - totalSales, totalExpenses, netIncome
  - salesCount, itemsSold, expensesCount
  - cashDifference: varianza de arqueo
  - closedBy, closedAt: trazabilidad
  - syncAt: timestamp de última sincronización
  - Campos desglosados: cashSales, cashReservations, qrSales, qrReservations
```

#### Tabla: `expenses`
```
Índices: ↑id, date, categoryId, amount, paymentMethod, userId, registeredBy
```

---

## 📊 FLUJO DE NEGOCIOS

### CASO 1: Venta Directa (POS)

```
1. INICIO EN POS.jsx
   ├─ Usuario selecciona producto
   ├─ Agrega a carrito con validación:
   │  ├─ Stock disponible = stock físico - reservas pendientes (useAvailableStock)
   │  └─ Si stock insuficiente → error "Sin stock disponible"
   │
   2. VALIDACIONES EN CARRITO
   ├─ Precio >= costo (siempre)
   ├─ Rebaja máxima <= maxDiscount (config)
   ├─ No permitir precios negativos o cero
   │
   3. CÁLCULO DE DESCUENTOS
   ├─ originalTotal = suma de (item.originalPrice * qty)
   ├─ total = suma de (item.price * qty) [con rebajas aplicadas]
   ├─ totalDiscount = originalTotal - total
   │
   4. VALIDACIÓN FINAL PRE-VENTA
   ├─ Verificar stock en tiempo real (puede cambiar)
   ├─ Si algún item: qty > available → error
   ├─ Si algún item: precio <= costo → error
   │
   5. REGISTRAR VENTA
   ├─ db.sales.add({
   │  ├─ date: ISO timestamp
   │  ├─ items: cart array
   │  ├─ total, originalTotal, discount
   │  ├─ paymentMethod: "efectivo" | "qr"
   │  ├─ received, change (si efectivo)
   │  ├─ sellerId, sellerName
   │  ├─ NO incluye status (por defecto NULL/undefined)
   │  └─ SIN reservationId (no es reserva convertida)
   │  })
   │
   6. DESCONTAR STOCK
   ├─ discountStock(items) en transacción:
   │  ├─ Para cada item:
   │  │  ├─ Actualizar product.stock -= qty
   │  │  ├─ Marcar N barcodes como used=true
   │  │  └─ Registrar entrada en kardex con type="salida"
   │  └─ Transacción atómica (todo o nada)
   │
   7. SINCRONIZAR CIERRE DE CAJA
   └─ syncClosureIfDateExists(date) → actualiza totales del cierre si ya existe
```

### CASO 2: Venta por Reserva (Reservations)

```
1. CREAR RESERVA
   ├─ clientName, clientPhone, productId, totalPrice
   ├─ status = "pending"
   ├─ expiryDate = hoy + returnDays
   ├─ NO descontar stock (solo registrar "reservado")
   │
   2. REGISTRAR ABONO INICIAL
   └─ reservationPayments.add({
      ├─ reservationId
      ├─ date, amount, paymentMethod
      ├─ registeredBy (usuario que registra)
      └─ NO incluye status (por defecto NULL/undefined)
   })

3. REGISTRAR ABONOS POSTERIORES
   ├─ Validar que remaining > 0
   ├─ Validar que abono <= remaining
   ├─ Registrar en reservationPayments
   │
   4. COMPLETAR RESERVA (cuando paid >= totalPrice)
   ├─ TRANSACCIÓN ATÓMICA:
   │  ├─ Marcar reserva como status="completed"
   │  ├─ Descontar stock físico: product.stock -= 1
   │  ├─ Marcar barcode como used=true
   │  ├─ Registrar salida en kardex
   │  └─ Crear venta asociada:
   │     ├─ items: [{productId, name, qty:1, price: reserva.totalPrice}]
   │     ├─ total: totalPrice
   │     ├─ paymentMethod: "reserva" ← IMPORTANTE
   │     ├─ reservationId: reserva.id ← VINCULACIÓN
   │     └─ sellerName: quien creó la reserva
   │
   5. SINCRONIZAR CIERRE
   └─ syncClosureIfDateExists(date)
```

---

## ✂️ ANULACIÓN DE VENTAS - ANÁLISIS DETALLADO

### Punto de Entrada: SalesHistory.jsx (línea 51)

### FUNCIÓN: `handleAnnul(sale)`

#### PASO 1: VALIDACIÓN DE CIERRE DE CAJA
```javascript
const saleDate = sale.date?.slice(0, 10);
const closure = await db.table('cashClosures').where('date').equals(saleDate).first();
if (closure) {
    alert('No es posible anular esta venta porque ya se realizó el CIERRE DE CAJA del día...');
    return;  // ⚠️ BLOQUEA COMPLETAMENTE
}
```
**COMPORTAMIENTO**: 
- Si existe un cierre para esa fecha, la anulación es IMPOSIBLE
- El usuario debe contactar al administrador
- ¿PROBLEMA?: No hay forma de reversar esto sin editar la BD directamente

#### PASO 2: CONFIRMACIÓN DEL USUARIO
```
Mensaje mostrado al vendedor:
"¿Estás seguro de ANULAR la venta #${sale.id}?
Esta acción:
1. Devolverá los productos al stock.
2. Registrará la devolución en el Kardex.
3. El monto se restará de tus reportes de ingresos.
[4. Los abonos de esta reserva también se anularán. ← SI APLICA]"
```

#### PASO 3: TRANSACCIÓN ATÓMICA
```javascript
await db.transaction('rw', [db.products, db.kardex, db.sales, 
                             db.reservationPayments, db.reservations, 
                             db.cashClosures], async () => {
    
    // PASO 3A: Devolver productos al stock
    for (const item of (sale.items || [])) {
        const product = await db.products.get(item.productId);
        if (product) {
            // Restaurar stock
            const newStock = (product.stock || 0) + item.qty;
            await db.products.update(item.productId, { stock: newStock });
            
            // Registrar entrada en Kardex
            await db.kardex.add({
                productId: item.productId,
                date: new Date().toISOString(),
                type: 'entrada',  // REVERSO de la "salida"
                qty: item.qty,
                notes: `ANULACIÓN VENTA #${sale.id}`,
                balanceAfter: newStock,
            });
        }
    }
    
    // PASO 3B: Marcar venta como anulada
    await db.sales.update(sale.id, { status: 'annulled' });
    
    // PASO 3C: CASCADE - Si era linkedto una reserva
    if (sale.reservationId) {
        // Anular todos los pagos de esa reserva
        await db.reservationPayments
            .where('reservationId').equals(sale.reservationId)
            .modify({ status: 'annulled' });
        
        // Marcar la reserva como anulada
        await db.reservations.update(sale.reservationId, {
            status: 'annulled',  // Nuevo estado disponible desde v0.1.0
            cancelledAt: new Date().toISOString()
        });
    }
});

// PASO 4: Sincronizar cierre si existe
await syncClosureIfDateExists(sale.date);  // Aunque se validó que NO existe
```

### FLUJO DE DATOS POST-ANULACIÓN

```
┌─────────────────────────────────────────┐
│ VENTA ANULADA: status = "annulled"      │
├─────────────────────────────────────────┤
│                                         │
│ STOCK RESTAURADO:                       │
│ product.stock += vendido                │
│                                         │
│ KARDEX REGISTRADO:                      │
│ kardex.add({ type: 'entrada' })        │
│                                         │
│ CASCADA (si reserve linkedto):          │
│ ├─ Reservation.status = 'annulled'     │
│ └─ ReservationPayments.status[] = ...  │
│                                         │
│ REPORTES (actualizados):                │
│ - Excluye en cálculos: status='annul'  │
│ - Kardex: muestra entrada (reverso)    │
│ - Cierre: recalculado si existe        │
└─────────────────────────────────────────┘
```

### Control de Acceso a Anulación

```javascript
// SalesHistory.jsx línea 266
{user?.role === 'admin' && (
    <button 
        onClick={() => handleAnnul(s)}
        disabled={s.status === 'annulled'}
        className={...}
        title="Anular venta">
        <RotateCcw size={15} />
    </button>
)}
```
**RESTRICCIÓN**: ✅ **Solo ADMIN puede anular ventas**
- Vendedores: No ven el botón
- Admin: Siempre habilitado (excepto si ya está annulled)

---

## 💰 CIERRE DE CAJA

### Función: `calculateClosureData(date)` - helpers.js línea 388

```javascript
export async function calculateClosureData(date) {
    // PASO 1: Obtener datos del día
    const [sales, resPayments, expenses] = await Promise.all([
        db.sales.where('date').startsWith(date).toArray(),
        db.reservationPayments.where('date').startsWith(date).toArray(),
        db.expenses.where('date').startsWith(date).toArray()
    ]);

    // PASO 2: FILTRO CRÍTICO - Excluir ventas anuladas y reservas canceladas
    const activeResIds = new Set(
        (reservations || [])
            .filter(r => r.status !== 'cancelled' && r.status !== 'annulled')
            .map(r => r.id)
    );
    
    const filteredSales = sales.filter(s => s.status !== 'annulled');
    const filteredRes = resPayments.filter(p => 
        p.date?.startsWith(date) && 
        p.status !== 'annulled' && 
        activeResIds.has(p.reservationId)  // ← Double check de integridad
    );
    const filteredExp = expenses.filter(e => e.date?.startsWith(date));

    // PASO 3: Cálculos desglosados
    const cashSales = filteredSales
        .filter(s => s.paymentMethod === 'efectivo')
        .reduce((s, v) => s + (v.total || 0), 0);
    
    const cashReservations = filteredRes
        .filter(p => p.paymentMethod === 'efectivo')
        .reduce((s, v) => s + (v.amount || 0), 0);
    
    const qrSales = filteredSales.filter(v => v.paymentMethod === 'qr')
        .reduce((s, v) => s + (v.total || 0), 0);
    
    const qrReservations = filteredRes.filter(v => v.paymentMethod === 'qr')
        .reduce((s, v) => s + (v.amount || 0), 0);
    
    // ... más cálculos ...

    return {
        date,
        salesCount: filteredSales.length + filteredRes.length,
        itemsSold: (sum de items en ventas),
        totalSales: cashSales + cashReservations + qrSales + qrReservations,
        totalExpenses,
        cashExpenses,
        cashSales, cashReservations,
        qrSales, qrReservations,
        totalCashIn: cashSales + cashReservations,
        totalQrIn: qrSales + qrReservations,
        totalDiscounts,
        netIncome: totalSales - totalExpenses,
        expensesCount
    };
}
```

### Sincronización Post-Anulación

```javascript
export async function syncClosureIfDateExists(dateRaw) {
    const date = dateRaw.split('T')[0];
    
    const existing = await db.table('cashClosures')
        .where('date').equals(date).first();
    
    if (!existing) return;  // No hay cierre para esta fecha

    const newData = await calculateClosureData(date);
    
    // ACTUALIZAR totales (pero NO el arqueo)
    await db.cashClosures.update(existing.id, {
        totalSales: newData.totalSales,
        totalExpenses: newData.totalExpenses,
        cashExpenses: newData.cashExpenses,
        netIncome: newData.netIncome,
        salesCount: newData.salesCount,
        expensesCount: newData.expensesCount,
        itemsSold: newData.itemsSold,
        // NO toca: cashStart, cashOnHand, notes (el arqueo ya está hecho)
        syncAt: new Date().toISOString()
    });
}
```

### Flujo de Cierre de Caja (CashClose.jsx)

```
PASO 1: Seleccionar fecha
├─ Detectar si ya existe cierre para esa fecha
└─ Si existe: cargar para edición

PASO 2: Ver resumen del día
├─ Llamar calculateClosureData(date)
├─ Mostrar:
│  ├─ Ventas contado
│  ├─ Ventas QR
│  ├─ Abonos de reservas
│  ├─ Gastos
│  └─ Discrepancias

PASO 3: Arqueo (si no existe cierre)
├─ Ingresar efectivo inicial
├─ Contar efectivo en caja
├─ Calcular diferencia:
│  └─ Expected = inicial + entradas - salidas
│  └─ Actual = lo que se contó
│  └─ Diferencia = Actual - Expected
│
├─ Marcar como balanceado si: |diferencia| < 0.01
├─ Permitir notas si hay discrepancia
│
PASO 4: Registrar cierre
├─ db.cashClosures.put({  ← permite sobrescribir si existe
│  ├─ date (ÍNDICE ÚNICO → previene duplicados)
│  ├─ cashStart, cashOnHand, notes
│  ├─ Todos los totales calculados
│  ├─ closedBy, closedAt
│  └─ ... más campos
│  })
│
PASO 5: Post-cierre
├─ Mostrar confirmación
├─ Permitir imprimir comprobante
├─ Ofrecer cerrar siguiente día
```

### Problema Crítico: Reapertura de Cierres

```
ESCENARIO:
1. Se realiza cierre de caja del día X: db.cashClosures.put({id: 1, date: "2026-03-25", ...})
2. Luego se anula una venta de ese día
3. Se llama syncClosureIfDateExists() → ACTUALIZA el cierre
4. Pero LA INTEGRIDAD del arqueo (manual) ya está comprometida

PROBLEMA:
- El arqueo manual (cashStart, cashOnHand) NO se recalcula
- Los totales SÍ se recalculan
- Cash Difference ya no es confiable
- No hay auditoría de QUIÉN CAMBIÓ QUÉ VALORES

RIESGO: Un admin podría:
1. Crear cierre "limpio"
2. Anular venta
3. sync actualiza totales
4. El diferencial puede cambiar sin haber tocado la caja físicamente
```

---

## 📈 REPORTES Y DASHBOARD

### Dashboard.jsx

#### KPIs Principales (con filtrado correcto)

```javascript
// Variables clave:
const activeSales = (sales || []).filter(s => s.status !== 'annulled');
const activeResIds = new Set(
    (reservations || []).filter(r => r.status !== 'cancelled' && r.status !== 'annulled')
        .map(r => r.id)
);

// Hoy:
const salesToday = activeSales.filter(s => s.date?.startsWith(today));
const resPaymentsToday = (resPayments || []).filter(p => 
    p.date?.startsWith(today) && 
    p.status !== 'annulled' && 
    activeResIds.has(p.reservationId)
);

// Ingresos = ventas directas + abonos de reservas
const revenueToday = 
    salesToday.filter(s => s.paymentMethod !== 'reserva').reduce(...) +
    resPaymentsToday.reduce(...)

// ANÁLISIS: ✅ FILTRADO CORRECTO
// - Excluye status='annulled' en sales
// - Excluye status='annulled' en resPayments
// - Valida que reserva padre sea activa
```

#### Gráficos

```javascript
// Últimos 7 días:
const last7 = [...];  // ✅ Filtra activeSales y resPayments activos

// Últimos 6 meses:
const monthKey = date.toISOString().slice(0, 7);  // YYYY-MM
const totalSales = activeSales
    .filter(s => s.date?.startsWith(monthKey) && s.paymentMethod !== 'reserva')
    .reduce(...);
const totalRes = (resPayments || [])
    .filter(p => p.date?.startsWith(monthKey) && p.status !== 'annulled' && activeResIds.has(...))
    .reduce(...);
// ✅ CORRECTO

// Productos más vendidos:
const topProducts = activeSales.forEach(s => {
    (s.items || []).forEach(item => {
        counts[item.name] = ... + item.qty;
    });
});
// ✅ Solo calcula sobre ventas activas
```

#### Detector de Cierres Olvidados

```javascript
const datesWithActivity = new Set([
    ...(sales || [])
        .filter(s => s.status !== 'annulled')
        .map(s => s.date?.slice(0, 10)),
    ...(resPayments || [])
        .filter(p => p.status !== 'annulled' && activeResIds.has(p.reservationId))
        .map(p => p.date?.slice(0, 10))
]);

const closedDates = new Set(closures.map(c => c.date));
const pendingClosures = Array.from(datesWithActivity)
    .filter(d => !closedDates.has(d) && d < today);
// ✅ CORRECTO - Detecta fechas sin cierre
```

### Reporte Mensual (MonthlyReport.jsx)

```javascript
export async function calculateMonthlySummary(monthKey) {
    // FILTRADO EXHAUSTIVO:
    const mSales = sales.filter(s => 
        s.date?.startsWith(monthKey) && 
        s.status !== 'annulled'  // ✅
    );
    
    const reservations = await db.reservations.toArray();
    const activeResIds = new Set(
        reservations.filter(r => 
            r.status !== 'cancelled' && 
            r.status !== 'annulled'
        ).map(r => r.id)
    );
    
    const mRes = resPayments.filter(p => 
        p.date?.startsWith(monthKey) && 
        p.status !== 'annulled' &&  // ✅
        activeResIds.has(p.reservationId)  // ✅ Double check
    );
    
    const mExp = expenses.filter(e => e.date?.startsWith(monthKey));
    
    // Ingresos totales
    const totalSalesDirect = mSales
        .filter(s => s.paymentMethod !== 'reserva')
        .reduce((s, v) => s + (v.total || 0), 0);
    
    const totalResPayments = mRes
        .reduce((s, v) => s + (v.amount || 0), 0);
    
    const totalIncome = totalSalesDirect + totalResPayments;
    
    // ✅ ANÁLISIS: TODOS LOS FILTROS SON CORRECTOS
}
```

---

## 🚨 PROBLEMAS IDENTIFICADOS

### CRÍTICOS 🔴

#### 1. **Reapertura de Cierres sin Auditoría**

**Localización**: CashClose.jsx + syncClosureIfDateExists()

**Problema**:
```javascript
// El cierre es "actualizable" con .put():
const id = await db.table('cashClosures').put(data);  // Permite sobrescribir

// Si se anula una venta, se actualiza:
await db.cashClosures.update(existing.id, {
    totalSales, totalExpenses, netIncome, ...
    syncAt: new Date().toISOString()  // Pero sin auditoría de quién/cuándo
});
```

**Impacto**:
- El arqueo manual (cashStart, cashOnHand, notes) puede quedar inconsistente
- Cash Difference se modifica sin intervención humana
- No hay registro de quién realizó el cambio
- Auditoría comprometida

**Escenario de Riesgo**:
```
1. Admin realiza cierre del día X: Esperado 500 Bs, Contado 510 Bs → Diferencia +10
2. Se registra venta de 100 Bs
3. Luego se anula la venta de 100 Bs
4. syncClosureIfDateExists() → totalSales vuelve a 400 (sin la venta de 100)
5. Pero cashStart, cashOnHand, notes PERMANECEN SIN CAMBIAR
6. Cash Difference AHORA es incorrecto
7. No hay forma de saber que se removió una transacción
```

---

#### 2. **Falta de Validación de Integridad Referencial**

**Ubicaciones**: Toda la arquitectura de datos

**Problema**:
```javascript
// En SalesHistory.jsx: después de anular, se confía en que todo está bien
await db.transaction(..., async () => {
    // Si alguno de estos falla a mitad de transacción:
    // - producto actualizado
    // - kardex registrado
    // - venta marked anulled
    // - pero reserva NO actualizada ← INCONSISTENCIA POSIBLE
    
    for (const item of sale.items) { ... }  // Puede fallar aquí
    await db.sales.update(sale.id, { status: 'annulled' });  // OK
    
    if (sale.reservationId) {
        // ¿Qué si la reserva se eliminó manualmente?
        await db.reservationPayments.where(...).modify(...);  // Puede ser cero registros
        await db.reservations.update(sale.reservationId, {...});  // Puede fallar
    }
});
```

**Validaciones Faltantes**:
```
☐ No chequear que sale.items existan en products
☐ No validar que sale.items tengan cantidades consistentes
☐ No validar que sale.reservationId apunte a una reserva existente
☐ No validar que reserva.productId coincida con items de venta
☐ No chequear que no haya reservas "huérfanas" (sin venta asociada)
☐ No chequear que no haya ventas "huérfanas" (sin items válidos)
```

---

#### 3. **Stock puede Quedar Inconsistente**

**Localización**: 
- POS.jsx (descuentaStock)
- Reservations.jsx (completar reserva)
- SalesHistory.jsx (anular venta)

**Problema**:
```javascript
// En discountStock():
for (const item of items) {
    const product = await db.products.get(item.productId);
    if (!product) throw new Error(...);  // OK
    if (product.stock < item.qty) throw new Error(...);  // OK
    
    await db.products.update(item.productId, { stock: product.stock - item.qty });
    
    // ¿Pero qué si otro usuario hizo una venta entre el check y la actualización?
    // RACE CONDITION: stock insuficiente pero se registra de todas formas
}
```

**Escenario**:
```
Thread 1: Obtiene product.stock = 5
Thread 2: Obtiene product.stock = 5
Thread 1: Vende 3 → stock = 2
Thread 2: Vende 4 → stock = 1  ← NEGATIVO LÓGICO
```

**Mitigación Parcial**: Se valida `stock` antes de agregar al carrito, pero en navegador single-threaded esto es POCO PROBABLE.

---

#### 4. **Códigos de Barras y Códigos Cortos sin Garantía de Unicidad Real**

**Localización**: helpers.js + schema.js

**Problema**:
```javascript
// shortCode puede estar duplicado o NULL:
export async function generateShortCode() {
    const [allProducts, allUnitBarcodes] = await Promise.all([...]);
    const usedCodes = [...productCodes, ...unitCodes].filter(n => !isNaN(n));
    
    // Si dos usuarios crean códigos simultáneamente:
    // Usuario A ve que 00005 no está usado
    // Usuario B ve que 00005 tampoco está usado
    // Ambos crean. DUPLICADO.
}
```

---

### MAYORES 🟠

#### 5. **Vendedores Pueden Ver Ventas de Otros Vendedores (en reportes)**

**Localización**: SalesHistory.jsx línea 35

```javascript
const filtered = (sales || []).filter(s => {
    if (user?.role !== 'admin' && s.sellerName !== (user?.name || user?.username))
        return false;  // Solo ve sus propias ventas
    // ...
});
```

**Pero en Dashboard.jsx**: Los gráficos y totales INCLUYEN TODAS LAS VENTAS (si el usuario es admin). Esto es correcto, pero:
- Un vendedor loginead no puede ver el Dashboard (redirigido a POS)
- Esto es EXPECTED, no un problema

#### 6. **No Hay Auditoría de Cambios de Precios**

**Localización**: Cada venta guarda `price` final pero NO original (excepto si discount > 0)

```javascript
items: [{
    productId, qty, price,  // Precio FINAL
    originalPrice,  // Opcional, solo si price != originalPrice
    cost  // Guardado, pero ¿quién lo puede ver?
}]
```

**Problema**: 
- No hay record de "vendedor X aplicó rebaja Y del producto Z"
- No hay límites de rebajas por usuario
- Solo se filtra por maxDiscount global

#### 7. **Gastos sin Validación de Cantidad de Datos**

**Localización**: Expenses.jsx

```javascript
// No hay validación de:
☐ Montos negativos
☐ Explicación detallada (notas)
☐ Aprobación de gastos mayores a X
☐ Validación de categoría existente
```

---

### MENORES 🟡

#### 8. **Comentarios de Código Dejan Pistas de Bugs Arreglados**

**Localización**: Varios archivos

```javascript
// ── BUG FIX: Filtro para anuladas ──
// ── ROBUSTEZ: Filtrar pagos de reserva cuyo status sea 'annulled' ──
// ── SEGURIDAD: Bloquear si ya se cerró la caja ──
```

Esto es BIEN intencionado pero in producción podría ser riesgo de seguridad.

#### 9. **Sin Límite de Antiguedad en Cancelaciones**

**Localización**: Reservations.jsx línea 409

```javascript
// Cualquier reserva puede ser cancelada, sin importar si expiró
// Solo se bloquea si hay cierre de caja

// Debería validar: ¿La reserva sigue vigente o expiró?
if (reserva.expiryDate < new Date()) {
    // Manejar expiración explícitamente
}
```

#### 10. **Cambios de Precios en Carrito sin Logging**

**Localización**: POS.jsx updatePrice()

```javascript
const updatePrice = (productId, newPriceStr) => {
    // Cambia precio en carrito
    // Pero NO registra el cambio original vs nuevo
    // Solo se ve en el discount final
};
```

---

## 🔍 ANÁLISIS DE INTEGRIDAD DE DATOS

### Checklist de Integridad por Tabla

#### `products`
```
✅ Índices: OK
✅ Campos obligatorios: id, name, barcode
⚠️  shortCode: puede ser NULL o duplicado en algunos casos
⚠️  barcode: EAN-13 único por modelo, pero unidades individuales en `barcodes`
✅ Validaciones: stock nunca < 0 (en el código)
❌ NO hay constraint de costo <= precio (confía en lógica)
❌ NO hay auditoría de cambios de precio/costo
```

#### `sales`
```
✅ Índices: OK
✅ Campos: date, total, sellerId, paymentMethod, status
⚠️  items: puede ser [] (venta sin products)
⚠️  reservationId: puede apuntar a reserva inexistente
❌ NO hay validación de que items existan en products
❌ NO hay auditoría de descuentos por vendedor
```

#### `reservations` + `reservationPayments`
```
✅ Índices: OK
✅ Status: bien definidos (pending, completed, cancelled, annulled)
⚠️  Relación: reservationPayments → reservations no tiene constraint
⚠️  Expiración: NO se implementa auto-expiraración
❌ NO detectar reservas sin pagos iniciales
❌ NO validar que totalPrice sea > 0
```

#### `cashClosures`
```
✅ Índice ÚNICO en date: previene duplicados
✅ Contiene trazabilidad: closedBy, closedAt
⚠️  Puede ser actualizado sin auditoría post-cierre
⚠️  syncAt no garantiza consistencia
❌ NO hay versionamiento de cambios
❌ NO hay rollback de cierres
```

#### `kardex`
```
✅ Registra TODOS los movimientos
✅ balanceAfter útil para auditoría
⚠️  type: solo 2 valores (entrada/salida)
⚠️  notes: depende de descripción textual, sin enums
❌ NO hay auditoría de quién registró
❌ NO hay reversión explícita (solo "ANULACIÓN..." en notes)
```

### Queries para Detectar Inconsistencias

```javascript
// ❌ HUÉRFANOS: Ventas sin items válidos
const orphanSales = (await db.sales.toArray()).filter(s => 
    !s.items || s.items.length === 0 || 
    s.items.some(item => !item.productId || item.qty <= 0)
);

// ❌ HUÉRFANOS: Pagos de reserva sin reserva padre
const orphanPayments = (await db.reservationPayments.toArray()).filter(p => {
    const res = await db.reservations.get(p.reservationId);
    return !res;
});

// ❌ INCONSISTENCIA: Stock negativo
const negativeStock = (await db.products.toArray()).filter(p => p.stock < 0);

// ❌ INCONSISTENCIA: Venta con reservabID pero status !== 'completed'
const inconsistentSales = (await db.sales.toArray()).filter(s =>
    s.reservationId && (await db.reservations.get(s.reservationId))?.status !== 'completed'
);

// ❌ INCONSISTENCIA: Códigos cortos duplicados
const shortCodeDups = (() => {
    const codes = {};
    (await db.products.toArray()).forEach(p => {
        if (p.shortCode) codes[p.shortCode] = (codes[p.shortCode] || 0) + 1;
    });
    return Object.entries(codes).filter(([_, cnt]) => cnt > 1);
})();
```

---

## 🔐 CONTROL DE ACCESO

### Matriz de Permisos

```
                        ADMIN       VENDEDOR
─────────────────────────────────────────────
Ver Dashboard           ✅          ❌ (redirige a POS)
Ver POS                 ❌ (directo) ✅
Ver Reportes Mensuales  ✅          ❌
Ver Mis Ventas          ✅ todas    ✅ solo propias (filter)
Ver Todas las Compras   ✅          ❌
Registrar Venta         ✅          ✅
Anular Venta            ✅          ❌ (no ven botón)
Crear Reserva           ✅          ✅
Anular Reserva          ✅          ✅ (solo propias)
Registrar Abono         ✅          ✅
Registrar Gasto         ✅          ❌
Ver Gastos              ✅          ❌ (pero registra userId)
Cierre de Caja          ✅          ✅ (solo vendedores pueden cerrar su día)
Gestionar Usuarios      ✅          ❌
Gestionar Productos     ✅          ❌
Kardex                  ✅          ❌
Backup/Restore          ✅          ❌
```

### Autenticación

**Ubicación**: Login.jsx

```javascript
const user = await db.users
    .where('username').equals(username.trim().toLowerCase())
    .first();

if (!user || user.password !== password || user.active === false) {
    setError('Usuario o contraseña incorrectos');
    return;
}

// PROBLEMAS:
❌ Contraseñas almacenadas en PLAINTEXT en IndexedDB
❌ No hay hash (bcrypt, argon2, etc.)
❌ Sin protección contra fuerza bruta
❌ Sin expiración de sesión (sessionStorage indefinido)
✅ Sesión en sessionStorage (se limpia al cerrar pestaña)
```

---

## 🛠️ RECOMENDACIONES DE ARQUITECTURA

### CRÍTICO - Implementar Inmediatamente 🔴

#### 1. **Auditoría de Cambios en Cierres de Caja**

```javascript
// Crear tabla: cashClosureHistory
db.version(16).stores({
    ...
    cashClosureHistory: '++id, closureId, changedAt, changedBy'
});

// Cuando se actualice un cierre:
await db.transaction('rw', [db.cashClosures, db.cashClosureHistory], async () => {
    const oldData = await db.cashClosures.get(closureId);
    
    // Guardar versión anterior
    await db.cashClosureHistory.add({
        closureId,
        oldData,
        newData,
        changedAt: new Date().toISOString(),
        changedBy: user.name,
        reason: 'CAMBIO POST-CIERRE: Anulación de venta'
    });
    
    // Actualizar
    await db.cashClosures.update(closureId, newData);
});
```

#### 2. **Validación de Integridad Referencial**

```javascript
// Nueva función: helpers.js
export async function validateDataIntegrity() {
    const errors = [];
    
    // Huérfanos
    const sales = await db.sales.toArray();
    for (const sale of sales) {
        if (sale.reservationId) {
            const res = await db.reservations.get(sale.reservationId);
            if (!res) errors.push(`Venta #${sale.id} apunta a reserva inexistente`);
        }
        
        if (!sale.items || sale.items.length === 0) {
            errors.push(`Venta #${sale.id} sin items`);
        }
    }
    
    const resPayments = await db.reservationPayments.toArray();
    for (const pay of resPayments) {
        const res = await db.reservations.get(pay.reservationId);
        if (!res) errors.push(`Pago #${pay.id} apunta a reserva inexistente`);
    }
    
    // Stock
    const products = await db.products.toArray();
    for (const prod of products) {
        if (prod.stock < 0) errors.push(`Producto #${prod.id} stock negativo`);
    }
    
    return errors;
}

// Ejecutar diariamente durante cierre de caja
const issues = await validateDataIntegrity();
if (issues.length > 0) {
    alert(`⚠️  ALERTA DE INTEGRIDAD:\n${issues.join('\n')}\n\nContacta al administrador`);
}
```

#### 3. **Hash de Contraseñas**

```javascript
// Instalar: npm install crypto-js
import CryptoJS from 'crypto-js';

// En login:
const user = await db.users.where('username').equals(username).first();
const passwordHash = CryptoJS.SHA256(password).toString();

if (!user || user.passwordHash !== passwordHash || user.active === false) {
    setError('Usuario o contraseña incorrectos');
}

// En creación de usuario:
await db.users.add({
    username, 
    passwordHash: CryptoJS.SHA256(password).toString(),
    ...
});
```

---

### IMPORTANTE - Implementar en Próxima Versión 🟠

#### 4. **Versionamiento de Productos**

```javascript
// Estados: "pending", "completed", "cancelled"
// En vez de solo archivado (active: false)

db.version(17).stores({
    ...
    productVersions: '++id, productId, changedAt, changedBy'
});
```

#### 5. **Límites de Rebajas por Vendedor**

```javascript
// En settings:
const maxDiscountByRole = {
    admin: 100,  // Sin límite (0 = sin límite)
    vendedor: 50
};

// En POS.jsx updatePrice():
const userMaxDiscount = maxDiscountByRole[user.role] || maxDiscount;
if (discount > userMaxDiscount) {
    throw new Error(`Rebaja máxima: ${userMaxDiscount}`);
}
```

#### 6. **Auto-expiración de Reservas**

```javascript
// Ejecutar cada hora o al abrir la app
export async function expireReservations() {
    const reservations = await db.reservations
        .where('status').equals('pending').toArray();
    
    const now = new Date();
    const expired = reservations.filter(r => 
        new Date(r.expiryDate) < now
    );
    
    for (const res of expired) {
        await db.reservations.update(res.id, { 
            status: 'expired',  // nuevo status
            expiredAt: new Date().toISOString()
        });
    }
}
```

---

### RECOMENDADO - Mejoras de UX/Visibilidad 🟡

#### 7. **Panel de Riesgos de Datos**

```javascript
// Componente: RiskPanel.jsx
// Mostrar:
- Discrepancias en cierres de caja
- Reservas próximas a expirar
- Productos con stock bajo
- Cierres olvidados (últimos 30 días)
- Últimos casos de anulación
```

#### 8. **Reportes Mejorados**

```
- Anulaciones por vendedor (tendencia)
- Promedio de rebajas
- Discrepancias en arqueo
- Productos largas que se mueven
- Clientes frecuentes (por reservas)
```

#### 9. **Export/Import con Validación**

```javascript
// hooks/useBackupWithValidation.js
export async function createValidatedBackup() {
    const backup = await exportDatabase();
    const integrity = await validateDataIntegrity();
    
    return {
        ...backup,
        integrityCheck: {
            timestamp: new Date().toISOString(),
            status: integrity.length === 0 ? 'ok' : 'warning',
            issues: integrity
        }
    };
}
```

---

## 📁 ARCHIVOS CLAVE

### Estructura y Funciones Principales

| Archivo | Líneas | Función Principal |
|---------|--------|-------------------|
| **src/db/schema.js** | ~220 | definición versiones de DB (v1-15+) |
| **src/db/helpers.js** | ~500+ | funciones críticas: calculateClosureData, syncClosureIfDateExists, validateIntegrity |
| **src/components/POS.jsx** | ~250 | flujo de venta: carrito, validaciones, registro |
| **src/components/SalesHistory.jsx** | ~350 | historial de ventas, anulación (handleAnnul) |
| **src/components/CashClose.jsx** | ~400 | cierre de caja, arqueo |
| **src/components/Reservations.jsx** | ~700 | reservas, pagos, completado |
| **src/components/reports/Dashboard.jsx** | ~300 | KPIs, gráficos, integridad |
| **src/components/reports/MonthlyReport.jsx** | ~200 | reportes mensuales, calculateMonthlySummary |
| **src/components/Kardex.jsx** | ~150 | auditoría de movimientos |
| **src/components/CashClose.jsx** | ~400 | sistema principal de cierre |
| **src/App.jsx** | ~100 | rutas, control de acceso por rol |
| **src/components/Login.jsx** | ~120 | autenticación (sin hash) |

### Funciones Críticas

#### `calculateClosureData(date)` 
**Ubicación**: helpers.js:388
**Responsabilidad**: Calcular totales del día excluyendo anulaciones
**Riesgos**: Falsa confianza en integridad

#### `syncClosureIfDateExists(dateRaw)`
**Ubicación**: helpers.js:471
**Responsabilidad**: Sincronizar cierre post-anulación
**Riesgos**: Sin auditoría de cambios

#### `handleAnnul(sale)`
**Ubicación**: SalesHistory.jsx:51
**Responsabilidad**: Anular venta y cascada de datos
**Riesgos**: Integridad referencial

#### `discountStock(items)`
**Ubicación**: helpers.js:238
**Responsabilidad**: Restar stock de inventario
**Riesgos**: Race conditions (poco probable en navegador)

#### `validateDataIntegrity()`
**Ubicación**: FALTANTE 🚨
**Responsabilidad**: Detectar inconsistencias
**Estado**: NO IMPLEMENTADO

---

## 📊 MATRIZ DE RIESGOS

| Riesgo | Severidad | Probabilidad | Impacto | Mitigación Actual |
|--------|-----------|--------------|---------|------------------|
| Cierres reabiertos sin auditoría | 🔴 CRÍTICA | Alta | Pérdida de auditabilidad | Notas manuales |
| Datos huérfanos (ventas/pagos) | 🔴 CRÍTICA | Baja | Reportes inexactos | Ninguna |
| Stock negativo | 🟠 MAYOR | Baja | Pérdidas | Validación pre-venta |
| Códigos duplicados | 🟠 MAYOR | Baja | Confusión de productos | Regeneración en import |
| Contraseñas plaintext | 🔴 CRÍTICA | Alta | Acceso no autorizado | SessionStorage |
| Anulación sin trail | 🟠 MAYOR | Media | Fraude | Kardex registra |
| Reservas no expiran automático | 🟡 MENOR | Baja | Ocupan stock indefinido | Bloqueo en cierre |

---

## ✅ CONCLUSIÓN

**Estado General**: Aplicación FUNCIONAL con RIESGOS DE INTEGRIDAD graves

### Fortalezas ✅
- Transacciones atómicas bien implementadas
- Filtrado correcto de anuladas en reportes
- Control de acceso por roles definido
- Kardex registra todos los movimientos
- Validaciones básicas de stock pre-venta

### Debilidades Críticas ❌
- **Falta auditoría de cambios post-cierre**
- **Sin validación de integridad referencial**
- **Contraseñas no hay hash**
- **No hay expiración automática de reservas**
- **Códigos cortos sin garantía de unicidad**

### Recomendaciones Inmediatas
1. Implementar auditoría de cambios en cierres (priority 1)
2. Agregar validación de integridad diaria (priority 2)
3. Hash de contraseñas (priority 3)
4. Versionaming de cambios (priority 4)

---

**Documento preparado para**: Análisis de arquitectura y auditoría  
**Base**: Revisión de código fuente del proyecto  
**Alcance**: Flujo de ventas, anulación, cierre de caja, integridad de datos

