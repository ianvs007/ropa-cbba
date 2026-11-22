import { describe, it, expect } from 'vitest';
import {
    esContrasenaPorDefecto,
    requiereCambioContrasena,
    validarNuevaContrasena,
    LARGO_MINIMO_CONTRASENA,
} from '../utils/passwordPolicy';

describe('esContrasenaPorDefecto', () => {
    it('detecta las credenciales iniciales conocidas (sin distinguir mayúsculas)', () => {
        expect(esContrasenaPorDefecto('admin123')).toBe(true);
        expect(esContrasenaPorDefecto('Cajera123')).toBe(true);
        expect(esContrasenaPorDefecto(' 123456 ')).toBe(true);
    });

    it('no marca contraseñas propias ni valores no string', () => {
        expect(esContrasenaPorDefecto('M1-clave-propia')).toBe(false);
        expect(esContrasenaPorDefecto(undefined)).toBe(false);
        expect(esContrasenaPorDefecto(null)).toBe(false);
    });
});

describe('requiereCambioContrasena', () => {
    it('exige cambio si el usuario está marcado con mustChangePassword', () => {
        expect(requiereCambioContrasena({ mustChangePassword: true }, 'cualquiera-segura')).toBe(true);
    });

    it('exige cambio si entró con una contraseña de fábrica aunque no tenga la marca', () => {
        expect(requiereCambioContrasena({ username: 'admin' }, 'admin123')).toBe(true);
    });

    it('no exige cambio con contraseña propia y sin marca', () => {
        expect(requiereCambioContrasena({ username: 'ana', mustChangePassword: false }, 'Clave-Segura-9')).toBe(false);
        expect(requiereCambioContrasena({ username: 'ana' }, 'Clave-Segura-9')).toBe(false);
    });

    it('tolera usuario indefinido', () => {
        expect(requiereCambioContrasena(undefined, 'Clave-Segura-9')).toBe(false);
    });
});

describe('validarNuevaContrasena', () => {
    const base = { actual: 'admin123', username: 'admin' };

    it('acepta una contraseña válida', () => {
        expect(validarNuevaContrasena({ ...base, nueva: 'Tienda-2026!', confirmacion: 'Tienda-2026!' })).toEqual({ ok: true });
    });

    it(`rechaza menos de ${LARGO_MINIMO_CONTRASENA} caracteres`, () => {
        const r = validarNuevaContrasena({ ...base, nueva: 'corta1', confirmacion: 'corta1' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/al menos/);
    });

    it('rechaza si la confirmación no coincide', () => {
        const r = validarNuevaContrasena({ ...base, nueva: 'Tienda-2026!', confirmacion: 'Tienda-2027!' });
        expect(r).toEqual({ ok: false, error: 'Las contraseñas no coinciden' });
    });

    it('rechaza reutilizar la contraseña actual', () => {
        const r = validarNuevaContrasena({ actual: 'Tienda-2026!', nueva: 'Tienda-2026!', confirmacion: 'Tienda-2026!', username: 'x' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/distinta/);
    });

    it('rechaza contraseñas de fábrica como contraseña nueva', () => {
        const r = validarNuevaContrasena({ actual: 'otra-vieja', nueva: 'cajera123', confirmacion: 'cajera123', username: 'cajera' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/común/);
    });

    it('rechaza contraseña igual al nombre de usuario', () => {
        const r = validarNuevaContrasena({ actual: 'x', nueva: 'Vendedora01', confirmacion: 'Vendedora01', username: 'vendedora01' });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/usuario/);
    });
});
