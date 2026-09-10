/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔄 TESTS DE EXPORTACIÓN DE STOCK — utils/syncExcel
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Lógica pura del respaldo Excel de stock. Se ejecuta en Node.js sin IndexedDB
 * ni XLSX:
 *  - filasStockParaExportar: filtra inactivos y productos sin shortCode.
 * La importación de ventas por Excel se retiró (sync v2 por eventos:
 * ver __tests__/syncV2.test.js).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { filasStockParaExportar } from '../utils/syncExcel';

// ──────────────────────────────────────────────────────────────────────────────
// filasStockParaExportar
// ──────────────────────────────────────────────────────────────────────────────

describe('filasStockParaExportar', () => {
    const products = [
        { id: 1, shortCode: '00001', name: 'Vestido Floral', size: 'M', color: 'Rojo', stock: 5, price: 150 },
        { id: 2, shortCode: '00002', name: 'Pantalón Jean', size: '32', color: 'Azul', stock: 0, active: false }, // inactivo
        { id: 3, shortCode: '', name: 'Blusa sin código', size: 'S', color: 'Blanco', stock: 3 },                 // sin shortCode
        { id: 4, shortCode: '00004', name: 'Falda Plisada', size: 'L', color: 'Negro', stock: 2.7, price: 89.9 }, // stock decimal
        { id: 5, name: 'Sin campo shortCode', stock: -4 },                                                        // sin shortCode + stock negativo
    ];

    it('exporta solo productos activos con shortCode, con stock entero ≥ 0 y precio', () => {
        const { filas } = filasStockParaExportar(products);
        expect(filas).toHaveLength(2);
        expect(filas[0]).toEqual({
            codigo: '00001', nombre: 'Vestido Floral', talla: 'M', color: 'Rojo', stock: 5, precio: 150, globalId: '',
        });
        // El stock decimal se sanea a entero
        expect(filas[1]).toEqual({
            codigo: '00004', nombre: 'Falda Plisada', talla: 'L', color: 'Negro', stock: 2, precio: 89.9, globalId: '',
        });
    });

    it('incluye el globalId del producto para el cruce por identidad estable', () => {
        const { filas } = filasStockParaExportar([
            { shortCode: '00020', name: 'Con globalId', size: 'S', color: 'Rojo', stock: 1, price: 10, globalId: 'uuid-abc-123' },
            { shortCode: '00021', name: 'Sin globalId', size: 'S', color: 'Rojo', stock: 1, price: 10 },
        ]);
        expect(filas[0].globalId).toBe('uuid-abc-123');
        expect(filas[1].globalId).toBe('');
    });

    it('precio inválido o ausente se sanea a 0', () => {
        const { filas } = filasStockParaExportar([
            { shortCode: '00010', name: 'Sin precio', stock: 1 },
            { shortCode: '00011', name: 'Precio texto', stock: 1, price: 'caro' },
            { shortCode: '00012', name: 'Precio negativo', stock: 1, price: -20 },
        ]);
        expect(filas.map(f => f.precio)).toEqual([0, 0, 0]);
    });

    it('devuelve aparte los activos sin shortCode para advertir', () => {
        const { sinCodigo } = filasStockParaExportar(products);
        expect(sinCodigo).toHaveLength(2);
        expect(sinCodigo.map(p => p.id)).toEqual([3, 5]);
    });

    it('con lista vacía devuelve ambos arrays vacíos', () => {
        expect(filasStockParaExportar([])).toEqual({ filas: [], sinCodigo: [] });
        expect(filasStockParaExportar()).toEqual({ filas: [], sinCodigo: [] });
    });
});
