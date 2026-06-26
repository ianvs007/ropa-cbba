/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🧪 TESTS DE DETECCIÓN DE COLOR — Tienda de Ropas
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Verifican la lógica pura de mapeo de color (sin canvas ni cámara):
 *   - nearestPaletteColor: un RGB → el color más cercano del catálogo.
 *   - nearestPaletteColors: un RGB → top-N ordenado por cercanía.
 *   - COLOR_PALETTE: invariantes de la paleta (nombres únicos, RGB válidos).
 *
 * Las funciones de muestreo de píxeles (averageCentralColor, detectColor*)
 * requieren un ImageData/canvas real del navegador, por lo que NO se prueban
 * aquí; se validan manualmente en uso real (Fase 5, parte A).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
    COLOR_PALETTE,
    nearestPaletteColor,
    nearestPaletteColors,
} from '../utils/colorDetection';

// ──────────────────────────────────────────────────────────────────────────────
// Helper: obtiene el RGB exacto de un color de la paleta por nombre.
// ──────────────────────────────────────────────────────────────────────────────
const rgbOf = (name) => COLOR_PALETTE.find(c => c.name === name).rgb;

describe('COLOR_PALETTE — invariantes', () => {
    it('no tiene nombres duplicados', () => {
        const names = COLOR_PALETTE.map(c => c.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('todos los RGB son válidos (3 canales, 0..255)', () => {
        for (const { name, rgb } of COLOR_PALETTE) {
            expect(rgb, name).toHaveLength(3);
            for (const ch of rgb) {
                expect(ch).toBeGreaterThanOrEqual(0);
                expect(ch).toBeLessThanOrEqual(255);
            }
        }
    });

    it('contiene los colores base esperados', () => {
        const names = COLOR_PALETTE.map(c => c.name);
        for (const base of ['NEGRO', 'BLANCO', 'ROJO', 'AZUL', 'VERDE', 'AMARILLO']) {
            expect(names).toContain(base);
        }
    });
});

describe('nearestPaletteColor — coincidencia exacta', () => {
    it('un RGB idéntico al de la paleta devuelve ese mismo color', () => {
        for (const { name, rgb } of COLOR_PALETTE) {
            expect(nearestPaletteColor(rgb).name, name).toBe(name);
        }
    });

    it('la confianza de una coincidencia exacta es 1', () => {
        const res = nearestPaletteColor(rgbOf('ROJO'));
        expect(res.confidence).toBeCloseTo(1, 5);
        expect(res.distance).toBeCloseTo(0, 5);
    });
});

describe('nearestPaletteColor — colores aproximados', () => {
    it('un rojo intenso aproximado mapea a ROJO', () => {
        expect(nearestPaletteColor([210, 25, 35]).name).toBe('ROJO');
    });

    it('un casi-negro mapea a NEGRO', () => {
        expect(nearestPaletteColor([12, 14, 10]).name).toBe('NEGRO');
    });

    it('un casi-blanco mapea a BLANCO', () => {
        expect(nearestPaletteColor([250, 248, 252]).name).toBe('BLANCO');
    });

    it('un amarillo brillante mapea a AMARILLO', () => {
        expect(nearestPaletteColor([245, 220, 60]).name).toBe('AMARILLO');
    });

    it('un verde medio mapea a VERDE', () => {
        expect(nearestPaletteColor([45, 145, 75]).name).toBe('VERDE');
    });
});

describe('nearestPaletteColors — top-N', () => {
    it('devuelve exactamente N resultados', () => {
        expect(nearestPaletteColors([100, 100, 100], 2)).toHaveLength(2);
        expect(nearestPaletteColors([100, 100, 100], 3)).toHaveLength(3);
    });

    it('al menos devuelve 1 aunque se pida 0', () => {
        expect(nearestPaletteColors([0, 0, 0], 0).length).toBeGreaterThanOrEqual(1);
    });

    it('están ordenados de más cercano a menos cercano', () => {
        const res = nearestPaletteColors([90, 115, 145], 3);
        expect(res[0].distance).toBeLessThanOrEqual(res[1].distance);
        expect(res[1].distance).toBeLessThanOrEqual(res[2].distance);
    });

    it('el primero coincide con nearestPaletteColor (singular)', () => {
        const rgb = [70, 100, 160];
        expect(nearestPaletteColors(rgb, 2)[0].name).toBe(nearestPaletteColor(rgb).name);
    });

    it('un azul grisáceo ofrece AZUL GRISACEO entre sus top-2', () => {
        // Caso real que motivó la mejora: tono frontera azul/gris.
        const top2 = nearestPaletteColors([95, 120, 150], 2).map(c => c.name);
        expect(top2).toContain('AZUL GRISACEO');
    });
});
