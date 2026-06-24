import { db } from './schema';

/**
 * 📋 AUDIT — Funciones de Auditoría e Integridad de Datos
 * Registra cambios críticos y valida consistencia de datos
 */

/**
 * Registra un cambio importante en cierre de caja para auditoría
 * @param {number} closureId - ID del cierre de caja
 * @param {Object} changes - Objeto con los campos que cambiaron
 * @param {string} changedBy - Usuario que hizo el cambio
 */
export async function recordCashClosureChange(closureId, changes, changedBy) {
    try {
        const closure = await db.cashClosures.get(closureId);
        if (!closure) throw new Error(`Cierre de caja #${closureId} no encontrado`);

        await db.cashClosureHistory.add({
            closureId,
            date: closure.date,
            changedBy,
            changedAt: new Date().toISOString(),
            changeType: Object.keys(changes)[0], // El campo principal que cambió
            changes: changes, // Todos los cambios
            beforeValues: {
                totalSales: closure.totalSales,
                totalExpenses: closure.totalExpenses,
                cashOnHand: closure.cashOnHand,
                netIncome: closure.netIncome,
            },
        });


    } catch (err) {
        console.error('Error al registrar cambio en auditoría:', err);
        throw err;
    }
}

/**
 * Obtiene el historial completo de cambios para un cierre de caja
 * @param {number} closureId - ID del cierre de caja
 */
export async function getCashClosureAuditTrail(closureId) {
    try {
        const history = await db.cashClosureHistory
            .where('closureId')
            .equals(closureId)
            .toArray();
        
        return history.sort((a, b) => new Date(a.changedAt) - new Date(b.changedAt));
    } catch (err) {
        console.error('Error al obtener historial de auditoría:', err);
        return [];
    }
}

/**
 * Valida la integridad de los datos del sistema
 * Retorna array de inconsistencias encontradas
 */
export async function checkDataIntegrity() {
    const issues = [];

    try {
        const [sales, resPayments, reservations, products, kardex, cashClosures] = await Promise.all([
            db.sales.toArray(),
            db.reservationPayments.toArray(),
            db.reservations.toArray(),
            db.products.toArray(),
            db.kardex.toArray(),
            db.cashClosures.toArray(),
        ]);


        // ── VALIDACIÓN 1: Ventas sin items ──
        const salesWithoutItems = sales.filter(s => !s.items || s.items.length === 0);
        if (salesWithoutItems.length > 0) {
            issues.push({
                severity: 'warning',
                type: 'VENTAS_SIN_ITEMS',
                count: salesWithoutItems.length,
                message: `${salesWithoutItems.length} venta(s) sin items registrados`,
                ids: salesWithoutItems.map(s => s.id),
            });
        }

        // ── VALIDACIÓN 2: Abonos de reserva sin reserva padre ──
        const reservationIds = new Set(reservations.map(r => r.id));
        const orphanPayments = resPayments.filter(p => !reservationIds.has(p.reservationId));
        if (orphanPayments.length > 0) {
            issues.push({
                severity: 'critical',
                type: 'PAGOS_HUERFANOS',
                count: orphanPayments.length,
                message: `${orphanPayments.length} pago(s) sin reserva padre`,
                ids: orphanPayments.map(p => p.id),
            });
        }

        // ── VALIDACIÓN 3: Stock inconsistente (negativo) ──
        const negativeStock = products.filter(p => p.stock < 0);
        if (negativeStock.length > 0) {
            issues.push({
                severity: 'critical',
                type: 'STOCK_NEGATIVO',
                count: negativeStock.length,
                message: `${negativeStock.length} producto(s) con stock negativo`,
                ids: negativeStock.map(p => p.id),
                details: negativeStock.map(p => ({ id: p.id, name: p.name, stock: p.stock })),
            });
        }

        // ── VALIDACIÓN 4: Reservas sin abonos (sin estado de entrega) ──
        const reservasActivasSinPagos = reservations.filter(r => 
            r.status === 'pending' && 
            !resPayments.some(p => p.reservationId === r.id && p.status !== 'annulled')
        );
        if (reservasActivasSinPagos.length > 0) {
            issues.push({
                severity: 'info',
                type: 'RESERVAS_SIN_PAGOS',
                count: reservasActivasSinPagos.length,
                message: `${reservasActivasSinPagos.length} reserva(s) pendiente(s) sin abonos registrados`,
                ids: reservasActivasSinPagos.map(r => r.id),
            });
        }

        // ── VALIDACIÓN 5: Cierres de caja desincronizados ──
        // Filtrar reservas activas para considerar sus abonos
        const activeResIdsSet = new Set(
            reservations.filter(r => r.status !== 'cancelled' && r.status !== 'annulled').map(r => r.id)
        );

        for (const closure of cashClosures) {
            // Ventas directas del día (excluyendo tipo 'reserva' para no contar doble)
            const daySalesDirect = sales
                .filter(s => s.date?.startsWith(closure.date) && s.status !== 'annulled' && s.paymentMethod !== 'reserva')
                .reduce((sum, s) => sum + (s.total || 0), 0);

            // Abonos de reserva del día (solo de reservas activas y no anulados)
            const dayResPayments = resPayments
                .filter(p => p.date?.startsWith(closure.date) && p.status !== 'annulled' && activeResIdsSet.has(p.reservationId))
                .reduce((sum, p) => sum + (p.amount || 0), 0);

            const expectedTotal = daySalesDirect + dayResPayments;

            if (Math.abs(expectedTotal - (closure.totalSales || 0)) > 0.01) {
                issues.push({
                    severity: 'warning',
                    type: 'CIERRE_DESINCRONIZADO',
                    closureDate: closure.date,
                    expectedSales: expectedTotal,
                    actualSales: closure.totalSales,
                    message: `Cierre del ${closure.date} desincronizado (esperado: ${expectedTotal.toFixed(2)}, registrado: ${(closure.totalSales || 0).toFixed(2)})`,
                });
                break; // Solo reportar el primero para no saturar
            }
        }

        // ── VALIDACIÓN 6: Códigos cortos duplicados ──
        const allShortCodes = products.map(p => p.shortCode).filter(Boolean);
        const duplicates = allShortCodes.filter((v, i) => allShortCodes.indexOf(v) !== i);
        if (duplicates.length > 0) {
            issues.push({
                severity: 'critical',
                type: 'CODIGOS_DUPLICADOS',
                count: duplicates.length,
                codes: [...new Set(duplicates)],
                message: `${duplicates.length} código(s) corto(s) duplicados encontrados`,
            });
        }

        // ── VALIDACIÓN 7: Productos sin categoría ──
        const productsNoCat = products.filter(p => !p.category || p.category.trim() === '');
        if (productsNoCat.length > 0) {
            issues.push({
                severity: 'warning',
                type: 'PRODUCTOS_SIN_CATEGORIA',
                count: productsNoCat.length,
                message: `${productsNoCat.length} producto(s) sin categoría asignada`,
                ids: productsNoCat.map(p => p.id),
            });
        }


        return issues;
    } catch (err) {
        console.error('Error durante validación de integridad:', err);
        return [{
            severity: 'critical',
            type: 'VALIDATION_ERROR',
            message: `Error en validación: ${err.message}`,
        }];
    }
}

/**
 * Corrige automáticamente ciertos problemas de integridad
 * NOTA: Usar con cuidado, mejor hacer backup antes
 */
export async function automaticcorrectDataIntegrity() {
    const results = [];

    try {
        const issues = await checkDataIntegrity();
        const criticalIssues = issues.filter(i => i.severity === 'critical');

        // ── FIX 1: Corregir stock negativo a 0 ──
        const negStockIssues = issues.filter(i => i.type === 'STOCK_NEGATIVO');
        if (negStockIssues.length > 0) {
            for (const issue of negStockIssues) {
                for (const prodId of issue.ids) {
                    await db.products.update(prodId, { stock: 0 });
                }
            }
            results.push({
                action: 'FIX_NEGATIVE_STOCK',
                count: negStockIssues[0]?.ids?.length || 0,
                message: 'Stock negativo corregido a 0',
            });
        }

        // ── FIX 2: Limpiar pagos huérfanos ──
        const orphanIssues = issues.filter(i => i.type === 'PAGOS_HUERFANOS');
        if (orphanIssues.length > 0) {
            const [resPayments, reservations] = await Promise.all([
                db.reservationPayments.toArray(),
                db.reservations.toArray(),
            ]);

            const reservationIds = new Set(reservations.map(r => r.id));
            const orphanPaymentIds = resPayments
                .filter(p => !reservationIds.has(p.reservationId))
                .map(p => p.id);

            for (const payId of orphanPaymentIds) {
                await db.reservationPayments.delete(payId);
            }

            results.push({
                action: 'DELETE_ORPHAN_PAYMENTS',
                count: orphanPaymentIds.length,
                message: 'Pagos huérfanos eliminados',
            });
        }


        return results;
    } catch (err) {
        console.error('Error al intentar corregir integridad:', err);
        return [{
            action: 'ERROR',
            message: `No se pudieron aplicar correcciones: ${err.message}`,
        }];
    }
}

/**
 * Obtiene estadísticas de auditoría para dashboard
 */
export async function getAuditStats(daysBack = 30) {
    try {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysBack);

        const [history, closures] = await Promise.all([
            db.cashClosureHistory.toArray(),
            db.cashClosures.toArray(),
        ]);

        const recentHistory = history.filter(h => new Date(h.changedAt) > cutoffDate);
        const changedClosures = new Set(recentHistory.map(h => h.closureId));

        return {
            totalChanges: recentHistory.length,
            closuresModified: changedClosures.size,
            changesByUser: recentHistory.reduce((acc, h) => {
                acc[h.changedBy] = (acc[h.changedBy] || 0) + 1;
                return acc;
            }, {}),
            recentChanges: recentHistory.slice(-10).reverse(),
        };
    } catch (err) {
        console.error('Error al obtener estadísticas de auditoría:', err);
        return { error: err.message };
    }
}
