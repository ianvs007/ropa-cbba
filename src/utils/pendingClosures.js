/**
 * 💰 Detección de cierres de caja pendientes.
 *
 * Un día (anterior a hoy) está pendiente si:
 *  - tiene movimientos de caja (ventas y/o abonos de reserva no anulados) de un
 *    usuario que NO registró cierre en cashClosures para esa fecha, o
 *  - tiene una apertura en cashOpenings sin cierre correspondiente (por
 *    openingId, con fallback a fecha+usuario para cierres antiguos sin openingId).
 *
 * El día en curso (today) NUNCA cuenta como pendiente.
 * Los cierres solo valen si están efectivamente cerrados (closedAt).
 *
 * Función pura: recibe los arrays ya acotados (p. ej. últimos 60 días) y
 * devuelve las fechas pendientes YYYY-MM-DD ordenadas, la más antigua primero.
 *
 * @param {Object} params
 * @param {Array} params.sales     Ventas ({ date, sellerId, status })
 * @param {Array} params.payments  Abonos de reserva ({ date, userId, status })
 * @param {Array} params.closures  Cierres ({ date, userId, closedAt, openingId })
 * @param {Array} params.openings  Aperturas ({ id, date, userId })
 * @param {string} params.today    Fecha local de hoy YYYY-MM-DD (de useSecureDate)
 * @returns {string[]} Fechas pendientes ordenadas ascendente
 */
/**
 * Determina si una venta afecta la caja física del turno.
 * Las ventas en línea (sincronizadas de la web), entregas de reserva sin cobro
 * directo o marcadas con excludeFromCash no entran al arqueo de caja.
 */
export function isCashRegisterSale(sale) {
    if (!sale || sale.status === 'annulled') return false;
    if (sale.excludeFromCash) return false;
    if (sale.paymentMethod === 'en_linea' || sale.paymentMethod === 'reserva') return false;
    return true;
}

export function findPendingClosureDates({ sales = [], payments = [], closures = [], openings = [], today }) {
    if (!today) return [];

    const dayOf = (r) => (r?.date || '').slice(0, 10);

    // Cierres efectivos: por fecha+usuario, por openingId y por día completo
    const closedDayUser = new Set();
    const closedOpeningIds = new Set();
    // Días regularizados con cierre RETROACTIVO: limpian el día para TODOS los
    // usuarios (los movimientos antiguos pueden ser de un vendedor que ya no
    // existe o no inicia sesión; nadie más podría limpiarlos)
    const closedDates = new Set();
    closures.forEach(c => {
        if (!c.closedAt) return;
        const d = dayOf(c);
        if (d) closedDayUser.add(`${d}|${c.userId}`);
        if (d && c.retroactive === true) closedDates.add(d);
        if (c.openingId != null) closedOpeningIds.add(c.openingId);
    });

    const pending = new Set();

    // Movimientos de caja sin cierre del usuario que los generó
    sales.forEach(s => {
        if (!isCashRegisterSale(s)) return;
        const d = dayOf(s);
        if (d && d < today && !closedDates.has(d) && !closedDayUser.has(`${d}|${s.sellerId}`)) pending.add(d);
    });
    payments.forEach(p => {
        if (p.status === 'annulled') return;
        const d = dayOf(p);
        if (d && d < today && !closedDates.has(d) && !closedDayUser.has(`${d}|${p.userId}`)) pending.add(d);
    });

    // Aperturas sin cierre correspondiente
    openings.forEach(o => {
        const d = dayOf(o);
        if (!d || d >= today) return;
        if (!closedOpeningIds.has(o.id) && !closedDates.has(d) && !closedDayUser.has(`${d}|${o.userId}`)) pending.add(d);
    });

    return [...pending].sort();
}

/**
 * 📊 Resume el detalle de cada día pendiente de cierre (motivo, cantidad de
 * movimientos y efectivo esperado) para mostrar en la UI de forma clara.
 */
export function summarizePendingClosureDays({
    sales = [],
    payments = [],
    expenses = [],
    closures = [],
    openings = [],
    today,
}) {
    const pendingDates = findPendingClosureDates({ sales, payments, closures, openings, today });
    if (pendingDates.length === 0) return [];

    const dayOf = (r) => (r?.date || '').slice(0, 10);
    const pendingSet = new Set(pendingDates);

    const byDate = {};
    for (const d of pendingDates) {
        byDate[d] = {
            date: d,
            salesCount: 0,
            paymentsCount: 0,
            openingsCount: 0,
            totalSales: 0,
            cashIn: 0,
            cashExpenses: 0,
            cashStart: 0,
            expectedCash: 0,
            label: '',
        };
    }

    sales.forEach(s => {
        if (!isCashRegisterSale(s)) return;
        const d = dayOf(s);
        if (!pendingSet.has(d)) return;
        byDate[d].salesCount += 1;
        byDate[d].totalSales += Number(s.total) || 0;
        if ((s.paymentMethod || 'efectivo') === 'efectivo') {
            byDate[d].cashIn += Number(s.total) || 0;
        }
    });

    payments.forEach(p => {
        if (p.status === 'annulled') return;
        const d = dayOf(p);
        if (!pendingSet.has(d)) return;
        byDate[d].paymentsCount += 1;
        byDate[d].totalSales += Number(p.amount) || 0;
        if ((p.paymentMethod || 'efectivo') === 'efectivo') {
            byDate[d].cashIn += Number(p.amount) || 0;
        }
    });

    expenses.forEach(e => {
        if (e.status === 'annulled') return;
        const d = dayOf(e);
        if (!pendingSet.has(d)) return;
        if ((e.paymentMethod || 'efectivo') === 'efectivo') {
            byDate[d].cashExpenses += Number(e.amount) || 0;
        }
    });

    openings.forEach(o => {
        const d = dayOf(o);
        if (!pendingSet.has(d)) return;
        byDate[d].openingsCount += 1;
        if (byDate[d].cashStart === 0 && Number(o.cashStart) > 0) {
            byDate[d].cashStart = Number(o.cashStart) || 0;
        }
    });

    return pendingDates.map(d => {
        const info = byDate[d];
        info.expectedCash = info.cashStart + info.cashIn - info.cashExpenses;
        const movs = info.salesCount + info.paymentsCount;
        if (movs > 0) {
            info.label = `${movs} mov.`;
        } else if (info.openingsCount > 0) {
            info.label = 'Turno sin ventas';
        } else {
            info.label = 'Sin cerrar';
        }
        return info;
    });
}

/**
 * 🛠️ Planificador puro de regularización masiva de días pendientes.
 * Calcula los registros a insertar o promover a retroactivo en `cashClosures`
 * y sus entradas de auditoría para `cashClosureHistory`.
 */
export function planMassRegularization({
    pendingDates = [],
    sales = [],
    payments = [],
    expenses = [],
    closures = [],
    openings = [],
    users = [],
    activeUser = null,
    nowISO = new Date().toISOString(),
}) {
    if (!pendingDates || pendingDates.length === 0) return [];
    const dayOf = (r) => (r?.date || '').slice(0, 10);
    const sum = (arr, fn) => arr.reduce((a, x) => a + fn(x), 0);

    const sellerUsers = users.filter(u => u.role !== 'admin');
    const actorName = activeUser?.name || activeUser?.username || 'Regularización masiva';

    const calcDayTotals = (date) => {
        const fSales = sales.filter(s => dayOf(s) === date && isCashRegisterSale(s));
        const fRes = payments.filter(p => dayOf(p) === date && p.status !== 'annulled');
        const fExp = expenses.filter(e => dayOf(e) === date && (!e.status || e.status !== 'annulled'));

        const cashSales = sum(fSales.filter(s => (s.paymentMethod || 'efectivo') === 'efectivo'), s => Number(s.total) || 0);
        const cashReservations = sum(fRes.filter(p => (p.paymentMethod || 'efectivo') === 'efectivo'), p => Number(p.amount) || 0);
        const qrSales = sum(fSales.filter(s => s.paymentMethod === 'qr'), s => Number(s.total) || 0);
        const qrReservations = sum(fRes.filter(p => p.paymentMethod === 'qr'), p => Number(p.amount) || 0);
        const totalSales = sum(fSales, s => Number(s.total) || 0) + sum(fRes, p => Number(p.amount) || 0);
        const totalExpenses = sum(fExp, e => Number(e.amount) || 0);
        const cashExpenses = sum(fExp.filter(e => (e.paymentMethod || 'efectivo') === 'efectivo'), e => Number(e.amount) || 0);

        return {
            totalSales,
            totalExpenses,
            cashExpenses,
            cashSales,
            cashReservations,
            qrSales,
            qrReservations,
            totalCashIn: cashSales + cashReservations,
            totalQrIn: qrSales + qrReservations,
            netIncome: totalSales - totalExpenses,
            salesCount: fSales.length,
            reservationPaymentsCount: fRes.length,
            transactionCount: fSales.length + fRes.length,
            expensesCount: fExp.length,
            itemsSold: sum(fSales, s => (s.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0)),
        };
    };

    return pendingDates.map(date => {
        const totals = calcDayTotals(date);
        const dayClosures = closures.filter(c => dayOf(c) === date && c.closedAt);

        if (dayClosures.length > 0) {
            const main = [...dayClosures].sort((a, b) => (b.totalSales || 0) - (a.totalSales || 0))[0];
            const expected = (Number(main.cashStart) || 0) + totals.totalCashIn - totals.cashExpenses;
            const cashOnHand = main.cashOnHand != null ? Number(main.cashOnHand) : expected;
            const existingNotes = String(main.notes || '').trim();
            const notes = existingNotes.includes('CIERRE RETROACTIVO')
                ? existingNotes
                : ('CIERRE RETROACTIVO — regularización masiva' + (existingNotes ? ' | ' + existingNotes : ''));

            return {
                action: 'PROMOVER',
                date,
                closureId: main.id,
                userId: main.userId,
                update: {
                    ...totals,
                    cashOnHand,
                    cashDifference: cashOnHand - expected,
                    retroactive: true,
                    notes,
                },
                beforeValues: {
                    totalSales: main.totalSales,
                    totalExpenses: main.totalExpenses,
                    cashOnHand: main.cashOnHand,
                    netIncome: main.netIncome,
                },
                changedBy: actorName,
                changedAt: nowISO,
            };
        }

        // Atribuir al vendedor con más ventas ese día, o al usuario activo, o al primer vendedor
        const countBy = {};
        sales.filter(s => dayOf(s) === date && isCashRegisterSale(s))
            .forEach(s => {
                if (s.sellerId != null) countBy[s.sellerId] = (countBy[s.sellerId] || 0) + 1;
            });
        const ranked = Object.entries(countBy).sort((a, b) => b[1] - a[1]).map(([id]) => Number(id));
        const owner = ranked.find(id => sellerUsers.some(u => u.id === id))
            ?? (activeUser?.role !== 'admin' && activeUser?.id ? activeUser.id : null)
            ?? sellerUsers[0]?.id
            ?? users[0]?.id
            ?? activeUser?.id
            ?? 1;

        const opening = openings.find(o => dayOf(o) === date && o.userId === owner)
            || openings.find(o => dayOf(o) === date);
        const cashStart = Number(opening?.cashStart) || 0;
        const expected = cashStart + totals.totalCashIn - totals.cashExpenses;
        const ownerUser = users.find(u => u.id === owner);

        return {
            action: 'CREAR',
            date,
            userId: owner,
            insert: {
                date,
                userId: owner,
                username: ownerUser?.username || activeUser?.username || 'cajera',
                openingId: opening?.id || undefined,
                cashStart,
                ...totals,
                cashOnHand: expected,
                cashDifference: 0,
                notes: 'CIERRE RETROACTIVO — regularización masiva',
                retroactive: true,
                closedBy: actorName,
                closedAt: nowISO,
            },
            changedBy: actorName,
            changedAt: nowISO,
        };
    });
}

/**
 * 🔐 Autorización de cierre de caja por fecha.
 *
 * Regla:
 *  - HOY (selectedDate === today)      → permitido, flujo normal (no retroactivo)
 *  - Fecha FUTURA                      → SIEMPRE bloqueada
 *  - Fecha pasada EN pendingDates      → permitida como cierre RETROACTIVO
 *  - Fecha pasada fuera de pendientes  → bloqueada (ya cerrada o sin movimientos)
 *
 * @param {Object} params
 * @param {string} params.selectedDate  Fecha a cerrar YYYY-MM-DD
 * @param {string} params.today         Hoy según useSecureDate (frozenToday)
 * @param {string[]} params.pendingDates Fechas pendientes (de findPendingClosureDates)
 * @returns {{allowed: boolean, retroactive: boolean, reason: string|null}}
 */
export function canCloseCashDate({ selectedDate, today, pendingDates = [] }) {
    if (!selectedDate || !today) {
        return { allowed: false, retroactive: false, reason: 'Fecha no disponible todavía' };
    }
    if (selectedDate === today) {
        return { allowed: true, retroactive: false, reason: null };
    }
    if (selectedDate > today) {
        return { allowed: false, retroactive: false, reason: 'No se puede cerrar caja de una fecha futura' };
    }
    if (pendingDates.includes(selectedDate)) {
        return { allowed: true, retroactive: true, reason: null };
    }
    return {
        allowed: false,
        retroactive: false,
        reason: `El día ${selectedDate} no está pendiente de cierre (ya fue cerrado o no tuvo movimientos)`,
    };
}

export default findPendingClosureDates;
