/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 💰 TESTS DE RESERVAS AGRUPADAS — reparto proporcional del abono inicial
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * splitProportional(amount, prices) reparte UN abono entre las prendas de un
 * grupo en proporción a su precio final. Invariante crítico para caja: la suma
 * de las porciones debe ser EXACTAMENTE el monto ingresado (cuadre al centavo),
 * ajustando el residuo del redondeo en la última prenda.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { splitProportional } from '../utils/reservationSplit';

const centSum = (arr) => arr.reduce((s, x) => Math.round((s + x) * 100) / 100, 0);

describe('splitProportional', () => {
    it('(1) suma exacta al centavo con precios que no dividen redondo (100 entre 388/200/150)', () => {
        const parts = splitProportional(100, [388, 200, 150]);

        expect(parts).toHaveLength(3);
        expect(centSum(parts)).toBe(100);
        // Cada porción está redondeada a 2 decimales
        parts.forEach(p => expect(p).toBe(Math.round(p * 100) / 100));
        // El reparto es aproximadamente proporcional (388/738 ≈ 52.6%)
        expect(parts[0]).toBeGreaterThan(parts[1]);
        expect(parts[1]).toBeGreaterThan(parts[2]);
    });

    it('(1b) residuo de redondeo se ajusta en la última prenda (100 entre 3 precios iguales)', () => {
        const parts = splitProportional(100, [100, 100, 100]);

        expect(parts[0]).toBe(33.33);
        expect(parts[1]).toBe(33.33);
        expect(parts[2]).toBe(33.34); // residuo de 1 centavo en la última
        expect(centSum(parts)).toBe(100);
    });

    it('(1c) cuadra al centavo con montos con decimales (75.50 entre 199.90/149.90)', () => {
        const parts = splitProportional(75.5, [199.9, 149.9]);
        expect(centSum(parts)).toBe(75.5);
    });

    it('(2) una sola prenda recibe todo el abono', () => {
        expect(splitProportional(80, [250])).toEqual([80]);
    });

    it('(3) abono igual al total deja saldo 0 en todas las prendas', () => {
        const prices = [388, 200, 150];
        const parts = splitProportional(738, prices);

        expect(parts).toEqual(prices); // cada prenda recibe exactamente su precio
        prices.forEach((price, i) => expect(price - parts[i]).toBe(0));
    });

    it('casos de guarda: lista vacía y precios en 0 no revientan', () => {
        expect(splitProportional(100, [])).toEqual([]);
        expect(splitProportional(100, [0, 0])).toEqual([0, 0]);
    });
});
