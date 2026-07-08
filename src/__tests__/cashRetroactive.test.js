/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔐 TESTS DE CIERRE RETROACTIVO — canCloseCashDate
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Autorización pura del cierre por fecha: hoy = flujo normal; fecha pasada
 * pendiente = retroactivo permitido; futura = siempre bloqueada; pasada ya
 * cerrada = no está en pendientes y por lo tanto bloqueada.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { canCloseCashDate, findPendingClosureDates } from '../utils/pendingClosures';

const TODAY = '2026-07-08';
const U = 7;

describe('canCloseCashDate', () => {
    it('(1) fecha pasada pendiente → permitida con flag retroactive', () => {
        const result = canCloseCashDate({
            selectedDate: '2026-07-06',
            today: TODAY,
            pendingDates: ['2026-07-05', '2026-07-06'],
        });
        expect(result.allowed).toBe(true);
        expect(result.retroactive).toBe(true);
    });

    it('(2) fecha futura → siempre bloqueada, incluso si figurara como pendiente', () => {
        const result = canCloseCashDate({
            selectedDate: '2026-07-09',
            today: TODAY,
            pendingDates: ['2026-07-09'], // dato corrupto: ni así se permite
        });
        expect(result.allowed).toBe(false);
        expect(result.retroactive).toBe(false);
        expect(result.reason).toMatch(/futura/i);
    });

    it('(3) hoy → flujo normal, no retroactivo', () => {
        const result = canCloseCashDate({
            selectedDate: TODAY,
            today: TODAY,
            pendingDates: ['2026-07-06'],
        });
        expect(result.allowed).toBe(true);
        expect(result.retroactive).toBe(false);
    });

    it('(4) fecha pasada YA cerrada → no aparece en pendientes y queda bloqueada', () => {
        // El día 06 tuvo ventas pero YA tiene cierre → findPendingClosureDates no lo devuelve
        const pendingDates = findPendingClosureDates({
            sales: [{ date: '2026-07-06T14:00:00.000Z', sellerId: U }],
            payments: [],
            closures: [{ date: '2026-07-06', userId: U, closedAt: '2026-07-06T20:00:00.000Z' }],
            openings: [],
            today: TODAY,
        });
        expect(pendingDates).toEqual([]);

        const result = canCloseCashDate({ selectedDate: '2026-07-06', today: TODAY, pendingDates });
        expect(result.allowed).toBe(false);
        expect(result.retroactive).toBe(false);
    });

    it('fecha pasada SIN movimientos (no pendiente) → bloqueada', () => {
        const result = canCloseCashDate({
            selectedDate: '2026-07-01',
            today: TODAY,
            pendingDates: ['2026-07-06'],
        });
        expect(result.allowed).toBe(false);
    });

    it('sin fecha o sin today (hook aún cargando) → bloqueada sin fallar', () => {
        expect(canCloseCashDate({ selectedDate: null, today: TODAY, pendingDates: [] }).allowed).toBe(false);
        expect(canCloseCashDate({ selectedDate: TODAY, today: null, pendingDates: [] }).allowed).toBe(false);
    });
});
