/**
 * 🛠️ REGULARIZACIÓN MASIVA DE CIERRES DE CAJA — ejecutar en la consola (F12)
 * con la app abierta en el entorno que tiene la BD a reparar.
 *
 * QUÉ HACE:
 *  - Detecta TODOS los días pendientes de cierre (SIN el límite de 60 días de la app),
 *    replicando exactamente la lógica de findPendingClosureDates.
 *  - Para cada día pendiente:
 *      • Si ya existe un cierre cerrado ese día → lo PROMUEVE a retroactivo y
 *        recalcula sus totales a nivel día completo (todos los usuarios).
 *      • Si no existe cierre → CREA un cierre retroactivo con los totales reales
 *        del día (efectivo/QR, ventas, abonos, gastos), cuadrado (diferencia 0).
 *  - Registra cada cambio en cashClosureHistory (auditoría), igual que la app.
 *
 * MODO DE USO (2 pasadas):
 *  1. Pega este script tal cual → corre en DRY RUN: solo MUESTRA lo que haría.
 *  2. Si el plan se ve bien, cambia DRY_RUN a false (línea de abajo) y vuelve a pegar.
 */
const DRY_RUN = false; // ← cambiar a false para EJECUTAR los cambios

(async () => {
    const DB_NAME = 'TiendaRopa_Database';
    const today = new Date().toLocaleDateString('sv'); // YYYY-MM-DD local
    const dayOf = (r) => (r?.date || '').slice(0, 10);

    const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    const readAll = (name) => new Promise((resolve, reject) => {
        if (!db.objectStoreNames.contains(name)) return resolve([]);
        const req = db.transaction(name, 'readonly').objectStore(name).getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    const [sales, payments, expenses, closures, openings, users, reservations] = await Promise.all([
        readAll('sales'), readAll('reservationPayments'), readAll('expenses'),
        readAll('cashClosures'), readAll('cashOpenings'), readAll('users'), readAll('reservations'),
    ]);

    // ── 1. Detectar pendientes (réplica de findPendingClosureDates, sin ventana) ──
    const closedDayUser = new Set(), closedOpeningIds = new Set(), closedDates = new Set();
    closures.forEach(c => {
        if (!c.closedAt) return;
        const d = dayOf(c);
        if (d) closedDayUser.add(`${d}|${c.userId}`);
        if (d && c.retroactive === true) closedDates.add(d);
        if (c.openingId != null) closedOpeningIds.add(c.openingId);
    });

    const pending = new Set();
    sales.forEach(s => {
        if (s.status === 'annulled') return;
        const d = dayOf(s);
        if (d && d < today && !closedDates.has(d) && !closedDayUser.has(`${d}|${s.sellerId}`)) pending.add(d);
    });
    payments.forEach(p => {
        if (p.status === 'annulled') return;
        const d = dayOf(p);
        if (d && d < today && !closedDates.has(d) && !closedDayUser.has(`${d}|${p.userId}`)) pending.add(d);
    });
    openings.forEach(o => {
        const d = dayOf(o);
        if (!d || d >= today) return;
        if (!closedOpeningIds.has(o.id) && !closedDates.has(d) && !closedDayUser.has(`${d}|${o.userId}`)) pending.add(d);
    });

    const pendingDates = [...pending].sort();
    console.log(`%c[regularización] Días pendientes detectados: ${pendingDates.length}`, 'font-weight:bold');
    console.log(pendingDates.join(', ') || '(ninguno)');
    if (pendingDates.length === 0) { db.close(); return; }

    // ── 2. Calcular totales por día (réplica de calculateClosureData, allUsers) ──
    const activeResIds = new Set(
        reservations.filter(r => r && r.status !== 'cancelled' && r.status !== 'annulled').map(r => r.id)
    );
    const calcDay = (date) => {
        const fSales = sales.filter(s => dayOf(s) === date && s.status !== 'annulled');
        const fRes = payments.filter(p =>
            dayOf(p) === date && p.status !== 'annulled' && activeResIds.has(p.reservationId));
        const fExp = expenses.filter(e => dayOf(e) === date && (!e.status || e.status !== 'annulled'));

        const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);
        const cashSales = sum(fSales.filter(s => s.paymentMethod === 'efectivo'), s => s.total || 0);
        const cashReservations = sum(fRes.filter(p => p.paymentMethod === 'efectivo'), p => p.amount || 0);
        const qrSales = sum(fSales.filter(s => s.paymentMethod === 'qr'), s => s.total || 0);
        const qrReservations = sum(fRes.filter(p => p.paymentMethod === 'qr'), p => p.amount || 0);
        const totalSales = sum(fSales.filter(s => s.paymentMethod !== 'reserva'), s => s.total || 0)
                         + sum(fRes, p => p.amount || 0);
        const totalExpenses = sum(fExp, e => e.amount || 0);
        const cashExpenses = sum(fExp.filter(e => e.paymentMethod === 'efectivo'), e => e.amount || 0);
        return {
            totalSales, totalExpenses, cashExpenses, cashSales, cashReservations,
            qrSales, qrReservations,
            totalCashIn: cashSales + cashReservations,
            totalQrIn: qrSales + qrReservations,
            netIncome: totalSales - totalExpenses,
            salesCount: fSales.length,
            reservationPaymentsCount: fRes.length,
            transactionCount: fSales.length + fRes.length,
            expensesCount: fExp.length,
            itemsSold: sum(fSales, s => (s.items || []).reduce((a, i) => a + i.qty, 0)),
        };
    };

    // ── 3. Plan por día ──
    const sellerUsers = users.filter(u => u.role !== 'admin');
    const plan = pendingDates.map(date => {
        const totals = calcDay(date);
        const dayClosures = closures.filter(c => dayOf(c) === date && c.closedAt);
        if (dayClosures.length > 0) {
            // Promover el cierre principal (el de mayor totalSales) a retroactivo
            const main = dayClosures.sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0))[0];
            const expected = (main.cashStart || 0) + totals.totalCashIn - totals.cashExpenses;
            return {
                action: 'PROMOVER', date, closureId: main.id, userId: main.userId,
                update: {
                    ...totals, retroactive: true,
                    cashDifference: (main.cashOnHand || 0) - expected,
                    notes: ((main.notes || '').includes('CIERRE RETROACTIVO') ? main.notes
                        : ('CIERRE RETROACTIVO — regularización masiva' + (main.notes ? ' | ' + main.notes : ''))),
                },
            };
        }
        // Crear cierre nuevo: atribuir al vendedor con más ventas ese día que aún exista
        const countBy = {};
        sales.filter(s => dayOf(s) === date && s.status !== 'annulled')
            .forEach(s => { countBy[s.sellerId] = (countBy[s.sellerId] || 0) + 1; });
        const ranked = Object.entries(countBy).sort((a, b) => b[1] - a[1]).map(([id]) => Number(id));
        const owner = ranked.find(id => sellerUsers.some(u => u.id === id)) ?? sellerUsers[0]?.id ?? users[0]?.id;
        const opening = openings.find(o => dayOf(o) === date && o.userId === owner);
        const cashStart = opening?.cashStart || 0;
        const expected = cashStart + totals.totalCashIn - totals.cashExpenses;
        return {
            action: 'CREAR', date, userId: owner,
            insert: {
                date, userId: owner,
                username: users.find(u => u.id === owner)?.username,
                openingId: opening?.id || undefined,
                cashStart, ...totals,
                cashOnHand: expected, cashDifference: 0,
                notes: 'CIERRE RETROACTIVO — regularización masiva',
                retroactive: true,
                closedBy: 'regularización masiva (consola)',
                closedAt: new Date().toISOString(),
            },
        };
    });

    console.table(plan.map(p => ({
        acción: p.action, fecha: p.date, cierre: p.closureId || '(nuevo)', usuario: p.userId,
        ventas: (p.update || p.insert).totalSales, esperadoCaja: ((p.update || p.insert).totalCashIn - (p.update || p.insert).cashExpenses).toFixed(2),
    })));

    if (DRY_RUN) {
        console.log('%c[regularización] DRY RUN — no se modificó nada. Cambia DRY_RUN a false y vuelve a pegar para ejecutar.', 'color:orange;font-weight:bold');
        db.close();
        return;
    }

    // ── 4. Ejecutar en una transacción ──
    const storeNames = ['cashClosures', 'cashClosureHistory'];
    const tx = db.transaction(storeNames, 'readwrite');
    const stClosures = tx.objectStore('cashClosures');
    const stHistory = tx.objectStore('cashClosureHistory');
    const now = new Date().toISOString();

    for (const p of plan) {
        if (p.action === 'PROMOVER') {
            const current = closures.find(c => c.id === p.closureId);
            stClosures.put({ ...current, ...p.update });
            stHistory.add({
                closureId: p.closureId, date: p.date,
                changedBy: 'regularización masiva (consola)', changedAt: now,
                changeType: 'retroactive',
                changes: { retroactive: true, ...p.update },
                beforeValues: {
                    totalSales: current.totalSales, totalExpenses: current.totalExpenses,
                    cashOnHand: current.cashOnHand, netIncome: current.netIncome,
                },
            });
        } else {
            const req = stClosures.add(p.insert);
            req.onsuccess = () => {
                stHistory.add({
                    closureId: req.result, date: p.date,
                    changedBy: 'regularización masiva (consola)', changedAt: now,
                    changeType: 'retroactive',
                    changes: { created: true, ...p.insert },
                    beforeValues: {},
                });
            };
        }
    }

    await new Promise((resolve, reject) => {
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
    db.close();

    console.log(`%c[regularización] ✅ Listo: ${plan.length} día(s) regularizados. Recarga la app (F5) y verifica que el banner de pendientes desapareció.`, 'color:green;font-weight:bold');
})().catch(e => console.error('[regularización] Error:', e));
