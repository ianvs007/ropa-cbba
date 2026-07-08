/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🚪 TESTS DE AVISO AL SALIR — getExitWarning
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Al cerrar sesión o cerrar la app, se avisa al vendedor si la caja de hoy
 * está abierta o si quedan días pendientes. Admin nunca recibe el aviso
 * (no opera caja). Es aviso, no bloqueo.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { getExitWarning } from '../utils/exitWarning';

describe('getExitWarning', () => {
    it('vendedor con caja de hoy abierta → avisa', () => {
        const w = getExitWarning({ role: 'seller', cashOpenToday: true, pendingDates: [] });
        expect(w).not.toBeNull();
        expect(w.type).toBe('today-open');
        expect(w.message).toMatch(/HOY abierta/);
    });

    it('vendedor con días anteriores pendientes → avisa con la cantidad', () => {
        const w = getExitWarning({ role: 'seller', cashOpenToday: false, pendingDates: ['2026-07-05', '2026-07-06'] });
        expect(w).not.toBeNull();
        expect(w.type).toBe('pending-days');
        expect(w.message).toContain('2 día(s)');
    });

    it('vendedor con ambas cosas → aviso combinado', () => {
        const w = getExitWarning({ role: 'seller', cashOpenToday: true, pendingDates: ['2026-07-06'] });
        expect(w.type).toBe('both');
        expect(w.message).toMatch(/HOY abierta/);
        expect(w.message).toContain('1 día(s)');
    });

    it('vendedor sin caja abierta ni pendientes → no avisa', () => {
        expect(getExitWarning({ role: 'seller', cashOpenToday: false, pendingDates: [] })).toBeNull();
    });

    it('admin nunca recibe el aviso (no opera caja)', () => {
        expect(getExitWarning({ role: 'admin', cashOpenToday: true, pendingDates: ['2026-07-06'] })).toBeNull();
    });

    it('datos aún cargando (undefined) no revientan ni avisan de más', () => {
        expect(getExitWarning({ role: 'seller', cashOpenToday: false, pendingDates: undefined })).toBeNull();
    });
});
