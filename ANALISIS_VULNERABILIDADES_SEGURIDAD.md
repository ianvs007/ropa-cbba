# 🔴 ANÁLISIS DE VULNERABILIDADES DE SEGURIDAD
**Fecha de Análisis**: 26 de marzo de 2026  
**Estado**: CRÍTICO  
**Riesgo**: ALTO - Corrupción de datos posible

---

## 🎯 VECTOR DE ATAQUE IDENTIFICADO

```
Vendedor manipula fecha del Sistema Operativo
    ↓
Sistema confía en new Date() (fecha local)
    ↓
Validaciones basadas en fecha local fallan
    ↓
Permite anular ventas de días anteriores
    ↓
Corrompe cierre de caja + kardex
```

---

## 🔴 VULNERABILIDADES ENCONTRADAS

### **1️⃣ CRÍTICA: Anulación de Ventas Antigua (SalesHistory.jsx)**

**Código Vulnerable**:
```javascript
const saleDate = sale.date?.slice(0, 10);
const today = new Date().toISOString().slice(0, 10);  // ← VULNERABLE

if (saleDate !== today) {
    alert('Solo hoy...');
    return;
}
```

**Ataque**:
1. Cambiar fecha del SO a 2026-03-25
2. Sistema cree que `today = "2026-03-25"`
3. Puede anular venta de ayer
4. Cambiar fecha SO de vuelta a 2026-03-26
5. ✅ Anulación ya registrada, cierre y kardex corrompidos

**Impacto**: CRÍTICO - Pérdida de datos contables

---

### **2️⃣ CRÍTICA: Cierre de Caja con Fecha Falsa (CashClose.jsx)**

**Código Vulnerable**:
```javascript
const [date, setDate] = React.useState(new Date().toISOString().slice(0, 10));
// Permite seleccionar cualquier fecha manualmente

// Al guardar:
closedAt: new Date().toISOString(),  // ← Timestamp actual (real)
```

**Ataque**:
1. Cambiar SO a date anterior (ej: 2026-03-25)
2. Crear cierre de caja "falso" para 2026-03-25
3. Cambiar SO a 2026-03-26
4. `closedAt` muestra marca de tiempo "real" pero cierre es de ayer
5. ✅ Cierres duplicados, desincronizados, datos inconsistentes

**Impacto**: CRÍTICO - Cierres fantasma, reportes inexactos

---

### **3️⃣ CRÍTICA: Cierre de Caja - Cambiar Montos Retroactivamente (CashClose.jsx)**

**Código Vulnerable**:
```javascript
// Al reabrirse un cierre:
setIsEditing(true);  // Permite EDITAR campos
totalSales: salesData.totalSales,  // ← Puede editarse manualmente
cashOnHand: countNum,  // ← El usuario ingresa valor
```

**Ataque**:
1. Cambiar SO a fecha anterior
2. Reabrirse un cierre viejo
3. Modificar: `cashOnHand` (aumentar), `notes`, etc.
4. Cambiar SO a hoy
5. ✅ Los datos antiguos ahora muestran cifras falsas

**Impacto**: CRÍTICO - Auditoría destruida, datos contables falsos

---

### **4️⃣ ALTA: Gasto de Días Anteriores (Expenses.jsx)**

**Código Vulnerable**:
```javascript
const today = new Date().toISOString().slice(0, 10);
// Permite registrar gastos de hoy

if (expenseDate < today) {
    alert('No puedes registrar gastos de días pasados');
}
```

**Ataque**:
1. Cambiar SO al día anterior
2. Registrar gasto ficticio
3. Cambiar SO de vuelta
4. ✅ Gasto registrado de día anterior, sin auditoría

**Impacto**: ALTA - Gastos fantasma, reducción artificial de utilidades

---

### **5️⃣ ALTA: Expiración de Reservas (Reservations.jsx)**

**Código Vulnerable**:
```javascript
expiryDate: new Date(
    Date.now() + resDays * 24 * 60 * 60 * 1000
).toISOString(),  // ← Depende de new Date()
```

**Ataque**:
1. Crear reserva con 1 día de expiración
2. Cambiar SO 2 días adelante
3. Reserva aparece expirada pero:
   - Stock sigue bloqueado (puede venderlo)
   - Auditoría muestra fecha falsa
4. ✅ Doble venta, datos inconsistentes

**Impacto**: ALTA - Stock duplicado, ventas inconsistentes

---

### **6️⃣ MEDIA: Cierres Pendientes Falsos (Dashboard/Layout.jsx)**

**Código Vulnerable**:
```javascript
const today = new Date().toISOString().slice(0, 10);
// Detecta cierres pendientes

const pendingDates = Array.from(activityDates)
    .filter(d => !closedDates.has(d) && d < today);
```

**Ataque**:
1. Cambiar SO para crear "cierres pendientes" falsos
2. Dashboard muestra alertas roja de cierre pendiente
3. Cambiar SO de vuelta
4. ✅ Reportes inconsistentes, auditoría confusa

**Impacto**: MEDIA - Confusión, reportes engañosos, no edita datos

---

## 📊 MATRIZ DE VULNERABILIDADES

| # | Módulo | Tipo | Impacto | Criticidad | Solución |
|---|--------|------|---------|-----------|----------|
| 1 | SalesHistory | Lógica | Anular ventas antiguas | CRÍTICA | ✅ CLIENTE-LADO |
| 2 | CashClose | Lógica | Cierres fecha falsa | CRÍTICA | ⏸️ DEPENDE SERVER |
| 3 | CashClose | UI | Editar datos retroactivos | CRÍTICA | ✅ CLIENTE-LADO |
| 4 | Expenses | Lógica | Gastos falsos | ALTA | ✅ CLIENTE-LADO |
| 5 | Reservations | Lógica | Stock duplicado | ALTA | ✅ CLIENTE-LADO |
| 6 | Dashboard | Lógica | Alertas falsas | MEDIA | ✅ CLIENTE-LADO |

---

## ✅ SOLUCIONES PROPUESTAS

### **Opción A: INMEDIATA (Client-side, ~1 hora)**
- ❌ Bloquear entrada manual de fecha en CashClose (solo HOY)
- ❌ Freezer fecha en comparaciones (usar snapshot inicial)
- ❌ Validar que closedAt <= fecha del cierre
- ❌ Bloquear edición de campos críticos en CashClose

**Ventaja**: Rápida, mejora 80% de seguridad  
**Desventaja**: Aún vulnerable a SO manipulado si es técnico

---

### **Opción B: ROBUSTA (Hybrid, ~3-4 horas)**
- ✅ Generar "sesión hash" al login (combinación de hora + usuario)
- ✅ Cada transacción crítica incluye hash
- ✅ Detectar cambios de fecha del SO grandes (>1 hora diferencia)
- ✅ Log de intentos sospechosos de manipulación
- ✅ Solo admin puede reabrirse cierres

**Ventaja**: Más segura, detecta ataques, auditoría completa  
**Desventaja**: Un poco más compleja

---

### **Opción C: MÁXIMA SEGURIDAD (Server-side, ~8+ horas)**
- 🔐 Server envía fecha/hora verificada
- 🔐 Todas transacciones se validan en servidor
- 🔐 Cierre de caja inmutable una vez guardado
- 🔐 Blockchain-like timestamp

**Ventaja**: Imposible manipular desde cliente  
**Desventaja**: Requiere backend

---

## 🎯 RECOMENDACIÓN

Implementar **OPCIÓN B** (Hybrid) porque:
1. ✅ Mejora seguridad significativamente
2. ✅ Detectable desde cliente (offline-friendly)
3. ✅ Registra evidencia de intentos
4. ✅ No requiere backend
5. ✅ ~3-4 horas de implementación

---

## 📋 PLAN DE ACCIÓN

```
FASE 1 (AHORA - 30 min):
  ✅ Bloquear selección manual de fecha en CashClose
  ✅ Bloquear edición de campos críticos si cierre >1 hora

FASE 2 (1-2 horas):
  ✅ Implementar detección de cambio de fecha del SO
  ✅ Log de intentos sospechosos
  ✅ Alertar si detecta manipulación

FASE 3 (1-2 horas):
  ✅ Congelar fecha al entrar al módulo crítico
  ✅ Validar closedAt <= fecha cierre
  ✅ Restricción por rol (solo admin reabre)
```

---

**¿Deseas que implemente la Opción B (Hybrid) ahora?**
