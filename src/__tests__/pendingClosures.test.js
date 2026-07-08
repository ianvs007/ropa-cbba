/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 💰 TESTS DE CIERRES PENDIENTES — findPendingClosureDates
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Un día anterior a hoy está pendiente si tiene movimientos de caja (ventas o
 * abonos de reserva no anulados) sin cierre del usuario que los generó, o una
 * apertura de turno sin su cierre. El día en curso nunca cuenta.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { findPendingClosureDates } from '../utils/pendingClosures';

const TODAY = '2026-07-08';
const U = 7; // userId/sellerId del vendedor de los casos

const sale = (date, sellerId = U, status) => ({ date: `${date}T14:30:00.000Z`, sellerId, total: 100, ...(status ? { status } : {}) });
const payment = (date, userId = U, status) => ({ date: `${date}T15:00:00.000Z`, userId, amount: 50, ...(status ? { status } : {}) });
const closure = (date, userId = U, openingId) => ({ date, userId, closedAt: `${date}T20:00:00.000Z`, ...(openingId != null ? { openingId } : {}) });
const opening = (id, date, userId = U) => ({ id, date, userId, openedAt: `${date}T09:00:00.000Z` });

describe('findPendingClosureDates', () => {
    it('(1) día anterior con ventas sin cierre → pendiente', () => {
        const result = findPendingClosureDates({
            sales: [sale('2026-07-06')],
            payments: [], closures: [], openings: [],
            today: TODAY,
        });
        expect(result).toEqual(['2026-07-06']);
    });

    it('(2) día con ventas Y cierre → no pendiente', () => {
        const result = findPendingClosureDates({
            sales: [sale('2026-07-06')],
            payments: [],
            closures: [closure('2026-07-06')],
            openings: [],
            today: TODAY,
        });
        expect(result).toEqual([]);
    });

    it('(3) hoy con ventas sin cierre → NO pendiente (el día en curso no cuenta)', () => {
        const result = findPendingClosureDates({
            sales: [sale(TODAY)],
            payments: [payment(TODAY)],
            closures: [],
            openings: [opening(1, TODAY)],
            today: TODAY,
        });
        expect(result).toEqual([]);
    });

    it('(4) día sin movimientos y sin cierre → no pendiente', () => {
        const result = findPendingClosureDates({
            sales: [], payments: [], closures: [], openings: [],
            today: TODAY,
        });
        expect(result).toEqual([]);
    });

    it('(5) varios días pendientes → todos ordenados, el más antiguo primero', () => {
        const result = findPendingClosureDates({
            sales: [sale('2026-07-05'), sale('2026-07-01')],
            payments: [payment('2026-07-03')],
            closures: [],
            openings: [opening(1, '2026-06-28')],
            today: TODAY,
        });
        expect(result).toEqual(['2026-06-28', '2026-07-01', '2026-07-03', '2026-07-05']);
    });

    it('un abono de reserva sin cierre también marca el día como pendiente', () => {
        const result = findPendingClosureDates({
            sales: [], payments: [payment('2026-07-06')], closures: [], openings: [],
            today: TODAY,
        });
        expect(result).toEqual(['2026-07-06']);
    });

    it('ventas y abonos anulados no cuentan como movimiento', () => {
        const result = findPendingClosureDates({
            sales: [sale('2026-07-06', U, 'annulled')],
            payments: [payment('2026-07-05', U, 'annulled')],
            closures: [], openings: [],
            today: TODAY,
        });
        expect(result).toEqual([]);
    });

    it('apertura de turno sin cierre → pendiente aunque no haya ventas', () => {
        const result = findPendingClosureDates({
            sales: [], payments: [], closures: [],
            openings: [opening(1, '2026-07-06')],
            today: TODAY,
        });
        expect(result).toEqual(['2026-07-06']);
    });

    it('apertura con cierre por openingId → no pendiente', () => {
        const result = findPendingClosureDates({
            sales: [], payments: [],
            closures: [closure('2026-07-06', U, 1)],
            openings: [opening(1, '2026-07-06')],
            today: TODAY,
        });
        expect(result).toEqual([]);
    });

    it('el cierre de un usuario no cubre las ventas de otro usuario ese día', () => {
        const result = findPendingClosureDates({
            sales: [sale('2026-07-06', 9)],       // vendió el usuario 9
            payments: [],
            closures: [closure('2026-07-06', U)], // cerró el usuario 7
            openings: [],
            today: TODAY,
        });
        expect(result).toEqual(['2026-07-06']);
    });

    it('un cierre sin closedAt (borrador) no cuenta como cierre', () => {
        const result = findPendingClosureDates({
            sales: [sale('2026-07-06')],
            payments: [],
            closures: [{ date: '2026-07-06', userId: U }], // sin closedAt
            openings: [],
            today: TODAY,
        });
        expect(result).toEqual(['2026-07-06']);
    });

    it('instalación nueva (todo vacío, sin today aún) → no falla y no hay pendientes', () => {
        expect(findPendingClosureDates({ today: TODAY })).toEqual([]);
        expect(findPendingClosureDates({ sales: [sale('2026-07-06')], today: null })).toEqual([]);
    });
});
