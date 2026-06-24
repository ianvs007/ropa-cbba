# 🔧 PLAN DE REMEDIACIÓN - TIENDA DE ROPAS

## Vulnerabilidades Críticas y Soluciones

---

## PARTE 1: AUDITORÍA DE CAMBIOS EN CIERRES DE CAJA

### Problema Identificado

Cuando se anula una venta después de un cierre de caja, la función `syncClosureIfDateExists()` actualiza automáticamente los totales SIN registrar Auditoría:

```javascript
// ACTUAL (línea helpers.js:471)
await db.cashClosures.update(existing.id, {
    totalSales: newData.totalSales,
    totalExpenses: newData.totalExpenses,
    netIncome: newData.netIncome,
    // ❌ Sin auditoría de qué cambió ni quién hizo el cambio
});
```

### Solución

#### PASO 1: Actualizar Schema (v16)

```javascript
// En src/db/schema.js - Add después de v15:

db.version(16).stores({
    // ... todos los anteriores ...
    cashClosureHistory: '++id, closureId, changedAt, changedBy'
}).upgrade(async tx => {
    // Migración: crear tabla vacía
    // En futuro, si hay cierres existentes, se podría hacer historial retroactivo
    return;
});
```

#### PASO 2: Crear Función de Auditoría

```javascript
// En src/db/helpers.js - Nueva función:

/**
 * Registra un cambio en un cierre de caja con auditoría completa.
 * Guarda la versión anterior para comparación.
 */
export async function updateCashClosureWithAudit(closureId, newData, userId, reason) {
    try {
        // 1. Obtener versión anterior
        const oldData = await db.cashClosures.get(closureId);
        if (!oldData) throw new Error(`Cierre #${closureId} no encontrado`);
        
        // 2. Calcular qué cambió
        const changes = {};
        for (const key of Object.keys(newData)) {
            if (oldData[key] !== newData[key]) {
                changes[key] = { old: oldData[key], new: newData[key] };
            }
        }
        
        // 3. Guardar en historial
        await db.transaction('rw', [db.cashClosures, db.cashClosureHistory], async () => {
            await db.cashClosureHistory.add({
                closureId,
                timestamp: new Date().toISOString(),
                changedBy: userId,
                reason,  // ej: "VENTA ANULADA: #1234"
                oldData,
                changes,  // Solo registra lo que cambió
                syncedAt: null
            });
            
            // 4. Actualizar cierre
            await db.cashClosures.update(closureId, {
                ...newData,
                lastAuditedAt: new Date().toISOString()
            });
        });
        
        console.log(`✅ Cierre #${closureId} auditado: ${JSON.stringify(changes)}`);
    } catch (error) {
        console.error('Error en auditoría de cierre:', error);
        throw error;
    }
}
```

#### PASO 3: Modificar syncClosureIfDateExists

```javascript
// ANTES:
export async function syncClosureIfDateExists(dateRaw) {
    const date = dateRaw.split('T')[0];
    const existing = await db.table('cashClosures').where('date').equals(date).first();
    if (!existing) return;
    
    const newData = await calculateClosureData(date);
    
    await db.cashClosures.update(existing.id, {
        totalSales: newData.totalSales,
        totalExpenses: newData.totalExpenses,
        // ... más campos
    });
}

// DESPUÉS:
export async function syncClosureIfDateExists(dateRaw, userId = 'SYSTEM') {
    const date = dateRaw.split('T')[0];
    const existing = await db.table('cashClosures').where('date').equals(date).first();
    if (!existing) return;
    
    const newData = await calculateClosureData(date);
    
    // Usar la nueva función de auditoría
    await updateCashClosureWithAudit(
        existing.id,
        {
            totalSales: newData.totalSales,
            totalExpenses: newData.totalExpenses,
            cashExpenses: newData.cashExpenses,
            netIncome: newData.netIncome,
            salesCount: newData.salesCount,
            expensesCount: newData.expensesCount,
            itemsSold: newData.itemsSold,
            syncAt: new Date().toISOString()
        },
        userId,
        'SINCRONIZACIÓN AUTOMÁTICA: Post-anulación de venta'
    );
}
```

#### PASO 4: Actualizar Llamadas en SalesHistory.jsx

```javascript
// En handleAnnul():
await syncClosureIfDateExists(sale.date, user?.id);  // Pasar userId

// En Reservations.jsx::cancelReservation():
for (const date of uniqueDates) {
    await syncClosureIfDateExists(date, user?.id);
}
```

#### PASO 5: Crear Vista de Auditoría (Componente)

```javascript
// Nuevo archivo: src/components/CashClosureAudit.jsx

import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { History, Eye, RotateCcw } from 'lucide-react';

export default function CashClosureAudit() {
    const [selectedClosure, setSelectedClosure] = React.useState(null);
    
    const closures = useLiveQuery(() => db.cashClosures.toArray(), []);
    const history = useLiveQuery(async () => {
        if (!selectedClosure) return [];
        return await db.cashClosureHistory
            .where('closureId').equals(selectedClosure)
            .orderBy('timestamp').reverse()
            .toArray();
    }, [selectedClosure]);
    
    return (
        <div className="max-w-7xl mx-auto fade-in">
            <h1 className="text-2xl font-bold text-pink-900 mb-4 flex items-center gap-2">
                <History size={24} /> Auditoría de Cierres
            </h1>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Panel de Cierres */}
                <div className="fashion-card">
                    <h2 className="font-bold mb-3 text-pink-800">Cierres de Caja</h2>
                    <div className="space-y-2 max-h-[600px] overflow-y-auto">
                        {closures?.map(c => (
                            <button
                                key={c.id}
                                onClick={() => setSelectedClosure(c.id)}
                                className={`w-full text-left px-3 py-2 rounded-lg transition-all
                                    ${selectedClosure === c.id 
                                        ? 'bg-pink-500 text-white' 
                                        : 'bg-pink-50 hover:bg-pink-100'}`}>
                                <div className="font-mono text-xs">{c.date}</div>
                                <div className="text-sm font-bold">Bs.{c.totalSales}</div>
                                {c.lastAuditedAt && (
                                    <div className="text-xs text-pink-600">
                                        Auditado: {new Date(c.lastAuditedAt).toLocaleDateString()}
                                    </div>
                                )}
                            </button>
                        ))}
                    </div>
                </div>
                
                {/* Panel de Historial */}
                <div className="lg:col-span-2 fashion-card">
                    <h2 className="font-bold mb-3 text-pink-800">Historial de Cambios</h2>
                    {!selectedClosure ? (
                        <p className="text-pink-400 text-sm">Selecciona un cierre para ver cambios</p>
                    ) : (
                        <div className="space-y-3 max-h-[600px] overflow-y-auto">
                            {history?.length === 0 ? (
                                <p className="text-pink-300">Sin cambios registrados</p>
                            ) : (
                                history?.map(h => (
                                    <div key={h.id} className="border border-pink-100 rounded-lg p-3 bg-pink-50">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="font-bold text-pink-900">{h.reason}</span>
                                            <span className="text-xs text-pink-600">
                                                {new Date(h.timestamp).toLocaleString()}
                                            </span>
                                        </div>
                                        <div className="text-xs text-pink-700 mb-2">
                                            Por: {h.changedBy || 'SISTEMA'}
                                        </div>
                                        
                                        {/* Cambios */}
                                        <div className="bg-white rounded p-2 text-xs font-mono space-y-1">
                                            {Object.entries(h.changes || {}).map(([key, {old, new: newVal}]) => (
                                                <div key={key} className="text-red-600">
                                                    {key}: {old} → {newVal}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
```

---

## PARTE 2: VALIDACIÓN DE INTEGRIDAD REFERENCIAL

### Problema Identificado

No hay mecanismo para detectar:
- Ventas sin items válidos
- Pagos de reservas sin reserva padre
- Ventas con reservaID inválido
- Stock negativo

### Solución

#### PASO 1: Crear Función de Validación Exhaustiva

```javascript
// En src/db/helpers.js:

/**
 * Validación completa de integridad de datos.
 * Retorna array de problemas encontrados.
 */
export async function checkDataIntegrity() {
    const issues = [];
    
    try {
        // ════════════════════════════════════════
        // 1. VENTAS HUÉRFANAS / INVÁLIDAS
        // ════════════════════════════════════════
        const sales = await db.sales.toArray();
        const products = (await db.products.toArray()) || [];
        const productIds = new Set(products.map(p => p.id));
        
        for (const sale of sales) {
            // 1a. Sin items
            if (!sale.items || sale.items.length === 0) {
                issues.push({
                    type: 'VENTA_SIN_ITEMS',
                    saleId: sale.id,
                    severity: 'HIGH',
                    message: `Venta #${sale.id} sin items de productos`
                });
            }
            
            // 1b. Items con productos inexistentes
            for (const item of (sale.items || [])) {
                if (!productIds.has(item.productId)) {
                    issues.push({
                        type: 'ITEM_PRODUCTO_INEXISTENTE',
                        saleId: sale.id,
                        productId: item.productId,
                        severity: 'HIGH',
                        message: `Venta #${sale.id}: Producto #${item.productId} no existe`
                    });
                }
                
                // 1c. Items con cantidad inválida
                if (!item.qty || item.qty <= 0) {
                    issues.push({
                        type: 'ITEM_CANTIDAD_INVALIDA',
                        saleId: sale.id,
                        qty: item.qty,
                        severity: 'HIGH',
                        message: `Venta #${sale.id}: Item con cantidad ${item.qty}`
                    });
                }
            }
            
            // 1d. Venta con reservaID inválida
            if (sale.reservationId) {
                const res = await db.reservations.get(sale.reservationId);
                if (!res) {
                    issues.push({
                        type: 'RESERVA_INEXISTENTE',
                        saleId: sale.id,
                        reservationId: sale.reservationId,
                        severity: 'HIGH',
                        message: `Venta #${sale.id}: Reserva #${sale.reservationId} no existe`
                    });
                }
            }
        }
        
        // ════════════════════════════════════════
        // 2. PAGOS HUÉRFANOS
        // ════════════════════════════════════════
        const resPayments = await db.reservationPayments.toArray();
        for (const pay of resPayments) {
            const res = await db.reservations.get(pay.reservationId);
            if (!res) {
                issues.push({
                    type: 'PAGO_RESERVA_INEXISTENTE',
                    paymentId: pay.id,
                    reservationId: pay.reservationId,
                    severity: 'CRITICAL',
                    message: `Pago #${pay.id}: Reserva #${pay.reservationId} no existe`
                });
            }
        }
        
        // ════════════════════════════════════════
        // 3. RESERVAS INCONSISTENTES
        // ════════════════════════════════════════
        const reservations = await db.reservations.toArray();
        for (const res of reservations) {
            // 3a. Producto inexistente
            if (res.productId && !productIds.has(res.productId)) {
                issues.push({
                    type: 'RESERVA_PRODUCTO_INEXISTENTE',
                    reservationId: res.id,
                    productId: res.productId,
                    severity: 'HIGH',
                    message: `Reserva #${res.id}: Producto #${res.productId} no existe`
                });
            }
            
            // 3b. Status invalid
            if (!['pending', 'completed', 'cancelled', 'annulled', 'expired'].includes(res.status)) {
                issues.push({
                    type: 'RESERVA_STATUS_INVALIDO',
                    reservationId: res.id,
                    status: res.status,
                    severity: 'MEDIUM',
                    message: `Reserva #${res.id}: Status no válido (${res.status})`
                });
            }
            
            // 3c. Completed sin venta asociada
            if (res.status === 'completed') {
                const sale = sales.find(s => s.reservationId === res.id);
                if (!sale) {
                    issues.push({
                        type: 'RESERVA_COMPLETED_SIN_VENTA',
                        reservationId: res.id,
                        severity: 'HIGH',
                        message: `Reserva #${res.id} marcada completed pero sin venta asociada`
                    });
                }
            }
        }
        
        // ════════════════════════════════════════
        // 4. PROBLEMAS DE STOCK
        // ════════════════════════════════════════
        for (const prod of products) {
            // 4a. Stock negativo
            if (prod.stock < 0) {
                issues.push({
                    type: 'STOCK_NEGATIVO',
                    productId: prod.id,
                    stock: prod.stock,
                    severity: 'CRITICAL',
                    message: `Producto "${prod.name}": Stock negativo (${prod.stock})`
                });
            }
        }
        
        // ════════════════════════════════════════
        // 5. CÓDIGOS DUPLICADOS
        // ════════════════════════════════════════
        const shortCodesMap = {};
        const barcodesMap = {};
        
        for (const prod of products) {
            if (prod.shortCode) {
                shortCodesMap[prod.shortCode] = (shortCodesMap[prod.shortCode] || 0) + 1;
            }
            if (prod.barcode) {
                barcodesMap[prod.barcode] = (barcodesMap[prod.barcode] || 0) + 1;
            }
        }
        
        Object.entries(shortCodesMap).forEach(([code, count]) => {
            if (count > 1) {
                issues.push({
                    type: 'SHORTCODE_DUPLICADO',
                    code,
                    count,
                    severity: 'HIGH',
                    message: `Código corto ${code} duplicado (${count} veces)`
                });
            }
        });
        
        Object.entries(barcodesMap).forEach(([code, count]) => {
            if (count > 1) {
                issues.push({
                    type: 'BARCODE_DUPLICADO',
                    code,
                    count,
                    severity: 'HIGH',
                    message: `Código de barras ${code} duplicado (${count} veces)`
                });
            }
        });
        
        // ════════════════════════════════════════
        // 6. GASTOS INVÁLIDOS
        // ════════════════════════════════════════
        const expenses = await db.expenses.toArray();
        const categories = await db.expenseCategories.toArray();
        const categoryIds = new Set(categories.map(c => c.id));
        
        for (const exp of expenses) {
            if (exp.amount <= 0) {
                issues.push({
                    type: 'GASTO_MONTO_INVALIDO',
                    expenseId: exp.id,
                    amount: exp.amount,
                    severity: 'MEDIUM',
                    message: `Gasto #${exp.id}: Monto inválido (${exp.amount})`
                });
            }
            
            if (exp.categoryId && !categoryIds.has(exp.categoryId)) {
                issues.push({
                    type: 'GASTO_CATEGORIA_INEXISTENTE',
                    expenseId: exp.id,
                    categoryId: exp.categoryId,
                    severity: 'MEDIUM',
                    message: `Gasto #${exp.id}: Categoría #${exp.categoryId} no existe`
                });
            }
        }
        
    } catch (error) {
        issues.push({
            type: 'CHECK_ERROR',
            error: error.message,
            severity: 'CRITICAL',
            message: `Error durante validación: ${error.message}`
        });
    }
    
    return issues;
}

/**
 * Resumen de integridad para reportes
 */
export async function getIntegritySummary() {
    const issues = await checkDataIntegrity();
    
    const bySeverity = {
        CRITICAL: issues.filter(i => i.severity === 'CRITICAL').length,
        HIGH: issues.filter(i => i.severity === 'HIGH').length,
        MEDIUM: issues.filter(i => i.severity === 'MEDIUM').length,
        LOW: issues.filter(i => i.severity === 'LOW').length,
    };
    
    return {
        totalIssues: issues.length,
        bySeverity,
        status: issues.length === 0 ? 'OK' : 'PROBLEMAS',
        lastChecked: new Date().toISOString(),
        details: issues
    };
}
```

#### PASO 2: Crear Componente de Visualización

```javascript
// Nuevo archivo: src/components/DataIntegrity.jsx

import React from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, checkDataIntegrity, getIntegritySummary } from '../db';
import { AlertTriangle, CheckCircle, Shield, RotateCcw } from 'lucide-react';

export default function DataIntegrity() {
    const [issues, setIssues] = React.useState([]);
    const [checking, setChecking] = React.useState(false);
    const [summary, setSummary] = React.useState(null);
    
    const handleCheck = async () => {
        setChecking(true);
        try {
            const newIssues = await checkDataIntegrity();
            setIssues(newIssues);
            
            const sum = await getIntegritySummary();
            setSummary(sum);
        } finally {
            setChecking(false);
        }
    };
    
    React.useEffect(() => {
        handleCheck();  // Ejecutar al cargar
        const interval = setInterval(handleCheck, 3600000);  // Cada hora
        return () => clearInterval(interval);
    }, []);
    
    if (!summary) return <div>Verificando integridad...</div>;
    
    const colors = {
        CRITICAL: 'red',
        HIGH: 'orange',
        MEDIUM: 'yellow',
        LOW: 'blue'
    };
    
    return (
        <div className="max-w-7xl mx-auto fade-in">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold text-pink-900 flex items-center gap-2">
                    <Shield size={24} /> Auditoría de Integridad
                </h1>
                <button
                    onClick={handleCheck}
                    disabled={checking}
                    className="px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 flex items-center gap-2">
                    <RotateCcw size={16} className={checking ? 'animate-spin' : ''} />
                    {checking ? 'Verificando...' : 'Re-verificar'}
                </button>
            </div>
            
            {/* Resumen */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                {Object.entries(summary.bySeverity).map(([severity, count]) => (
                    <div key={severity} className="fashion-card text-center">
                        <div className={`text-2xl font-bold text-${colors[severity]}-600`}>
                            {count}
                        </div>
                        <div className="text-sm text-pink-600">{severity}</div>
                    </div>
                ))}
            </div>
            
            {/* Estado General */}
            <div className={`fashion-card p-6 mb-6 border-2 flex items-center gap-4
                ${summary.status === 'OK' 
                    ? 'border-green-200 bg-green-50' 
                    : 'border-red-200 bg-red-50'}`}>
                {summary.status === 'OK' ? (
                    <CheckCircle size={32} className="text-green-600" />
                ) : (
                    <AlertTriangle size={32} className="text-red-600" />
                )}
                <div>
                    <h2 className={`font-bold text-lg ${summary.status === 'OK' ? 'text-green-800' : 'text-red-800'}`}>
                        {summary.status === 'OK' ? '✅ Base de Datos Íntegra' : '⚠️ Se Encontraron Problemas'}
                    </h2>
                    <p className={summary.status === 'OK' ? 'text-green-600' : 'text-red-600'}>
                        {summary.status === 'OK' 
                            ? 'No hay inconsistencias detectadas'
                            : `${summary.totalIssues} problema(s) encontrado(s)`}
                    </p>
                </div>
            </div>
            
            {/* Detalles */}
            {issues.length > 0 && (
                <div className="fashion-card">
                    <h2 className="font-bold mb-4 text-pink-800">Problemas Detectados</h2>
                    <div className="space-y-3">
                        {issues.map((issue, idx) => (
                            <div key={idx} className={`p-3 rounded-lg border-l-4
                                ${issue.severity === 'CRITICAL' ? 'bg-red-50 border-red-600' :
                                  issue.severity === 'HIGH' ? 'bg-orange-50 border-orange-600' :
                                  issue.severity === 'MEDIUM' ? 'bg-yellow-50 border-yellow-600' :
                                  'bg-blue-50 border-blue-600'}`}>
                                <div className="font-bold text-sm text-gray-800">
                                    {issue.type}
                                </div>
                                <div className="text-sm text-gray-700">
                                    {issue.message}
                                </div>
                                {issue.severity === 'CRITICAL' && (
                                    <div className="text-xs text-red-600 mt-1 font-bold">
                                        ⚠️ REQUIERE ATENCIÓN INMEDIATA
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
```

#### PASO 3: Integrar en App.jsx

```javascript
// En App.jsx, agregar a rutas de admin:

{isAdmin ? (
    <>
        {/* ... rutas existentes ... */}
        <Route path="/integrity" element={<DataIntegrity />} />
    </>
) : ...}

// En Layout.jsx, agregar en menú admin:
const NAV_ADMIN = [
    // ... existentes ...
    { name: 'Auditoría', icon: ShieldAlert, href: '/integrity' },
];
```

---

## PARTE 3: HASH DE CONTRASEÑAS

### Problema Identificado

Las contraseñas se guardan en PLAINTEXT en IndexedDB.

### Solución

#### PASO 1: Instalar Dependencia

```bash
npm install crypto-js
```

#### PASO 2: Crear Utilidad Hash

```javascript
// Nuevo archivo: src/utils/crypto.js

import CryptoJS from 'crypto-js';

const SALT = 'tienda-ropa-2026';  // En producción, usar variable de entorno

export function hashPassword(password) {
    return CryptoJS.PBKDF2(password, SALT, {
        keySize: 256 / 32,
        iterations: 1000
    }).toString();
}

export function verifyPassword(plainPassword, hash) {
    return hashPassword(plainPassword) === hash;
}
```

#### PASO 3: Actualizar Login.jsx

```javascript
// En src/components/Login.jsx

import { hashPassword } from '../utils/crypto';

const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
        const user = await db.users
            .where('username').equals(username.trim().toLowerCase())
            .first();
        
        // ANTES:
        // if (!user || user.password !== password || user.active === false)
        
        // DESPUÉS:
        const passwordHash = hashPassword(password);
        if (!user || user.passwordHash !== passwordHash || user.active === false) {
            setError('Usuario o contraseña incorrectos');
            setLoading(false);
            return;
        }
        
        onLogin({ id: user.id, username: user.username, name: user.name, role: user.role });
    } catch (err) {
        setError('Error de conexión con la base de datos');
    } finally {
        setLoading(false);
    }
};
```

#### PASO 4: Migración de Usuarios Existentes

```javascript
// En seed.js - Actualizar seed data:

import { hashPassword } from '../utils/crypto';

export async function seedUsers() {
    const users = [
        {
            username: 'admin',
            passwordHash: hashPassword('admin123'),  // No guardar plaintext
            role: 'admin',
            name: 'Administrador',
            active: true
        },
        {
            username: 'vendedor1',
            passwordHash: hashPassword('pass123'),
            role: 'vendedor',
            name: 'Vendedor 1',
            active: true
        }
    ];
    
    await db.users.bulkAdd(users);
}
```

#### PASO 5: Crear Script de Migración

```javascript
// En src/db/migrations.js

export async function migratePasswordsToHash() {
    const users = await db.users.toArray();
    
    for (const user of users) {
        if (user.password && !user.passwordHash) {
            // Usuario viejo con contraseña plaintext
            const hash = hashPassword(user.password);
            await db.users.update(user.id, {
                passwordHash: hash,
                password: undefined  // Eliminar campo viejo
            });
            console.log(`✅ Usuario ${user.username} migrado a hash`);
        }
    }
}

// Ejecutar en primera carga (en App.jsx o main.jsx):
React.useEffect(() => {
    migratePasswordsToHash();
}, []);
```

---

## PARTE 4: EXPIRACIÓN AUTOMÁTICA DE RESERVAS

### Problema Identificado

Las reservas no expiran automáticamente; ocupan stock indefinidamente.

### Solución

#### PASO 1: Crear Función de Expiración

```javascript
// En src/db/helpers.js:

/**
 * Marca reservas expiradas automáticamente.
 * Se ejecuta periódicamente o en cierres de caja.
 */
export async function expireOverdueReservations() {
    try {
        const reservations = await db.reservations
            .where('status').equals('pending')
            .toArray();
        
        const now = new Date();
        const expired = [];
        
        for (const res of reservations) {
            const expiryDate = new Date(res.expiryDate);
            if (expiryDate < now) {
                expired.push(res);
                
                // Marcar como expirada
                await db.reservations.update(res.id, {
                    status: 'expired',
                    expiredAt: new Date().toISOString()
                });
            }
        }
        
        if (expired.length > 0) {
            console.log(`⏱️ ${expired.length} reserva(s) expirada(s) marcada(s)`);
        }
        
        return expired;
    } catch (error) {
        console.error('Error expirando reservas:', error);
        return [];
    }
}
```

#### PASO 2: Ejecutar en Cierres de Caja

```javascript
// En CashClose.jsx handleSave():

const handleSave = async () => {
    // ... validaciones ...
    
    // Expirar reservas antes de cerrar
    await expireOverdueReservations();
    
    const data = { ... };
    const id = await db.table('cashClosures').put(data);
    
    // ... resto del código ...
};
```

#### PASO 3: Actualizar Reservations.jsx

```javascript
// Actualizar STATUS_LABEL:
const STATUS_LABEL = {
    pending: { text: 'En Proceso', cls: 'badge-blue' },
    completed: { text: 'Completada', cls: 'badge-green' },
    cancelled: { text: 'Cancelada', cls: 'badge-red' },
    expired: { text: 'Expirada', cls: 'badge-gray' },  // NUEVO
    annulled: { text: 'Anulada', cls: 'badge-orange' }  // NUEVO
};

// Filtros deben excluir expired:
const filtered = reservations.filter(r => {
    if (tab === 'active' && ['pending'].includes(r.status)) return true;
    if (tab === 'history' && !['pending'].includes(r.status)) return true;
    return false;
});
```

#### PASO 4: useAvailableStock actualizado

```javascript
// En src/hooks/useAvailableStock.js:

export function useAvailableStock() {
    const reservations = useLiveQuery(
        () => db.reservations.where('status').anyOf(['pending']).toArray(),  // Excluir expiradas
        []
    );
    
    return React.useMemo(() => {
        const map = {};
        (reservations || []).forEach(r => {
            // No contar expiradas
            if (r.status !== 'expired') {
                map[r.productId] = (map[r.productId] || 0) + 1;
            }
        });
        return map;
    }, [reservations]);
}
```

---

## CHECKLIST DE IMPLEMENTACIÓN

### Fase 1: Crítico (Semana 1)
- [ ] Auditoría de cierres (sección 1)
  - [ ] Schema v16
  - [ ] updateCashClosureWithAudit()
  - [ ] Modificar syncClosureIfDateExists()
  - [ ] Componente CashClosureAudit.jsx
- [ ] Hash de contraseñas (sección 3)
  - [ ] Instalar crypto-js
  - [ ] Crear crypto.js
  - [ ] Actualizar Login.jsx
  - [ ] Script de migración

### Fase 2: Importante (Semana 2)
- [ ] Validación de integridad (sección 2)
  - [ ] checkDataIntegrity()
  - [ ] getIntegritySummary()
  - [ ] Componente DataIntegrity.jsx
  - [ ] Integrar en App.jsx
- [ ] Expiración de reservas (sección 4)
  - [ ] expireOverdueReservations()
  - [ ] Llamadas en CashClose
  - [ ] Actualizar STATUS_LABEL
  - [ ] useAvailableStock

### Fase 3: Mejoras (Semana 3)
- [ ] Testing completo de integridad
- [ ] Documentación de auditoría
- [ ] Capacitación del equipo
- [ ] Backup/Restore con validación

---

## TESTING

### Unit Tests Recomendados

```javascript
// tests/helpers.test.js

describe('updateCashClosureWithAudit', () => {
    test('Registra cambios correctamente', async () => {
        // Setup
        const closure = await db.cashClosures.add({ date: '2026-03-25', ... });
        
        // Act
        await updateCashClosureWithAudit(closure.id, 
            { totalSales: 500 },
            'admin1',
            'TEST'
        );
        
        // Assert
        const history = await db.cashClosureHistory
            .where('closureId').equals(closure.id).toArray();
        expect(history.length).toBe(1);
        expect(history[0].changes.totalSales).toBeDefined();
    });
});

describe('checkDataIntegrity', () => {
    test('Detecta venta sin items', async () => {
        await db.sales.add({ id: 999, date: new Date().toISOString(), items: [] });
        const issues = await checkDataIntegrity();
        const issue = issues.find(i => i.type === 'VENTA_SIN_ITEMS');
        expect(issue).toBeDefined();
    });
});
```

---

**Total Estimated Implementation Time**: 3 semanas  
**Risk Reduction**: ~85%  
**Complexity**: Medium

