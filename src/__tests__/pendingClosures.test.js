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
import {
    findPendingClosureDates,
    summarizePendingClosureDays,
    planMassRegularization,
} from '../utils/pendingClosures';

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

    it('ventas en línea (en_linea), entregas de reserva o excludeFromCash no generan falsos pendientes', () => {
        const result = findPendingClosureDates({
            sales: [
                { date: '2026-07-04T14:00:00.000Z', sellerId: null, total: 120, paymentMethod: 'en_linea' },
                { date: '2026-07-05T14:00:00.000Z', sellerId: U, total: 90, paymentMethod: 'reserva' },
                { date: '2026-07-06T14:00:00.000Z', sellerId: U, total: 80, excludeFromCash: true },
            ],
            payments: [], closures: [], openings: [],
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

describe('summarizePendingClosureDays y planMassRegularization', () => {
    it('resume correctamente cantidad de movimientos y efectivo esperado por día pendiente', () => {
        const summary = summarizePendingClosureDays({
            sales: [
                { date: '2026-07-05T10:00:00.000Z', sellerId: U, total: 150, paymentMethod: 'efectivo' },
                { date: '2026-07-05T11:00:00.000Z', sellerId: U, total: 80, paymentMethod: 'qr' },
            ],
            payments: [
                { date: '2026-07-05T12:00:00.000Z', userId: U, amount: 40, paymentMethod: 'efectivo' },
            ],
            expenses: [
                { date: '2026-07-05T13:00:00.000Z', userId: U, amount: 30, paymentMethod: 'efectivo' },
            ],
            closures: [],
            openings: [
                { id: 10, date: '2026-07-05', userId: U, cashStart: 100 },
                { id: 11, date: '2026-07-06', userId: U, cashStart: 50 },
            ],
            today: TODAY,
        });

        expect(summary).toHaveLength(2);
        expect(summary[0]).toMatchObject({
            date: '2026-07-05',
            salesCount: 2,
            paymentsCount: 1,
            expectedCash: 260, // 100 (fondo) + 150 + 40 - 30
            label: '3 mov.',
        });
        expect(summary[1]).toMatchObject({
            date: '2026-07-06',
            salesCount: 0,
            paymentsCount: 0,
            expectedCash: 50,
            label: 'Turno sin ventas',
        });
    });

    it('planifica regularización masiva (CREAR y PROMOVER) dejando 0 días pendientes al aplicarse', () => {
        const sales = [
            { date: '2026-07-04T10:00:00.000Z', sellerId: 2, total: 200, paymentMethod: 'efectivo', items: [{ qty: 2 }] },
            { date: '2026-07-05T10:00:00.000Z', sellerId: 3, total: 120, paymentMethod: 'efectivo', items: [{ qty: 1 }] },
        ];
        // En 2026-07-05 cerró el usuario 2 (normal), pero vendió el usuario 3 → sigue pendiente
        const closures = [
            { id: 99, date: '2026-07-05', userId: 2, cashStart: 50, cashOnHand: 170, totalSales: 0, closedAt: '2026-07-05T20:00:00.000Z' },
        ];
        const openings = [
            { id: 5, date: '2026-07-04', userId: 2, cashStart: 100 },
        ];
        const users = [
            { id: 1, username: 'admin', role: 'admin' },
            { id: 2, username: 'cajera', role: 'seller' },
        ];

        const pendingDates = findPendingClosureDates({ sales, payments: [], closures, openings, today: TODAY });
        expect(pendingDates).toEqual(['2026-07-04', '2026-07-05']);

        const plan = planMassRegularization({
            pendingDates,
            sales,
            payments: [],
            expenses: [],
            closures,
            openings,
            users,
            activeUser: { id: 2, username: 'cajera', name: 'Cajera', role: 'seller' },
            nowISO: '2026-07-08T19:00:00.000Z',
        });

        expect(plan).toHaveLength(2);
        expect(plan[0].action).toBe('CREAR');
        expect(plan[0].insert).toMatchObject({
            date: '2026-07-04',
            cashStart: 100,
            totalSales: 200,
            cashOnHand: 300,
            cashDifference: 0,
            retroactive: true,
        });

        expect(plan[1].action).toBe('PROMOVER');
        expect(plan[1].closureId).toBe(99);
        expect(plan[1].update).toMatchObject({
            totalSales: 120,
            retroactive: true,
            cashDifference: 0,
        });

        // Simular aplicación del plan y verificar que ya no quedan días pendientes
        const updatedClosures = [
            plan[0].insert,
            { ...closures[0], ...plan[1].update },
        ];
        const remaining = findPendingClosureDates({
            sales,
            payments: [],
            closures: updatedClosures,
            openings,
            today: TODAY,
        });
        expect(remaining).toEqual([]);
    });
});

