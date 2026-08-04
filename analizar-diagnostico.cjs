/**
 * Réplica exacta de la lógica de la app sobre el diagnóstico exportado:
 *  - findPendingClosureDates (src/utils/pendingClosures.js)
 *  - ventana de 60 días de usePendingClosureDates
 *  - búsqueda de cierre "existing" de CashClose.jsx (por openingId / por date+userId)
 *  - turnos pendientes de CashClose.jsx (ventana 30 días, por usuario)
 */
const d = require('./diagnostico_caja.json');

const today = d.localToday;
const dayOf = (r) => (r?.date || '').slice(0, 10);

// ── Ventana 60 días (usePendingClosureDates) ─────────────────────────
const from = new Date(today + 'T00:00:00');
from.setDate(from.getDate() - 60);
const cutoff = from.toISOString().slice(0, 10);
const inW = (r, upperExclusive = true) => {
    const x = r.date || '';
    return upperExclusive ? (x >= cutoff && x < today) : (x >= cutoff && x <= today);
};
const sales = d.sales.filter(s => inW(s));
const payments = d.reservationPayments.filter(p => inW(p));
const closures = d.cashClosures.filter(c => inW(c, false));
const openings = d.cashOpenings.filter(o => inW(o));

// ── findPendingClosureDates ──────────────────────────────────────────
const closedDayUser = new Set();
const closedOpeningIds = new Set();
const closedDates = new Set();
closures.forEach(c => {
    if (!c.closedAt) return;
    const dd = dayOf(c);
    if (dd) closedDayUser.add(`${dd}|${c.userId}`);
    if (dd && c.retroactive === true) closedDates.add(dd);
    if (c.openingId != null) closedOpeningIds.add(c.openingId);
});

const pending = new Set();
const reasons = {}; // date -> set de razones detalladas
const addReason = (dt, msg) => { (reasons[dt] = reasons[dt] || new Set()).add(msg); };

sales.forEach(s => {
    if (s.status === 'annulled') return;
    const dd = dayOf(s);
    if (dd && dd < today && !closedDates.has(dd) && !closedDayUser.has(`${dd}|${s.sellerId}`)) {
        pending.add(dd);
        addReason(dd, `venta #${s.id} de sellerId=${s.sellerId} (${typeof s.sellerId}) sin cierre de ese usuario`);
    }
});
payments.forEach(p => {
    if (p.status === 'annulled') return;
    const dd = dayOf(p);
    if (dd && dd < today && !closedDates.has(dd) && !closedDayUser.has(`${dd}|${p.userId}`)) {
        pending.add(dd);
        addReason(dd, `abono #${p.id} de userId=${p.userId} sin cierre de ese usuario`);
    }
});
openings.forEach(o => {
    const dd = dayOf(o);
    if (!dd || dd >= today) return;
    if (!closedOpeningIds.has(o.id) && !closedDates.has(dd) && !closedDayUser.has(`${dd}|${o.userId}`)) {
        pending.add(dd);
        addReason(dd, `apertura #${o.id} de userId=${o.userId} sin cierre vinculado`);
    }
});

const pendingDates = [...pending].sort();
console.log('=== DÍAS PENDIENTES detectados (today=' + today + ', ventana desde ' + cutoff + ') ===');
console.log(pendingDates);

console.log('\n=== DETALLE POR DÍA PENDIENTE ===');
for (const dd of pendingDates) {
    console.log(`\n── ${dd} ──`);
    console.log('Razones:', [...(reasons[dd] || [])]);
    const cs = d.cashClosures.filter(c => dayOf(c) === dd);
    console.log('Cierres en cashClosures ese día:', cs.map(c => ({
        id: c.id, userId: c.userId, tUserId: typeof c.userId, openingId: c.openingId,
        closedAt: c.closedAt ? 'SI' : 'NO (null)', retroactive: c.retroactive ?? false,
        reopenedAt: c.reopenedAt || null, notes: (c.notes || '').slice(0, 60),
    })));
    const os = d.cashOpenings.filter(o => dayOf(o) === dd);
    console.log('Aperturas ese día:', os.map(o => ({ id: o.id, userId: o.userId, cashStart: o.cashStart })));
    const sv = d.sales.filter(s => dayOf(s) === dd && s.status !== 'annulled');
    const bySeller = {};
    sv.forEach(s => { bySeller[s.sellerId] = (bySeller[s.sellerId] || 0) + 1; });
    console.log('Ventas activas por sellerId:', bySeller);
}

// ── Simular lo que ve la CAJERA (userId=2) al seleccionar cada día pendiente ──
console.log('\n=== SIMULACIÓN: qué ve cada usuario al seleccionar el día pendiente ===');
for (const u of d.users.filter(x => x.role !== 'admin')) {
    console.log(`\n── Usuario ${u.username} (id=${u.id}) ──`);
    // pendingShifts (CashClose.jsx:124-154): aperturas últimos 30 días del usuario sin cierre por openingId
    const thirty = new Date(); thirty.setDate(thirty.getDate() - 30);
    const iso30 = thirty.toISOString().slice(0, 10);
    const myOpenings = d.cashOpenings.filter(o => o.date > iso30 && o.userId === u.id);
    const myClosures = d.cashClosures.filter(c => c.date > iso30 && c.userId === u.id && !!c.closedAt);
    const closedIds = new Set(myClosures.map(c => c.openingId).filter(Boolean));
    const myPendingShifts = myOpenings.filter(o => !closedIds.has(o.id) && (o.date < today || o.date === today));

    for (const dd of pendingDates) {
        const shift = myPendingShifts.find(s => s.date === dd);
        let existing, mode;
        if (shift) {
            mode = `turno (openingId=${shift.id})`;
            existing = d.cashClosures.find(c => c.openingId === shift.id); // SIN filtro de usuario
        } else {
            mode = 'día completo (dayLevelRetro)';
            existing = d.cashClosures.find(c => dayOf(c) === dd && c.userId === u.id); // estricto ===
        }
        console.log(`  ${dd}: modo=${mode} → existing=${existing
            ? `SI (id=${existing.id}, userId=${existing.userId}, closedAt=${existing.closedAt ? 'SI → PANTALLA "CIERRE COMPLETADO"' : 'null'}, retro=${existing.retroactive ?? false})`
            : 'NO → formulario de arqueo'}`);
    }
}

// ── Cierres huérfanos o raros (fuera de pendientes pero con historia) ──
console.log('\n=== TODOS LOS CIERRES (resumen) ===');
d.cashClosures.forEach(c => {
    console.log(`id=${c.id} date=${dayOf(c)} userId=${c.userId}(${typeof c.userId}) openingId=${c.openingId ?? '-'} closedAt=${c.closedAt ? c.closedAt.slice(0, 16) : 'NULL'} retro=${c.retroactive ?? false} reopened=${c.reopenedAt ? 'SI' : 'no'} total=${c.totalSales} notas="${(c.notes || '').slice(0, 45)}"`);
});
