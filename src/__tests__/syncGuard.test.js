/**
 * Tests del guardia anti-sobrevende tras sync nube OK / descuento local fallido.
 */
import { describe, it, expect } from 'vitest';
import { estadoBloqueoSyncPorDescuentoPendiente } from '../utils/syncGuard';

describe('estadoBloqueoSyncPorDescuentoPendiente', () => {
    it('sin flag ni ventas → no bloquea', () => {
        expect(estadoBloqueoSyncPorDescuentoPendiente(null, null)).toEqual({
            bloqueado: false, cantidad: 0, motivo: null,
        });
    });

    it('flag activo bloquea aunque la lista esté vacía', () => {
        const r = estadoBloqueoSyncPorDescuentoPendiente('1', []);
        expect(r.bloqueado).toBe(true);
        expect(r.cantidad).toBe(0);
        expect(r.motivo).toMatch(/sobrevender/i);
    });

    it('lista de ventas pendientes bloquea y reporta cantidad', () => {
        const r = estadoBloqueoSyncPorDescuentoPendiente('1', [
            { codigo: '00001', cantidad: 1 },
            { codigo: '00002', cantidad: 2 },
        ]);
        expect(r.bloqueado).toBe(true);
        expect(r.cantidad).toBe(2);
    });

    it('acepta JSON string de settings', () => {
        const r = estadoBloqueoSyncPorDescuentoPendiente(1, JSON.stringify([{ codigo: '1', cantidad: 1 }]));
        expect(r.bloqueado).toBe(true);
        expect(r.cantidad).toBe(1);
    });

    it('JSON inválido no revienta: trata como lista vacía, flag manda', () => {
        const r = estadoBloqueoSyncPorDescuentoPendiente('1', '{no-json');
        expect(r.bloqueado).toBe(true);
        expect(r.cantidad).toBe(0);
    });
});
