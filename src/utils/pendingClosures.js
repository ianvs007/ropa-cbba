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
export function findPendingClosureDates({ sales = [], payments = [], closures = [], openings = [], today }) {
    if (!today) return [];

    const dayOf = (r) => (r?.date || '').slice(0, 10);

    // Cierres efectivos: por fecha+usuario y por openingId
    const closedDayUser = new Set();
    const closedOpeningIds = new Set();
    closures.forEach(c => {
        if (!c.closedAt) return;
        const d = dayOf(c);
        if (d) closedDayUser.add(`${d}|${c.userId}`);
        if (c.openingId != null) closedOpeningIds.add(c.openingId);
    });

    const pending = new Set();

    // Movimientos de caja sin cierre del usuario que los generó
    sales.forEach(s => {
        if (s.status === 'annulled') return;
        const d = dayOf(s);
        if (d && d < today && !closedDayUser.has(`${d}|${s.sellerId}`)) pending.add(d);
    });
    payments.forEach(p => {
        if (p.status === 'annulled') return;
        const d = dayOf(p);
        if (d && d < today && !closedDayUser.has(`${d}|${p.userId}`)) pending.add(d);
    });

    // Aperturas sin cierre correspondiente
    openings.forEach(o => {
        const d = dayOf(o);
        if (!d || d >= today) return;
        if (!closedOpeningIds.has(o.id) && !closedDayUser.has(`${d}|${o.userId}`)) pending.add(d);
    });

    return [...pending].sort();
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
