/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 👥 TESTS DE AGRUPACIÓN DE RESERVAS por cliente y fecha
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * groupReservations(reservations) agrupa las reservas del mismo solicitante
 * (cliente normalizado) creadas el mismo día, para mostrarlas como una sola
 * tarjeta/grupo. summarizeGroup(items, payments) consolida totales para la
 * tarjeta, el detalle y la impresión. La gestión sigue por prenda individual.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
    groupReservations,
    summarizeGroup,
    groupKeyOf,
    dateKeyOf,
    normalizeClientName,
} from '../utils/reservationGroups';

const res = (id, name, createdAt, extra = {}) => ({
    id,
    clientName: name,
    clientPhone: '70000000',
    productName: `PRENDA ${id}`,
    totalPrice: 100,
    status: 'pending',
    createdAt,
    ...extra,
});

describe('normalizeClientName / dateKeyOf / groupKeyOf', () => {
    it('normaliza mayúsculas y espacios extra', () => {
        expect(normalizeClientName('  anghely   choque ')).toBe('ANGHELY CHOQUE');
    });

    it('extrae la fecha local YYYY-MM-DD del createdAt ISO', () => {
        expect(dateKeyOf('2026-07-18T21:33:23.333Z')).toBe('2026-07-18');
        expect(dateKeyOf('')).toBe('');
        expect(dateKeyOf(null)).toBe('');
    });

    it('la clave combina cliente normalizado y fecha', () => {
        expect(groupKeyOf(res(1, ' Anghely  Choque', '2026-07-18T10:00:00.000Z'))).toBe('ANGHELY CHOQUE|2026-07-18');
    });
});

describe('groupReservations', () => {
    it('agrupa mismo cliente y misma fecha (con normalización de nombre)', () => {
        const groups = groupReservations([
            res(1, 'ANGHELY CHOQUE', '2026-07-18T10:00:00.000Z'),
            res(2, 'anghely   choque ', '2026-07-18T11:00:00.000Z'),
            res(3, 'ANGHELY CHOQUE', '2026-07-18T12:00:00.000Z'),
        ]);
        expect(groups).toHaveLength(1);
        expect(groups[0].items.map((r) => r.id)).toEqual([1, 2, 3]);
        expect(groups[0].clientName).toBe('ANGHELY CHOQUE');
        expect(groups[0].date).toBe('2026-07-18');
    });

    it('NO agrupa fechas distintas aunque sea el mismo cliente', () => {
        const groups = groupReservations([
            res(1, 'JHAKELINE', '2026-07-17T10:00:00.000Z'),
            res(2, 'JHAKELINE', '2026-07-18T10:00:00.000Z'),
        ]);
        expect(groups).toHaveLength(2);
    });

    it('NO agrupa clientes distintos en la misma fecha', () => {
        const groups = groupReservations([
            res(1, 'MARISOL ARISPE', '2026-07-18T10:00:00.000Z'),
            res(2, 'JHAKELINE', '2026-07-18T10:00:00.000Z'),
        ]);
        expect(groups).toHaveLength(2);
    });

    it('ordena grupos por createdAt más reciente primero e items por id', () => {
        const groups = groupReservations([
            res(5, 'CLIENTE VIEJO', '2026-07-10T10:00:00.000Z'),
            res(3, 'CLIENTE NUEVO', '2026-07-18T09:00:00.000Z'),
            res(1, 'CLIENTE NUEVO', '2026-07-18T08:00:00.000Z'),
            res(2, 'CLIENTE NUEVO', '2026-07-18T08:30:00.000Z'),
        ]);
        expect(groups).toHaveLength(2);
        expect(groups[0].clientName).toBe('CLIENTE NUEVO');
        expect(groups[0].items.map((r) => r.id)).toEqual([1, 2, 3]);
        expect(groups[1].clientName).toBe('CLIENTE VIEJO');
    });

    it('lista vacía o nula no revienta', () => {
        expect(groupReservations([])).toEqual([]);
        expect(groupReservations(null)).toEqual([]);
    });
});

describe('summarizeGroup', () => {
    const items = [
        res(1, 'ANA', '2026-07-18T10:00:00.000Z', { totalPrice: 230 }),
        res(2, 'ANA', '2026-07-18T10:00:00.000Z', { totalPrice: 105 }),
    ];
    const payments = [
        { id: 1, reservationId: 1, amount: 109.14, date: '2026-07-18T10:05:00.000Z' },
        { id: 2, reservationId: 2, amount: 49.82, date: '2026-07-18T10:04:00.000Z' },
        { id: 3, reservationId: 1, amount: 20, date: '2026-07-18T12:00:00.000Z' },
        { id: 4, reservationId: 999, amount: 50, date: '2026-07-18T12:00:00.000Z' }, // de otro grupo
    ];

    it('consolida total y abonado del grupo (ignora pagos ajenos)', () => {
        const s = summarizeGroup(items, payments);
        expect(s.total).toBe(335);
        expect(s.paid).toBe(178.96);
        expect(s.remaining).toBe(156.04);
    });

    it('excluye pagos anulados (reservas canceladas) del abonado', () => {
        const s = summarizeGroup(items, [
            ...payments,
            { id: 5, reservationId: 2, amount: 999, date: '2026-07-18T13:00:00.000Z', status: 'annulled' },
        ]);
        expect(s.paid).toBe(178.96);
    });

    it('el saldo solo cuenta prendas pendientes', () => {
        const done = { ...items[1], status: 'completed' };
        const s = summarizeGroup([items[0], done], payments);
        expect(s.remaining).toBe(100.86); // solo reserva 1: 230 - 129.14
        expect(s.status).toBe('pending'); // aún hay una pendiente
    });

    it('status: cancelled solo si TODAS están canceladas; completed solo si TODAS completadas; mixed en otro caso', () => {
        expect(summarizeGroup(items, payments).status).toBe('pending');
        expect(
            summarizeGroup(
                items.map((r) => ({ ...r, status: 'cancelled' })),
                payments,
            ).status,
        ).toBe('cancelled');
        expect(
            summarizeGroup(
                items.map((r) => ({ ...r, status: 'completed' })),
                payments,
            ).status,
        ).toBe('completed');
        expect(
            summarizeGroup(
                [
                    { ...items[0], status: 'completed' },
                    { ...items[1], status: 'cancelled' },
                ],
                payments,
            ).status,
        ).toBe('mixed');
    });

    it('earliestExpiry es la menor fecha de vencimiento entre pendientes', () => {
        const s = summarizeGroup(
            [
                { ...items[0], expiryDate: '2026-08-10T00:00:00.000Z' },
                { ...items[1], expiryDate: '2026-08-01T00:00:00.000Z' },
            ],
            payments,
        );
        expect(s.earliestExpiry).toBe('2026-08-01T00:00:00.000Z');

        const sinPendientes = summarizeGroup(
            items.map((r) => ({ ...r, status: 'completed', expiryDate: '2026-08-01T00:00:00.000Z' })),
            payments,
        );
        expect(sinPendientes.earliestExpiry).toBeNull();
    });

    it('pays viene ordenado por fecha y solo del grupo', () => {
        const s = summarizeGroup(items, payments);
        expect(s.pays.map((p) => p.id)).toEqual([2, 1, 3]);
    });
});
