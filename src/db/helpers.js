import { db } from './schema';

// ==============================================================================
// 🔧 HELPERS — Funciones utilitarias de base de datos
// ==============================================================================

/** 
 * Retorna la fecha actual en formato ISO manteniendo la hora LOCAL.
 * Evita que ventas nocturnas (ej: 9 PM) se registren como el día siguiente en UTC.
 */
export function getLocalISOString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000; // offset en ms
    const localISOTime = (new Date(now.getTime() - offset)).toISOString();
    return localISOTime;
}

/** Genera un código de barras EAN-13 único de 13 dígitos */
let _barcodeCounter = 0;
export function generateBarcode() {
    const prefix = '200';
    const ts = Date.now().toString().slice(-7);
    // Contador cíclico para evitar colisiones en llamadas en el mismo milisegundo
    _barcodeCounter = (_barcodeCounter + 1) % 100;
    const suffix = _barcodeCounter.toString().padStart(2, '0');
    const rawCode = prefix + ts + suffix; // 3 + 7 + 2 = 12 dígitos

    let sum = 0;
    for (let i = 0; i < 12; i++) {
        sum += parseInt(rawCode[i], 10) * (i % 2 === 0 ? 1 : 3);
    }
    const checkDigit = (10 - (sum % 10)) % 10;
    return rawCode + checkDigit;
}

/** Verifica si un código de barras o código corto ya existe en la BD */
export async function barcodeExists(barcode) {
    const p = await db.products.where('barcode').equals(barcode).or('shortCode').equals(barcode).first();
    if (p) return true;
    const u = await db.barcodes.where('barcode').equals(barcode).or('shortCode').equals(barcode).first();
    return !!u;
}

/** Busca un producto por cualquier código asignado (modelo o unidad individual) */
export async function findProductByBarcode(code) {
    const p = await db.products.where('barcode').equals(code).first();
    if (p) return p;
    const unit = await db.barcodes.where('barcode').equals(code).or('shortCode').equals(code).first();
    if (unit) return await db.products.get(unit.productId);
    const short = await db.products.where('shortCode').equals(code).first();
    if (short) return short;
    return null;
}

/** Genera un código de barras único garantizado.
 *  @param {Set} [localExclusions] — set de barcodes ya generados en la misma sesión (para evitar duplicados en loops rápidos)
 */
export async function generateUniqueBarcode(localExclusions) {
    let code;
    let exists = true;
    while (exists) {
        code = generateBarcode();
        exists = (localExclusions && localExclusions.has(code)) || await barcodeExists(code);
    }
    if (localExclusions) localExclusions.add(code);
    return code;
}

/**
 * Genera un código corto único de 5 dígitos (00001 - 99999)
 * Verifica tanto en productos como en unidades individuales.
 */
export async function generateShortCode() {
    const [allProducts, allUnitBarcodes] = await Promise.all([
        db.products.where('shortCode').above('').toArray(),
        db.barcodes.where('shortCode').above('').toArray()
    ]);

    const productCodes = allProducts.map(p => parseInt(p.shortCode, 10));
    const unitCodes = allUnitBarcodes.map(b => parseInt(b.shortCode, 10));
    
    const validCodes = [...productCodes, ...unitCodes]
        .filter(n => !isNaN(n) && n > 0 && n <= 99999);

    if (validCodes.length === 0) return '00001';

    const maxCode = Math.max(...validCodes);
    const newCode = maxCode + 1;
    if (newCode > 99999) throw new Error('Se ha alcanzado el límite de 99,999 códigos cortos');

    return newCode.toString().padStart(5, '0');
}

/** Verifica si un código corto ya existe en productos o unidades */
export async function shortCodeExists(shortCode) {
    const p = await db.products.where('shortCode').equals(shortCode).first();
    if (p) return true;
    const u = await db.barcodes.where('shortCode').equals(shortCode).first();
    return !!u;
}

/**
 * Sanea los códigos cortos de todas las unidades de barcode que no tengan uno asignado.
 * Retorna la cantidad de registros actualizados.
 */
export async function fixMissingShortCodes() {
    const allProducts = await db.products.toArray();
    const allUnitBarcodes = await db.barcodes.toArray();
    
    // Primero, detectar duplicados
    const codeFrequency = new Map();
    for (const unitBarcode of allUnitBarcodes) {
        if (unitBarcode.shortCode) {
            const freq = codeFrequency.get(unitBarcode.shortCode) || 0;
            codeFrequency.set(unitBarcode.shortCode, freq + 1);
        }
    }
    
    // Encontrar códigos duplicados
    const duplicates = [];
    for (const [code, freq] of codeFrequency.entries()) {
        if (freq > 1) {
            duplicates.push({ code, freq });
        }
    }
    
    if (duplicates.length === 0 && allUnitBarcodes.every(b => b.shortCode)) {
        return 0;
    }
    
    const usedCodes = new Set();
    
    // Recopilar códigos usados de productos
    for (const product of allProducts) {
        const code = parseInt(product.shortCode, 10);
        if (!isNaN(code) && code > 0) {
            usedCodes.add(code);
        }
    }
    
    // Recopilar códigos usados de unidades de barcode (solo únicos)
    const barcodesByCode = new Map();
    for (const unitBarcode of allUnitBarcodes) {
        if (unitBarcode.shortCode) {
            const code = parseInt(unitBarcode.shortCode, 10);
            if (!isNaN(code) && code > 0) {
                if (!barcodesByCode.has(code)) {
                    barcodesByCode.set(code, []);
                }
                barcodesByCode.get(code).push(unitBarcode);
                usedCodes.add(code);
            }
        }
    }
    
    let counter = 1;
    let updatedCount = 0;
    
    // Filtrar unidades que necesitan código corto (sin código o duplicado)
    const barcodesToUpdate = [];
    for (const unitBarcode of allUnitBarcodes) {
        if (!unitBarcode.shortCode || isNaN(parseInt(unitBarcode.shortCode, 10))) {
            barcodesToUpdate.push(unitBarcode);
        } else {
            // Verificar si es un duplicado (más de uno con el mismo código)
            const code = parseInt(unitBarcode.shortCode, 10);
            const unitsWithSameCode = barcodesByCode.get(code) || [];
            if (unitsWithSameCode.length > 1) {
                // Mantener solo el primero, los demás necesitan nuevo código
                if (unitsWithSameCode.indexOf(unitBarcode) > 0) {
                    barcodesToUpdate.push(unitBarcode);
                }
            }
        }
    }
    
    // Asignar códigos cortos únicos
    for (const unitBarcode of barcodesToUpdate) {
        while (usedCodes.has(counter)) {
            counter++;
        }
        const newShortCode = counter.toString().padStart(5, '0');
        await db.barcodes.update(unitBarcode.id, { shortCode: newShortCode });
        usedCodes.add(counter);
        counter++;
        updatedCount++;
    }
    
    return updatedCount;
}

/**
 * Genera N códigos de barras únicos para un producto específico.
 * Ahora también asigna un código corto único por unidad.
 */
export async function generateBarcodesForProduct(productId, qty) {
    const generated = [];

    // Obtener TODOS los códigos cortos usados (productos + unidades)
    const allProducts = await db.products.toArray();
    const allUnitBarcodes = await db.barcodes.toArray();

    const usedCodes = new Set();
    
    // Recopilar códigos de productos
    for (const p of allProducts) {
        if (p.shortCode) {
            const code = parseInt(p.shortCode, 10);
            if (!isNaN(code) && code > 0) {
                usedCodes.add(code);
            }
        }
    }
    
    // Recopilar códigos de unidades existentes
    for (const b of allUnitBarcodes) {
        if (b.shortCode) {
            const code = parseInt(b.shortCode, 10);
            if (!isNaN(code) && code > 0) {
                usedCodes.add(code);
            }
        }
    }

    // Pre-generar todos los EAN únicos ANTES de abrir la transacción
    // (generateUniqueBarcode hace lecturas asíncronas que Dexie no permite dentro de tx)
    const preGenerated = [];
    const generatedEANs = new Set(); // evita duplicados dentro del mismo lote
    let counter = 1;
    for (let i = 0; i < qty; i++) {
        const barcode = await generateUniqueBarcode(generatedEANs);
        while (usedCodes.has(counter)) counter++;
        const shortCode = counter.toString().padStart(5, '0');
        usedCodes.add(counter);
        counter++;
        preGenerated.push({ barcode, shortCode });
    }

    // Insertar todos los barcodes en una sola transacción atómica
    // Si falla a mitad, Dexie hace rollback completo → nunca quedan barcodes parciales
    await db.transaction('rw', db.barcodes, async () => {
        const now = getLocalISOString();
        for (const { barcode, shortCode } of preGenerated) {
            await db.barcodes.add({
                productId,
                barcode,
                shortCode,
                used: false,
                createdAt: now,
            });
            generated.push({ barcode, shortCode });
        }
    });

    // Retorna [{barcode, shortCode}] para que los llamadores puedan registrar unitCodes en kardex
    return generated;
}

/** Descuenta stock al realizar una venta (transacción atómica) */
export async function discountStock(items) {
    return db.transaction('rw', db.products, db.kardex, db.barcodes, async () => {
        const unitCodesMap = {};
        for (const item of items) {
            const product = await db.products.get(item.productId);
            if (!product) throw new Error(`Producto ID ${item.productId} no encontrado`);
            if (product.stock < item.qty) throw new Error(`Stock insuficiente para "${product.name}"`);

            await db.products.update(item.productId, { stock: product.stock - item.qty });

            const barcodesToUse = await db.barcodes
                .where('productId').equals(item.productId)
                .and(b => !b.used)
                .limit(item.qty)
                .toArray();

            for (const b of barcodesToUse) {
                await db.barcodes.update(b.id, { used: true });
            }

            const codes = barcodesToUse.map(b => ({ shortCode: b.shortCode || '', barcode: b.barcode || '' }));
            unitCodesMap[item.productId] = codes;

            await db.kardex.add({
                productId: item.productId,
                date: getLocalISOString(),
                type: 'salida',
                qty: item.qty,
                notes: 'Venta',
                balanceAfter: product.stock - item.qty,
                unitCodes: codes,
            });
        }
        return unitCodesMap;
    });
}

/** Exporta toda la base de datos como JSON para backup */
export async function exportDatabase() {
    const [
        products, kardex, sales, expenseCategories, expenses,
        users, settingsRaw, reservations, reservationPayments,
        categories, productNames, productFields, barcodes, brands, colors
    ] = await Promise.all([
        db.products.toArray(),
        db.kardex.toArray(),
        db.sales.toArray(),
        db.expenseCategories.toArray(),
        db.expenses.toArray(),
        db.users.toArray(),
        db.settings.toArray(),
        db.reservations.toArray(),
        db.reservationPayments.toArray(),
        db.categories.toArray(),
        db.productNames.toArray(),
        db.productFields.toArray(),
        db.barcodes.toArray(),
        db.brands.toArray(),
        db.colors.toArray(),
    ]);

    const safeUsers = users.map(u => ({ ...u, password: '***' }));

    return {
        version: 9,
        exportedAt: new Date().toISOString(),
        data: {
            products, kardex, sales, expenseCategories, expenses,
            users: safeUsers, settings: settingsRaw, reservations, reservationPayments,
            categories, productNames, productFields, barcodes, brands, colors,
        },
    };
}

/** Importa un backup JSON a la base de datos */
export async function importDatabase(backupObj) {
    const { data } = backupObj;
    await db.transaction('rw',
        db.products, db.kardex, db.sales,
        db.expenseCategories, db.expenses, db.settings,
        db.reservations, db.reservationPayments, db.categories,
        db.productNames, db.productFields, db.barcodes,
        db.brands, db.colors,
        async () => {
            if (data.products) {
                await db.products.clear();

                const existingShortCodes = data.products
                    .filter(p => p.shortCode)
                    .map(p => parseInt(p.shortCode, 10))
                    .filter(n => !isNaN(n));

                let shortCodeCounter = existingShortCodes.length > 0
                    ? Math.max(...existingShortCodes) + 1
                    : 1;

                const usedShortCodes = new Set(existingShortCodes);

                for (const product of data.products) {
                    const prodData = { ...product };
                    if (!prodData.shortCode) {
                        while (usedShortCodes.has(shortCodeCounter)) shortCodeCounter++;
                        prodData.shortCode = shortCodeCounter.toString().padStart(5, '0');
                        usedShortCodes.add(shortCodeCounter);
                        shortCodeCounter++;
                    } else {
                        const existingCode = parseInt(prodData.shortCode, 10);
                        if (!isNaN(existingCode)) usedShortCodes.add(existingCode);
                    }
                    await db.products.add(prodData);
                }
            }
            if (data.kardex) { await db.kardex.clear(); await db.kardex.bulkAdd(data.kardex); }
            if (data.sales) { await db.sales.clear(); await db.sales.bulkAdd(data.sales); }
            if (data.expenseCategories) { await db.expenseCategories.clear(); await db.expenseCategories.bulkAdd(data.expenseCategories); }
            if (data.expenses) { await db.expenses.clear(); await db.expenses.bulkAdd(data.expenses); }
            if (data.settings) { await db.settings.clear(); await db.settings.bulkPut(data.settings); }
            if (data.reservations) { await db.reservations.clear(); await db.reservations.bulkAdd(data.reservations); }
            if (data.reservationPayments) { await db.reservationPayments.clear(); await db.reservationPayments.bulkAdd(data.reservationPayments); }
            if (data.categories) { await db.categories.clear(); await db.categories.bulkAdd(data.categories); }
            if (data.productNames) { await db.productNames.clear(); await db.productNames.bulkAdd(data.productNames); }
            if (data.productFields) { await db.productFields.clear(); await db.productFields.bulkAdd(data.productFields); }
            if (data.barcodes) { await db.barcodes.clear(); await db.barcodes.bulkAdd(data.barcodes); }
            if (data.brands) { await db.brands.clear(); await db.brands.bulkAdd(data.brands); }
            if (data.colors) { await db.colors.clear(); await db.colors.bulkAdd(data.colors); }
        }
    );
}

/**
 * Reinicia la BD para producción:
 * Borra transacciones pero mantiene productos, usuarios y configuración.
 */
export async function resetForProduction() {
    return db.transaction('rw',
        db.sales, db.expenses, db.kardex,
        db.reservations, db.reservationPayments,
        db.barcodes, db.products,
        db.cashClosures, db.cashClosureHistory, db.securityLogs,
        async () => {
            await Promise.all([
                db.sales.clear(),
                db.expenses.clear(),
                db.kardex.clear(),
                db.reservations.clear(),
                db.reservationPayments.clear(),
                db.barcodes.clear(),
                db.cashClosures.clear(),
                db.cashClosureHistory.clear(),
                db.securityLogs.clear(),
            ]);
            await db.products.toCollection().modify({ stock: 0 });
        }
    );
}

/**
 * Elimina TODA la base de datos IndexedDB y recarga la página.
 * Al recargar, Dexie re-creará la BD vacía y el seed insertará los datos iniciales.
 */
export async function deleteEntireDatabase() {
    await db.delete();
    window.location.reload();
}

/**
 * Calcula todos los totales para un cierre de caja en una fecha específica.
 * @param {string} date - Fecha en formato YYYY-MM-DD
 */
export async function calculateClosureData(date, userId = null, shiftId = null) {
    if (!date) return null;
    try {
        // ── FILTRADO POR USUARIO (Opcional) ──
        let [sales, resPayments, expenses] = await Promise.all([
            db.sales.where('date').startsWith(date).toArray(),
            db.reservationPayments.where('date').startsWith(date).toArray(),
            db.expenses.where('date').startsWith(date).toArray()
        ]);

        // 🚨 BLOQUEO DE SEGURIDAD ABSOLUTO PARA TURNOS 🚨
        if (userId !== null && userId !== undefined && userId !== "") {
            const uidStr = userId.toString();
            sales = (sales || []).filter(s => s.sellerId !== undefined && s.sellerId !== null && s.sellerId.toString() === uidStr);
            resPayments = (resPayments || []).filter(p => p.userId !== undefined && p.userId !== null && p.userId.toString() === uidStr);
            expenses = (expenses || []).filter(e => e.userId !== undefined && e.userId !== null && e.userId.toString() === uidStr);
        } else {
            sales = []; resPayments = []; expenses = [];
        }

        // 🔄 FILTRADO POR TURNO (shiftId) — Multi-turno por día
        // Incluye registros con el shiftId exacto O registros legacy sin shiftId
        // (ventas creadas antes de la funcionalidad multi-turno v20)
        if (shiftId !== null && shiftId !== undefined) {
            // Verificar si hay registros CON este shiftId específico
            const hasExactShift = sales.some(s => s.shiftId === shiftId);
            if (hasExactShift) {
                // Modo estricto: solo registros de este turno
                sales = sales.filter(s => s.shiftId === shiftId);
                resPayments = resPayments.filter(p => p.shiftId === shiftId);
                expenses = expenses.filter(e => e.shiftId === shiftId);
            } else {
                // Fallback: incluir registros sin shiftId (legacy) del mismo usuario/fecha
                sales = sales.filter(s => !s.shiftId || s.shiftId === shiftId);
                resPayments = resPayments.filter(p => !p.shiftId || p.shiftId === shiftId);
                expenses = expenses.filter(e => !e.shiftId || e.shiftId === shiftId);
            }
        }

        // ── CORRECCIÓN: Filtrar ventas anuladas ──
        const filteredSales = (sales || []).filter(s => s.status !== 'annulled');
        
        // ── CORRECCIÓN: Filtrar gastos ──
        const filteredExp = (expenses || []).filter(e => !e.status || e.status !== 'annulled');
        
        // ── OPTIMIZACIÓN: Validar pagos de reserva sin cargar TODAS las reservas ──
        const resIds = Array.from(new Set((resPayments || []).map(p => p.reservationId)));
        const resObjects = await db.reservations.bulkGet(resIds);
        const activeResIds = new Set(resObjects.filter(r => r && r.status !== 'cancelled' && r.status !== 'annulled').map(r => r.id));

        const filteredRes = (resPayments || []).filter(p => 
            p.status !== 'annulled' && 
            activeResIds.has(p.reservationId)
        );

        const allMoneyIn = [
            ...filteredSales.filter(s => s.paymentMethod !== 'reserva').map(s => ({ ...s, tipo: 'VENTA', amount: s.total || 0, method: s.paymentMethod || 'efectivo' })),
            ...filteredRes.map(p => ({ ...p, tipo: 'RESERVA', amount: p.amount || 0, method: p.paymentMethod || 'efectivo' }))
        ];

        const totalSales = allMoneyIn.reduce((s, v) => s + v.amount, 0);

        const cashSales = filteredSales.filter(s => s.paymentMethod === 'efectivo').reduce((s, v) => s + (v.total || 0), 0);
        const cashReservations = filteredRes.filter(p => p.paymentMethod === 'efectivo').reduce((s, v) => s + (v.amount || 0), 0);
        
        const qrSales = filteredSales.filter(v => v.paymentMethod === 'qr').reduce((s, v) => s + (v.total || 0), 0);
        const qrReservations = filteredRes.filter(v => v.paymentMethod === 'qr').reduce((s, v) => s + (v.amount || 0), 0);

        const totalExpenses = filteredExp.reduce((s, v) => s + (v.amount || 0), 0);
        const cashExpenses = filteredExp.filter(e => e.paymentMethod === 'efectivo').reduce((s, v) => s + (v.amount || 0), 0);

        const totalDiscounts = filteredSales.reduce((s, v) => {
            const itemDiscounts = (v.items || []).reduce((a, i) => {
                const original = i.originalPrice ?? i.price;
                const discount = original > i.price ? (original - i.price) * i.qty : 0;
                return a + discount;
            }, 0);
            return s + itemDiscounts;
        }, 0);

        const itemsSold = filteredSales.reduce((s, v) => s + (v.items || []).reduce((a, i) => a + i.qty, 0), 0);

        return {
            date,
            all: allMoneyIn,
            salesCount: filteredSales.length,
            reservationPaymentsCount: filteredRes.length,
            transactionCount: filteredSales.length + filteredRes.length,
            itemsSold,
            totalSales,
            totalExpenses,
            cashExpenses,
            cashSales,
            cashReservations,
            qrSales,
            qrReservations,
            totalCashIn: cashSales + cashReservations,
            totalQrIn: qrSales + qrReservations,
            totalDiscounts,
            netIncome: totalSales - totalExpenses,
            expensesCount: filteredExp.length
        };
    } catch (error) {
        console.error("Error calculating closure data:", error);
        // Retornar objeto vacío compatible para evitar crashes de UI
        return {
            date, all: [], salesCount: 0, reservationPaymentsCount: 0, transactionCount: 0,
            itemsSold: 0, totalSales: 0, totalExpenses: 0,
            cashExpenses: 0, cashSales: 0, cashReservations: 0, qrSales: 0, qrReservations: 0,
            totalCashIn: 0, totalQrIn: 0, totalDiscounts: 0, netIncome: 0, expensesCount: 0,
            error: true
        };
    }
}

/**
 * Sincroniza el registro de cierre de caja si ya existe para la fecha dada.
 * Útil para actualizar totales tras anular ventas o borrar gastos post-cierre.
 */
/** Sincroniza automáticamente un cierre de caja con los datos reales si ya existe */
export async function syncClosureIfDateExists(dateRaw, userId = null, shiftId = null) {
    if (!dateRaw) return;
    const date = dateRaw.split('T')[0];
    
    // Buscar el cierre de este turno específico o del día/usuario
    let existing;
    if (shiftId) {
        existing = await db.table('cashClosures')
            .where('openingId').equals(shiftId)
            .first();
    } else {
        let query = db.table('cashClosures').where('date').equals(date);
        if (userId !== null && userId !== undefined) {
            query = query.filter(c => c.userId && c.userId.toString() === userId.toString());
        } else if (userId === undefined) {
            return;
        }
        existing = await query.first();
    }
    
    if (!existing) return;

    // Validar que el cierre pertenece al usuario que solicita la sincronización
    if (userId !== null && userId !== undefined && existing.userId && existing.userId.toString() !== userId.toString()) return;

    const newData = await calculateClosureData(date, userId, shiftId || existing.openingId);
    
    await db.cashClosures.update(existing.id, {
        totalSales: newData.totalSales,
        totalExpenses: newData.totalExpenses,
        cashExpenses: newData.cashExpenses,
        netIncome: newData.netIncome,
        salesCount: newData.salesCount,
        reservationPaymentsCount: newData.reservationPaymentsCount,
        transactionCount: newData.transactionCount,
        expensesCount: newData.expensesCount,
        itemsSold: newData.itemsSold,
        syncAt: new Date().toISOString()
    });

}
/**
 * Calcula el resumen completo de un mes (Ingresos, Gastos, Utilidad).
 * @param {string} monthKey - Mes en formato YYYY-MM
 */
export async function calculateMonthlySummary(monthKey) {
    const [sales, resPayments, expenses, categories, closures] = await Promise.all([
        db.sales.toArray(),
        db.reservationPayments.toArray(),
        db.expenses.toArray(),
        db.expenseCategories.toArray(),
        db.table('cashClosures').toArray()
    ]);

    // ── ROBUSTEZ: Filtrar pagos de reserva considerando el estado de la reserva padre ──
    const reservations = await db.reservations.toArray();
    const activeResIds = new Set(reservations.filter(r => r.status !== 'cancelled' && r.status !== 'annulled').map(r => r.id));

    const mSales = sales.filter(s => s.date?.startsWith(monthKey) && s.status !== 'annulled');
    const mRes = resPayments.filter(p => 
        p.date?.startsWith(monthKey) && 
        p.status !== 'annulled' && 
        activeResIds.has(p.reservationId)
    );
    const mExp = expenses.filter(e => e.date?.startsWith(monthKey) && (!e.status || e.status !== 'annulled'));
    const mClosures = closures.filter(c => c.date?.startsWith(monthKey));

    // Ingresos
    const totalSalesDirect = mSales.filter(s => s.paymentMethod !== 'reserva').reduce((s, v) => s + (v.total || 0), 0);
    const totalResPayments = mRes.reduce((s, v) => s + (v.amount || 0), 0);
    const totalIncome = totalSalesDirect + totalResPayments;

    // Gastos
    const totalExpenses = mExp.reduce((s, v) => s + (v.amount || 0), 0);
    
    // Desglose de Gastos por Categoría
    const catMap = {};
    categories.forEach(c => catMap[c.id] = c.name);
    
    const expensesByCategory = mExp.reduce((acc, e) => {
        const catName = catMap[e.categoryId] || 'Otros';
        acc[catName] = (acc[catName] || 0) + e.amount;
        return acc;
    }, {});

    // Métricas
    const itemsSold = mSales.reduce((sum, s) => sum + (s.items || []).reduce((a, i) => a + i.qty, 0), 0);

    return {
        monthKey,
        totalSales: totalIncome,
        salesDirect: totalSalesDirect,
        resPayments: totalResPayments,
        totalExpenses,
        expensesByCategory: Object.entries(expensesByCategory).map(([name, value]) => ({ name, value })),
        netProfit: totalIncome - totalExpenses,
        salesCount: mSales.length,
        resCount: mRes.length,
        itemsSold,
        closuresCount: mClosures.length,
        dailyDetails: mClosures.sort((a,b) => a.date.localeCompare(b.date))
    };
}
