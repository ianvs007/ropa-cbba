/**
 * Cobro en efectivo: un monto vacío o menor al total no puede registrar la venta.
 * El stock solo baja si validarCobro devuelve ok (el POS corta antes de la transacción).
 */

import { describe, it, expect } from 'vitest';
import { validarCobro, montoImpresoRecibido } from '../utils/cobro';

describe('validarCobro', () => {
    it('rechaza efectivo con monto vacío', () => {
        const r = validarCobro({ payment: 'efectivo', received: '', total: 25 });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/monto recibido/i);
    });

    it('rechaza efectivo con monto 0 cuando el total es mayor', () => {
        const r = validarCobro({ payment: 'efectivo', received: 0, total: 25 });
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/no alcanza/i);
    });

    it('rechaza el string 0 y el campo en blanco con espacios', () => {
        expect(validarCobro({ payment: 'efectivo', received: '0', total: 25 }).ok).toBe(false);
        expect(validarCobro({ payment: 'efectivo', received: '   ', total: 25 }).ok).toBe(false);
        expect(validarCobro({ payment: 'efectivo', received: null, total: 25 }).ok).toBe(false);
        expect(validarCobro({ payment: 'efectivo', received: undefined, total: 25 }).ok).toBe(false);
    });

    it('rechaza un monto positivo que no cubre el total', () => {
        const r = validarCobro({ payment: 'efectivo', received: '20', total: 25 });
        expect(r.ok).toBe(false);
    });

    it('acepta el monto exacto y calcula cambio 0', () => {
        const r = validarCobro({ payment: 'efectivo', received: '25', total: 25 });
        expect(r.ok).toBe(true);
        expect(r.received).toBe(25);
        expect(r.change).toBe(0);
    });

    it('acepta un monto mayor y calcula el cambio', () => {
        const r = validarCobro({ payment: 'efectivo', received: '30', total: 25 });
        expect(r.ok).toBe(true);
        expect(r.received).toBe(30);
        expect(r.change).toBe(5);
    });

    it('compara en centavos para no fallar por flotantes', () => {
        const r = validarCobro({ payment: 'efectivo', received: '10.10', total: 10.1 });
        expect(r.ok).toBe(true);
        expect(r.change).toBe(0);
    });

    it('rechaza montos que no son un número (texto, negativos)', () => {
        expect(validarCobro({ payment: 'efectivo', received: 'abc', total: 25 }).ok).toBe(false);
        expect(validarCobro({ payment: 'efectivo', received: -5, total: 25 }).ok).toBe(false);
    });

    it('el pago QR no exige monto recibido', () => {
        const r = validarCobro({ payment: 'qr', received: '', total: 25 });
        expect(r.ok).toBe(true);
        expect(r.received).toBe(25);
        expect(r.change).toBe(0);
    });

    it('un total 0 en efectivo sigue exigiendo un monto escrito (aunque sea 0)', () => {
        expect(validarCobro({ payment: 'efectivo', received: '', total: 0 }).ok).toBe(false);
        const r = validarCobro({ payment: 'efectivo', received: '0', total: 0 });
        expect(r.ok).toBe(true);
        expect(r.change).toBe(0);
    });
});

describe('montoImpresoRecibido', () => {
    it('un recibido 0 no se reimprime como si fuera el total', () => {
        expect(montoImpresoRecibido({ paymentMethod: 'efectivo', received: 0, total: 25 })).toBe(0);
    });

    it('si la venta vieja no trae recibido, usa el total', () => {
        expect(montoImpresoRecibido({ paymentMethod: 'efectivo', total: 25 })).toBe(25);
    });

    it('conserva el recibido real', () => {
        expect(montoImpresoRecibido({ paymentMethod: 'efectivo', received: 30, total: 25 })).toBe(30);
    });
});
