/**
 * 💰 Filtrado de movimientos para el cierre de caja (lógica pura, testeable).
 *
 * Extraído de calculateClosureData (db/helpers.js) sin cambiar su semántica:
 *  - Con userId: solo movimientos de ese usuario (bloqueo de seguridad de turnos).
 *  - Sin userId y sin allUsers: NADA (comportamiento defensivo original).
 *  - Con shiftId: modo estricto si hay registros de ese turno; si no, fallback
 *    legacy que incluye registros sin shiftId.
 *  - allUsers=true (NUEVO): modo regularización de día completo para cierres
 *    RETROACTIVOS — incluye movimientos de TODOS los usuarios, porque el día
 *    pendiente puede deberse a ventas de un vendedor que ya no existe y el
 *    detector de pendientes (findPendingClosureDates) mira a todos.
 *
 * @returns {{sales: Array, resPayments: Array, expenses: Array}}
 */
export function filterClosureMovements({
    sales = [], resPayments = [], expenses = [],
    userId = null, shiftId = null, allUsers = false,
}) {
    let s = sales || [];
    let p = resPayments || [];
    let e = expenses || [];

    if (allUsers) {
        // Regularización de día completo: sin filtro por usuario
    } else if (userId !== null && userId !== undefined && userId !== "") {
        const uidStr = userId.toString();
        s = s.filter(x => x.sellerId !== undefined && x.sellerId !== null && x.sellerId.toString() === uidStr);
        p = p.filter(x => x.userId !== undefined && x.userId !== null && x.userId.toString() === uidStr);
        e = e.filter(x => x.userId !== undefined && x.userId !== null && x.userId.toString() === uidStr);
    } else {
        s = []; p = []; e = [];
    }

    if (shiftId !== null && shiftId !== undefined) {
        const hasExactShift = s.some(x => x.shiftId === shiftId);
        if (hasExactShift) {
            // Modo estricto: solo registros de este turno
            s = s.filter(x => x.shiftId === shiftId);
            p = p.filter(x => x.shiftId === shiftId);
            e = e.filter(x => x.shiftId === shiftId);
        } else {
            // Fallback: incluir registros sin shiftId (legacy) del mismo usuario/fecha
            s = s.filter(x => !x.shiftId || x.shiftId === shiftId);
            p = p.filter(x => !x.shiftId || x.shiftId === shiftId);
            e = e.filter(x => !x.shiftId || x.shiftId === shiftId);
        }
    }

    return { sales: s, resPayments: p, expenses: e };
}

export default filterClosureMovements;
