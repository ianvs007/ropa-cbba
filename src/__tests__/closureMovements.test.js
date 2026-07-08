/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 💰 TESTS DE MOVIMIENTOS DEL CIERRE — filterClosureMovements
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Reproduce el bug del cierre retroactivo "Sin actividad registrada": el día
 * 2026-05-11 estaba pendiente por ventas de otra vendedora, pero CashClose
 * consultaba los movimientos filtrados por la usuaria actual → vacío (y un
 * cierre guardado así quedaría con totales en 0).
 *
 * El modo allUsers (regularización de día completo) debe devolver los
 * movimientos de todos; el modo normal conserva el bloqueo por usuario.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { filterClosureMovements } from '../utils/closureMovements';

// Ventas del 2026-05-11 de la vendedora ANTIGUA (id 3); la usuaria actual es id 5
const SALES_0511 = [
    { date: '2026-05-11T10:30:00.000Z', sellerId: 3, total: 150, paymentMethod: 'efectivo' },
    { date: '2026-05-11T16:45:00.000Z', sellerId: 3, total: 220, paymentMethod: 'qr' },
];
const PAYMENTS_0511 = [
    { date: '2026-05-11T12:00:00.000Z', userId: 3, amount: 50, paymentMethod: 'efectivo' },
];

describe('filterClosureMovements', () => {
    it('REPRO BUG: en modo regularización (allUsers) devuelve los movimientos aunque sean de otra vendedora', () => {
        const result = filterClosureMovements({
            sales: SALES_0511,
            resPayments: PAYMENTS_0511,
            expenses: [],
            userId: 5,        // la usuaria que regulariza HOY
            shiftId: null,    // cierre a nivel día (sin apertura aquel día)
            allUsers: true,   // modo día completo del flujo retroactivo
        });
        expect(result.sales).toHaveLength(2);
        expect(result.resPayments).toHaveLength(1);
    });

    it('modo normal (día en curso): el bloqueo por usuario sigue intacto', () => {
        const result = filterClosureMovements({
            sales: SALES_0511,
            resPayments: PAYMENTS_0511,
            expenses: [],
            userId: 5,
            shiftId: null,
        });
        expect(result.sales).toHaveLength(0);
        expect(result.resPayments).toHaveLength(0);
    });

    it('modo normal: el usuario dueño de los movimientos sí los ve', () => {
        const result = filterClosureMovements({
            sales: SALES_0511,
            resPayments: PAYMENTS_0511,
            expenses: [{ date: '2026-05-11T13:00:00.000Z', userId: 3, amount: 30 }],
            userId: 3,
            shiftId: null,
        });
        expect(result.sales).toHaveLength(2);
        expect(result.resPayments).toHaveLength(1);
        expect(result.expenses).toHaveLength(1);
    });

    it('sin userId y sin allUsers → vacío (bloqueo defensivo original)', () => {
        const result = filterClosureMovements({
            sales: SALES_0511, resPayments: PAYMENTS_0511, expenses: [],
            userId: null, shiftId: null,
        });
        expect(result.sales).toHaveLength(0);
        expect(result.resPayments).toHaveLength(0);
    });

    it('shiftId modo estricto: si hay registros del turno, solo esos', () => {
        const sales = [
            { date: '2026-07-08T10:00:00.000Z', sellerId: 5, shiftId: 42, total: 100 },
            { date: '2026-07-08T11:00:00.000Z', sellerId: 5, shiftId: 43, total: 200 },
            { date: '2026-07-08T09:00:00.000Z', sellerId: 5, total: 300 }, // legacy sin shiftId
        ];
        const result = filterClosureMovements({ sales, userId: 5, shiftId: 42 });
        expect(result.sales).toHaveLength(1);
        expect(result.sales[0].shiftId).toBe(42);
    });

    it('shiftId fallback legacy: sin registros exactos del turno, incluye los sin shiftId', () => {
        const sales = [
            { date: '2026-07-08T09:00:00.000Z', sellerId: 5, total: 300 }, // legacy
            { date: '2026-07-08T11:00:00.000Z', sellerId: 5, shiftId: 43, total: 200 },
        ];
        const result = filterClosureMovements({ sales, userId: 5, shiftId: 42 });
        expect(result.sales).toHaveLength(1);
        expect(result.sales[0].total).toBe(300);
    });

    it('allUsers + shiftId: la regularización respeta el filtro de turno si se pasa', () => {
        const sales = [
            { date: '2026-05-11T10:00:00.000Z', sellerId: 3, shiftId: 42, total: 100 },
            { date: '2026-05-11T11:00:00.000Z', sellerId: 4, shiftId: 42, total: 200 },
            { date: '2026-05-11T12:00:00.000Z', sellerId: 4, shiftId: 43, total: 400 },
        ];
        const result = filterClosureMovements({ sales, userId: 5, shiftId: 42, allUsers: true });
        expect(result.sales).toHaveLength(2);
    });
});
