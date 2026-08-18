/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔍 TESTS DE CÓDIGOS CORTOS DUPLICADOS EN PRODUCTS — utils/duplicateShortCodes
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Contexto del bug: el shortCode se pre-genera al ABRIR el formulario de nueva
 * prenda (ProductList.openNew), así que dos pestañas abiertas generan el mismo
 * código y ambas pueden guardarlo → dos prendas distintas con el mismo código
 * de 5 dígitos que cruzan la información en la tienda online
 * (products.codigo = shortCode del POS).
 *
 * La lógica es PURA (sin IndexedDB ni DOM), así que los tests importan las
 * funciones reales — mismo patrón que syncExcel.test.js:
 *  - agruparDuplicadosProductos: núcleo de findDuplicateProductShortCodes()
 *    (db/helpers.js).
 *  - planificarReasignacionDuplicados: núcleo de fixDuplicateProductShortCodes()
 *    (db/helpers.js, que lo aplica en UNA transacción Dexie).
 *  - codigosDuplicadosEnFilas (utils/syncExcel): bloqueo de la sync/exportación
 *    en Sync.jsx cuando las filas de stock traen un código repetido.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { agruparDuplicadosProductos, planificarReasignacionDuplicados } from '../utils/duplicateShortCodes';
import { codigosDuplicadosEnFilas, filasStockParaExportar } from '../utils/syncExcel';

// ──────────────────────────────────────────────────────────────────────────────
// agruparDuplicadosProductos
// ──────────────────────────────────────────────────────────────────────────────

describe('agruparDuplicadosProductos (núcleo de findDuplicateProductShortCodes)', () => {

    it('sin duplicados devuelve lista vacía', () => {
        const products = [
            { id: 1, name: 'POLERA', shortCode: '00001', active: true },
            { id: 2, name: 'JEAN', shortCode: '00002', active: true },
        ];
        expect(agruparDuplicadosProductos(products)).toEqual([]);
    });

    it('detecta el grupo duplicado con los datos de ambas prendas', () => {
        // Caso real de producción: 00075 llegó como "CONJT DEPORT 2PZ" y "BODY"
        const products = [
            { id: 10, name: 'CONJT DEPORT 2PZ', shortCode: '00075', size: 'M', color: 'NEGRO', active: true },
            { id: 25, name: 'BODY', shortCode: '00075', size: 'S', color: 'ROJO', active: true },
            { id: 30, name: 'POLERA', shortCode: '00076', active: true },
        ];
        const grupos = agruparDuplicadosProductos(products);
        expect(grupos).toHaveLength(1);
        expect(grupos[0].shortCode).toBe('00075');
        expect(grupos[0].products).toEqual([
            { id: 10, name: 'CONJT DEPORT 2PZ', size: 'M', color: 'NEGRO', active: true },
            { id: 25, name: 'BODY', size: 'S', color: 'ROJO', active: true },
        ]);
    });

    it('incluye productos archivados (un duplicado archivado puede reactivarse)', () => {
        const products = [
            { id: 1, name: 'CHAMARRA', shortCode: '02253', active: false },
            { id: 2, name: 'BLAISER VESTIDO', shortCode: '02253', active: true },
        ];
        const grupos = agruparDuplicadosProductos(products);
        expect(grupos).toHaveLength(1);
        expect(grupos[0].products[0].active).toBe(false);
    });

    it('ordena los productos del grupo por id ascendente (el menor id es el más antiguo)', () => {
        const products = [
            { id: 50, name: 'NUEVO', shortCode: '00010' },
            { id: 7, name: 'ANTIGUO', shortCode: '00010' },
            { id: 33, name: 'MEDIO', shortCode: '00010' },
        ];
        const grupos = agruparDuplicadosProductos(products);
        expect(grupos[0].products.map(p => p.id)).toEqual([7, 33, 50]);
    });

    it('ignora códigos vacíos o ausentes (no son duplicados entre sí)', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '' },
            { id: 2, name: 'B' },
            { id: 3, name: 'C', shortCode: null },
            { id: 4, name: 'D', shortCode: '   ' },
        ];
        expect(agruparDuplicadosProductos(products)).toEqual([]);
    });

    it('detecta varios grupos a la vez, ordenados por código', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '02253' },
            { id: 2, name: 'B', shortCode: '00075' },
            { id: 3, name: 'C', shortCode: '02253' },
            { id: 4, name: 'D', shortCode: '00075' },
        ];
        const grupos = agruparDuplicadosProductos(products);
        expect(grupos.map(g => g.shortCode)).toEqual(['00075', '02253']);
    });

    it('con lista vacía devuelve lista vacía', () => {
        expect(agruparDuplicadosProductos([])).toEqual([]);
        expect(agruparDuplicadosProductos()).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// planificarReasignacionDuplicados
// ──────────────────────────────────────────────────────────────────────────────

describe('planificarReasignacionDuplicados (núcleo de fixDuplicateProductShortCodes)', () => {

    it('conserva el código en el producto de menor id y reasigna al otro con max+1', () => {
        const products = [
            { id: 10, name: 'CONJT DEPORT 2PZ', shortCode: '00075' },
            { id: 25, name: 'BODY', shortCode: '00075' },
            { id: 30, name: 'OTRO', shortCode: '00120' }, // max actual
        ];
        const barcodes = [];
        const reasignaciones = planificarReasignacionDuplicados(products, barcodes);
        expect(reasignaciones).toEqual([
            { id: 25, name: 'BODY', codigoAnterior: '00075', codigoNuevo: '00121' },
        ]);
    });

    it('considera los códigos de barcodes al calcular el máximo (products ∪ barcodes)', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '00001' },
            { id: 2, name: 'B', shortCode: '00001' },
        ];
        const barcodes = [
            { id: 99, productId: 1, shortCode: '00050' }, // la mayor está en barcodes
        ];
        const reasignaciones = planificarReasignacionDuplicados(products, barcodes);
        expect(reasignaciones[0].codigoNuevo).toBe('00051');
    });

    it('con 3 productos en un grupo conserva el primero y reasigna a los otros dos', () => {
        const products = [
            { id: 5, name: 'ANTIGUO', shortCode: '00010' },
            { id: 8, name: 'MEDIO', shortCode: '00010' },
            { id: 9, name: 'NUEVO', shortCode: '00010' },
        ];
        const reasignaciones = planificarReasignacionDuplicados(products, []);
        expect(reasignaciones).toEqual([
            { id: 8, name: 'MEDIO', codigoAnterior: '00010', codigoNuevo: '00011' },
            { id: 9, name: 'NUEVO', codigoAnterior: '00010', codigoNuevo: '00012' },
        ]);
    });

    it('los códigos nuevos nunca colisionan entre grupos ni con códigos existentes', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '00075' },
            { id: 2, name: 'B', shortCode: '00075' },
            { id: 3, name: 'C', shortCode: '02253' },
            { id: 4, name: 'D', shortCode: '02253' },
            { id: 5, name: 'MAX', shortCode: '09999' },
        ];
        const reasignaciones = planificarReasignacionDuplicados(products, []);
        expect(reasignaciones.map(r => r.codigoNuevo)).toEqual(['10000', '10001']);
        // Todos los códigos resultantes (conservados + reasignados) son únicos
        const finales = new Set();
        for (const p of products) {
            const re = reasignaciones.find(r => r.id === p.id);
            finales.add(re ? re.codigoNuevo : p.shortCode);
        }
        expect(finales.size).toBe(products.length);
    });

    it('rellena con ceros a la izquierda hasta 5 dígitos', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '00005' },
            { id: 2, name: 'B', shortCode: '00005' },
        ];
        const reasignaciones = planificarReasignacionDuplicados(products, []);
        expect(reasignaciones[0].codigoNuevo).toBe('00006');
    });

    it('sin duplicados no reasigna nada', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '00001' },
            { id: 2, name: 'B', shortCode: '00002' },
        ];
        expect(planificarReasignacionDuplicados(products, [])).toEqual([]);
    });

    it('ignora códigos no numéricos o fuera de rango al calcular el máximo', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '00007' },
            { id: 2, name: 'B', shortCode: '00007' },
            { id: 3, name: 'RARO', shortCode: 'ABC' },     // no numérico
            { id: 4, name: 'GRANDE', shortCode: '999999' }, // fuera de rango (> 99999)
        ];
        const reasignaciones = planificarReasignacionDuplicados(products, []);
        expect(reasignaciones[0].codigoNuevo).toBe('00008');
    });

    it('lanza error si se agota el espacio de 99,999 códigos', () => {
        const products = [
            { id: 1, name: 'A', shortCode: '99999' },
            { id: 2, name: 'B', shortCode: '99999' },
        ];
        expect(() => planificarReasignacionDuplicados(products, []))
            .toThrow('99,999');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// codigosDuplicadosEnFilas (bloqueo de sync/exportación en Sync.jsx)
// ──────────────────────────────────────────────────────────────────────────────

describe('codigosDuplicadosEnFilas (bloqueo antes de sincronizar/exportar)', () => {

    it('filas sin códigos repetidos no bloquean', () => {
        const { filas } = filasStockParaExportar([
            { id: 1, shortCode: '00001', name: 'A', stock: 1, price: 100 },
            { id: 2, shortCode: '00002', name: 'B', stock: 1, price: 100 },
        ]);
        expect(codigosDuplicadosEnFilas(filas)).toEqual([]);
    });

    it('un código repetido en 2+ filas genera un grupo con ambas prendas', () => {
        const { filas } = filasStockParaExportar([
            { id: 1, shortCode: '00075', name: 'CONJT DEPORT 2PZ', size: 'M', color: 'NEGRO', stock: 1, price: 100 },
            { id: 2, shortCode: '00075', name: 'BODY', size: 'S', color: 'ROJO', stock: 2, price: 80 },
            { id: 3, shortCode: '00076', name: 'POLERA', stock: 3, price: 50 },
        ]);
        const dups = codigosDuplicadosEnFilas(filas);
        expect(dups).toHaveLength(1);
        expect(dups[0].codigo).toBe('00075');
        expect(dups[0].filas.map(f => f.nombre)).toEqual(['CONJT DEPORT 2PZ', 'BODY']);
    });

    it('ignora filas sin código y tolera listas vacías', () => {
        expect(codigosDuplicadosEnFilas([])).toEqual([]);
        expect(codigosDuplicadosEnFilas()).toEqual([]);
        expect(codigosDuplicadosEnFilas([{ codigo: '' }, {}])).toEqual([]);
    });
});
