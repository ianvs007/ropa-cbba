/**
 * 👥 Agrupación de reservas por cliente y fecha — solo para VISUALIZACIÓN,
 * detalle e impresión consolidada.
 *
 * Regla de negocio: las reservas del mismo solicitante (cliente) creadas el
 * mismo día se muestran como UNA sola tarjeta/grupo. La gestión (abonos,
 * entrega, anulación) sigue siendo por prenda individual — este módulo no
 * toca esa lógica, solo agrupa para mostrar.
 */

const round2 = (n) => Math.round(n * 100) / 100;

/** Normaliza un nombre de cliente para comparar (mayúsculas, sin espacios extra) */
export function normalizeClientName(name) {
    return (name || '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Fecha local YYYY-MM-DD de un createdAt.
 * Los createdAt se guardan con getLocalISOString() (hora local en formato ISO),
 * así que los primeros 10 caracteres ya son la fecha local del registro.
 */
export function dateKeyOf(createdAt) {
    if (!createdAt) return '';
    if (typeof createdAt === 'string' && /^\d{4}-\d{2}-\d{2}/.test(createdAt)) {
        return createdAt.slice(0, 10);
    }
    const d = new Date(createdAt);
    if (isNaN(d.getTime())) return '';
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Clave de grupo: cliente normalizado + fecha local de creación */
export function groupKeyOf(reserva) {
    return `${normalizeClientName(reserva.clientName)}|${dateKeyOf(reserva.createdAt)}`;
}

/**
 * Agrupa reservas por cliente + fecha.
 * @param {Array} reservations filas de db.reservations
 * @returns {Array<{key, clientName, clientPhone, date, items}>}
 *   - items ordenados por id ascendente
 *   - grupos ordenados por el createdAt más reciente del grupo (desc),
 *     igual que el orden actual de la lista (más nuevas primero)
 */
export function groupReservations(reservations) {
    const map = new Map();
    (reservations || []).forEach((r) => {
        const key = groupKeyOf(r);
        if (!map.has(key)) {
            map.set(key, {
                key,
                clientName: normalizeClientName(r.clientName),
                clientPhone: r.clientPhone || '',
                date: dateKeyOf(r.createdAt),
                items: [],
            });
        }
        map.get(key).items.push(r);
    });

    const groups = [...map.values()];
    groups.forEach((g) => g.items.sort((a, b) => (a.id || 0) - (b.id || 0)));
    // ISO strings comparan lexicográficamente; createdAt siempre viene en ISO
    const maxCreated = (items) => items.reduce((m, r) => (r.createdAt > m ? r.createdAt : m), '');
    groups.sort((a, b) => {
        const am = maxCreated(a.items);
        const bm = maxCreated(b.items);
        return am < bm ? 1 : am > bm ? -1 : 0;
    });
    return groups;
}

/**
 * Resumen consolidado de un grupo (para tarjeta, detalle e impresión).
 * @param {Array} items    reservas del grupo
 * @param {Array} payments filas de db.reservationPayments (todas, sin filtrar)
 * @returns {{total, paid, remaining, status, earliestExpiry, pays}}
 *   - paid: suma de pagos NO anulados del grupo (los abonos de reservas
 *     canceladas quedan 'annulled' y no deben inflar el "Abonado" grupal)
 *   - remaining: saldo solo de las prendas pendientes
 *   - status: 'pending' si alguna está pendiente; 'cancelled' si todas lo
 *     están; 'completed' si todas lo están; 'mixed' en cualquier otro caso
 *   - earliestExpiry: menor expiryDate entre las prendas pendientes (o null)
 *   - pays: pagos no anulados del grupo, ordenados por fecha ascendente
 */
export function summarizeGroup(items, payments) {
    const list = items || [];
    const ids = new Set(list.map((r) => r.id));

    const pays = (payments || [])
        .filter((p) => ids.has(p.reservationId) && p.status !== 'annulled')
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const total = round2(list.reduce((s, r) => s + (r.totalPrice || 0), 0));
    const paid = round2(pays.reduce((s, p) => s + (p.amount || 0), 0));

    const paidByReserva = {};
    pays.forEach((p) => {
        paidByReserva[p.reservationId] = round2((paidByReserva[p.reservationId] || 0) + (p.amount || 0));
    });

    const remaining = round2(
        list
            .filter((r) => r.status === 'pending')
            .reduce((s, r) => s + Math.max(0, round2((r.totalPrice || 0) - (paidByReserva[r.id] || 0))), 0),
    );

    const statuses = new Set(list.map((r) => r.status));
    const status = statuses.has('pending')
        ? 'pending'
        : statuses.size === 1 && statuses.has('cancelled')
          ? 'cancelled'
          : statuses.size === 1 && statuses.has('completed')
            ? 'completed'
            : 'mixed';

    const earliestExpiry =
        list
            .filter((r) => r.status === 'pending' && r.expiryDate)
            .map((r) => r.expiryDate)
            .sort()[0] || null;

    return { total, paid, remaining, status, earliestExpiry, pays };
}

export default groupReservations;
