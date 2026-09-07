/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🏷️ TESTS DE ALINEACIÓN DE CÓDIGOS (producto = etiqueta) — utils/alinearCodigosEtiqueta
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Contexto: el POS maneja DOS numeraciones de 5 dígitos en el mismo espacio —
 * products.shortCode (por modelo; es el `codigo` que publica la tienda virtual) y
 * barcodes[].shortCode (por prenda física; es lo que imprime la etiqueta).
 * generateBarcodesForProduct asigna max+1 salteándose los códigos ya usados, así
 * que la etiqueta nunca coincide con el código web. El POS no lo sufre porque
 * findProductByBarcode resuelve ambas tablas; la web sólo conoce la de productos.
 *
 * Regla de negocio (decisión de Alain): en una PRENDA ÚNICA mandan las etiquetas
 * ya impresas → el shortCode del producto pasa a ser el de su única unidad.
 *
 * La lógica es PURA (sin IndexedDB ni DOM), así que los tests importan las
 * funciones reales — mismo patrón que duplicateShortCodes.test.js. Los datos de
 * los fixtures son casos reales del dump del 04/09/2026 (02418/02923, 01053,
 * 02336/02337, 00001 x4).
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { planificarAlineacionEtiquetas, aplicarPlanEnSeco } from '../utils/alinearCodigosEtiqueta';

const RESUMEN_VACIO = {
    productos: 0,
    prendasUnicas: 0,
    yaAlineadas: 0,
    alineadas: 0,
    desalojadas: 0,
    bloqueadas: 0,
    sinUnidades: 0,
    variasUnidades: 0,
    sinCodigoDeUnidad: 0,
};

// ──────────────────────────────────────────────────────────────────────────────
// alineación simple
// ──────────────────────────────────────────────────────────────────────────────

describe('planificarAlineacionEtiquetas — alineación simple', () => {

    it('el producto adopta el código impreso en su única etiqueta', () => {
        // Caso real: la etiqueta 02418 es de la FALDA TABLEADO cuyo producto es 02923
        const products = [{ id: 90, name: 'FALDA TABLEADO', shortCode: '02923' }];
        const barcodes = [{ id: 500, productId: 90, shortCode: '02418', used: false }];

        const { reasignaciones, bloqueos, resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([
            { id: 90, name: 'FALDA TABLEADO', codigoAnterior: '02923', codigoNuevo: '02418', motivo: 'alineacion' },
        ]);
        expect(bloqueos).toEqual([]);
        expect(resumen).toEqual({ ...RESUMEN_VACIO, productos: 1, prendasUnicas: 1, alineadas: 1 });
    });

    it('no toca la prenda única que ya está alineada', () => {
        const products = [{ id: 1, name: 'VESTIDO LARGO', shortCode: '00019' }];
        const barcodes = [{ id: 9, productId: 1, shortCode: '00019' }];

        const { reasignaciones, resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([]);
        expect(resumen.yaAlineadas).toBe(1);
        expect(resumen.prendasUnicas).toBe(1);
    });

    it('un producto sin shortCode gana el de su etiqueta (hoy no sincroniza a la web)', () => {
        const products = [{ id: 1, name: 'TOP CUERO', shortCode: '' }];
        const barcodes = [{ id: 9, productId: 1, shortCode: '03431' }];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([
            { id: 1, name: 'TOP CUERO', codigoAnterior: '', codigoNuevo: '03431', motivo: 'alineacion' },
        ]);
    });

    it('incluye productos archivados (un archivado puede reactivarse)', () => {
        // Mismo criterio que agruparDuplicadosProductos
        const products = [{ id: 1, name: 'CHAMARRA', shortCode: '02253', active: false }];
        const barcodes = [{ id: 9, productId: 1, shortCode: '02260' }];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones[0].codigoNuevo).toBe('02260');
    });

    it('alineaciones con la etiqueta ya vendida igual se aplican (el código es de la prenda, no del stock)', () => {
        const products = [{ id: 1, name: 'VESTIDO BRILLO', shortCode: '02786' }];
        const barcodes = [{ id: 9, productId: 1, shortCode: '02797', used: true }];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones[0].codigoNuevo).toBe('02797');
    });

    it('devuelve las reasignaciones ordenadas por id aunque la entrada venga desordenada', () => {
        const products = [
            { id: 80, name: 'B', shortCode: '00080' },
            { id: 20, name: 'A', shortCode: '00020' },
        ];
        const barcodes = [
            { id: 2, productId: 80, shortCode: '00500' },
            { id: 1, productId: 20, shortCode: '00400' },
        ];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones.map(r => r.id)).toEqual([20, 80]);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// qué queda excluido
// ──────────────────────────────────────────────────────────────────────────────

describe('planificarAlineacionEtiquetas — exclusiones', () => {

    it('un producto con varias unidades no es alineable (tiene un código y N etiquetas)', () => {
        const products = [{ id: 1, name: 'FALDA TABLE', shortCode: '00033' }];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00033' },
            { id: 12, productId: 1, shortCode: '00034' },
            { id: 13, productId: 1, shortCode: '00035' },
        ];

        const { reasignaciones, resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([]);
        expect(resumen).toMatchObject({ variasUnidades: 1, prendasUnicas: 0 });
    });

    it('un producto sin unidades no es alineable', () => {
        const products = [{ id: 1, name: 'POLERA', shortCode: '00001' }];

        const { reasignaciones, resumen } = planificarAlineacionEtiquetas(products, []);

        expect(reasignaciones).toEqual([]);
        expect(resumen.sinUnidades).toBe(1);
    });

    it('una prenda única cuya unidad no tiene código corto no se toca', () => {
        const products = [{ id: 1, name: 'BLUSA', shortCode: '00005' }];
        const barcodes = [{ id: 11, productId: 1 }];

        const { reasignaciones, resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([]);
        expect(resumen).toMatchObject({ prendasUnicas: 1, sinCodigoDeUnidad: 1 });
    });

    it('con listas vacías o ausentes devuelve un plan vacío', () => {
        expect(planificarAlineacionEtiquetas([], [])).toEqual({
            reasignaciones: [], bloqueos: [], resumen: RESUMEN_VACIO,
        });
        expect(planificarAlineacionEtiquetas().reasignaciones).toEqual([]);
        expect(planificarAlineacionEtiquetas([{ id: 1, shortCode: '00001' }]).resumen.sinUnidades).toBe(1);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// desalojo: el código de la etiqueta lo tiene otro producto
// ──────────────────────────────────────────────────────────────────────────────

describe('planificarAlineacionEtiquetas — desalojo del ocupante', () => {

    it('mueve a un código nuevo al producto que sólo tiene ese número en la web', () => {
        // Caso real 01053: dos CHALECO FRISA; el 02954 es prenda única con etiqueta
        // 01053, y el 01053 tiene varias unidades (su número sólo vive en la web).
        const products = [
            { id: 50, name: 'CHALECO FRISA', shortCode: '01053' },
            { id: 90, name: 'CHALECO FRISA', shortCode: '02954' },
        ];
        const barcodes = [
            { id: 1, productId: 90, shortCode: '01053' },
            { id: 2, productId: 50, shortCode: '00700' },
            { id: 3, productId: 50, shortCode: '00701' },
        ];

        const { reasignaciones, resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([
            { id: 50, name: 'CHALECO FRISA', codigoAnterior: '01053', codigoNuevo: '02955', motivo: 'desalojo' },
            { id: 90, name: 'CHALECO FRISA', codigoAnterior: '02954', codigoNuevo: '01053', motivo: 'alineacion' },
        ]);
        expect(resumen).toMatchObject({ alineadas: 1, desalojadas: 1 });
    });

    it('el código nuevo es max+1 de products ∪ barcodes (mismo criterio que generateShortCode)', () => {
        const products = [
            { id: 1, name: 'OCUPANTE', shortCode: '00050' },
            { id: 2, name: 'PRENDA', shortCode: '00060' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00051' },
            { id: 12, productId: 1, shortCode: '00052' },
            { id: 13, productId: 2, shortCode: '00050' },
        ];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);
        const desalojo = reasignaciones.find(r => r.motivo === 'desalojo');

        // el máximo global está en barcodes (00060) → 00061
        expect(desalojo.codigoNuevo).toBe('00061');
    });

    it('no rellena huecos libres: un hueco puede ser una etiqueta vieja ya impresa', () => {
        const products = [
            { id: 1, name: 'OCUPANTE', shortCode: '00050' },
            { id: 2, name: 'PRENDA', shortCode: '00060' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00051' },
            { id: 12, productId: 1, shortCode: '00052' },
            { id: 13, productId: 2, shortCode: '00050' },
        ];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);
        const desalojo = reasignaciones.find(r => r.motivo === 'desalojo');

        // 00001..00049 están libres, pero el desalojo no los usa
        expect(parseInt(desalojo.codigoNuevo, 10)).toBeGreaterThan(60);
    });

    it('resuelve una cadena de tres sin códigos temporales', () => {
        // 1 (varias unidades) ocupa 00010 que quiere 2; 2 ocupa 00020 que quiere 3.
        const products = [
            { id: 1, name: 'A', shortCode: '00010' },
            { id: 2, name: 'B', shortCode: '00020' },
            { id: 3, name: 'C', shortCode: '00030' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00011' },
            { id: 12, productId: 1, shortCode: '00012' },
            { id: 13, productId: 2, shortCode: '00010' },
            { id: 14, productId: 3, shortCode: '00020' },
        ];

        const { reasignaciones } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([
            { id: 1, name: 'A', codigoAnterior: '00010', codigoNuevo: '00031', motivo: 'desalojo' },
            { id: 2, name: 'B', codigoAnterior: '00020', codigoNuevo: '00010', motivo: 'alineacion' },
            { id: 3, name: 'C', codigoAnterior: '00030', codigoNuevo: '00020', motivo: 'alineacion' },
        ]);
    });

    it('resuelve un intercambio (ciclo de dos) sin código temporal', () => {
        // Caso real 02336/02337: dos VESTIDO JEANS con las etiquetas cruzadas.
        const products = [
            { id: 1, name: 'VESTIDO JEANS', shortCode: '02336' },
            { id: 2, name: 'ENSERIZO 2PZ', shortCode: '02337' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '02337' },
            { id: 12, productId: 2, shortCode: '02336' },
        ];

        const { reasignaciones, bloqueos } = planificarAlineacionEtiquetas(products, barcodes);

        expect(bloqueos).toEqual([]);
        expect(reasignaciones).toEqual([
            { id: 1, name: 'VESTIDO JEANS', codigoAnterior: '02336', codigoNuevo: '02337', motivo: 'alineacion' },
            { id: 2, name: 'ENSERIZO 2PZ', codigoAnterior: '02337', codigoNuevo: '02336', motivo: 'alineacion' },
        ]);
        // shortCode NO es índice único en Dexie: el intercambio se puede aplicar
        // dentro de una transacción aunque el estado intermedio repita un código.
        const finales = aplicarPlanEnSeco(products, { reasignaciones }).map(p => p.shortCode);
        expect(new Set(finales).size).toBe(finales.length);
    });

    it('dos prendas que piden el mismo código se bloquean en vez de pelear por él', () => {
        const products = [
            { id: 1, name: 'OCUPANTE', shortCode: '00050' },
            { id: 2, name: 'PRENDA A', shortCode: '00060' },
            { id: 3, name: 'PRENDA B', shortCode: '00070' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00051' },
            { id: 12, productId: 1, shortCode: '00052' },
            { id: 13, productId: 2, shortCode: '00050' },
            { id: 14, productId: 3, shortCode: '00050' }, // misma etiqueta que el 2 → duplicada
        ];

        const { reasignaciones, bloqueos } = planificarAlineacionEtiquetas(products, barcodes);

        // las dos prendas piden 00050: es una etiqueta duplicada, se bloquean ambas
        expect(bloqueos).toHaveLength(2);
        expect(reasignaciones).toEqual([]);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// bloqueos por precondiciones
// ──────────────────────────────────────────────────────────────────────────────

describe('planificarAlineacionEtiquetas — bloqueos', () => {

    it('dos prendas físicas con el mismo número impreso se bloquean (fixMissingShortCodes primero)', () => {
        // Caso real: en el dump del 04/09 el código 00001 está impreso 4 veces.
        const products = [
            { id: 1, name: 'VESTIDO M/LARGA', shortCode: '00001' },
            { id: 2, name: 'CADENA', shortCode: '02187' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00001' },
            { id: 12, productId: 2, shortCode: '00001' },
        ];

        const { reasignaciones, bloqueos, resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([]);
        expect(bloqueos).toEqual([
            { id: 2, name: 'CADENA', codigo: '00001', motivo: 'etiqueta-duplicada' },
        ]);
        expect(resumen).toMatchObject({ prendasUnicas: 2, yaAlineadas: 1, bloqueadas: 1 });
    });

    it('si el código deseado lo tienen 2+ productos, se bloquea (fixDuplicateProductShortCodes primero)', () => {
        const products = [
            { id: 1, name: 'CONJT DEPORT 2PZ', shortCode: '00075' },
            { id: 2, name: 'BODY', shortCode: '00075' },
            { id: 3, name: 'POLERA', shortCode: '00300' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00070' },
            { id: 12, productId: 1, shortCode: '00071' },
            { id: 13, productId: 2, shortCode: '00080' },
            { id: 14, productId: 2, shortCode: '00081' },
            { id: 15, productId: 3, shortCode: '00075' },
        ];

        const { reasignaciones, bloqueos } = planificarAlineacionEtiquetas(products, barcodes);

        expect(reasignaciones).toEqual([]);
        expect(bloqueos).toEqual([
            { id: 3, name: 'POLERA', codigo: '00075', motivo: 'codigo-duplicado' },
        ]);
    });

    it('lanza error si desalojar exigiría pasar de 99,999 códigos', () => {
        const products = [
            { id: 1, name: 'OCUPANTE', shortCode: '99999' },
            { id: 2, name: 'PRENDA', shortCode: '00002' },
        ];
        const barcodes = [
            { id: 11, productId: 1, shortCode: '00001' },
            { id: 12, productId: 1, shortCode: '00003' },
            { id: 13, productId: 2, shortCode: '99999' },
        ];

        expect(() => planificarAlineacionEtiquetas(products, barcodes)).toThrow('99,999');
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// invariante sobre un catálogo mezclado
// ──────────────────────────────────────────────────────────────────────────────

describe('planificarAlineacionEtiquetas — invariante de unicidad', () => {

    // Mezcla todo: ya alineada, multi-unidad, libre, desalojo, sin código y bloqueos.
    const products = [
        { id: 1, name: 'VESTIDO M/LARGA', shortCode: '00001' },
        { id: 2, name: 'FALDA TABLE', shortCode: '00033' },
        { id: 3, name: 'CADENA', shortCode: '02187' },
        { id: 4, name: 'CHALECO FRISA', shortCode: '01053' },
        { id: 5, name: 'CHALECO FRISA', shortCode: '02954' },
        { id: 6, name: 'TOP CUERO', shortCode: '' },
        { id: 7, name: 'BODY', shortCode: '00074' },
        { id: 8, name: 'CONJT DEPORT', shortCode: '00076' },
    ];
    const barcodes = [
        { id: 11, productId: 1, shortCode: '00001' },
        { id: 12, productId: 2, shortCode: '00033' },
        { id: 13, productId: 2, shortCode: '00034' },
        { id: 14, productId: 2, shortCode: '00035' },
        { id: 15, productId: 3, shortCode: '03100' },
        { id: 16, productId: 4, shortCode: '00700' },
        { id: 17, productId: 4, shortCode: '00701' },
        { id: 18, productId: 5, shortCode: '01053' },
        { id: 19, productId: 6, shortCode: '03431' },
        { id: 20, productId: 7, shortCode: '00075' },
        { id: 21, productId: 8, shortCode: '00075' },
    ];

    it('los códigos finales son únicos entre productos (la nube tiene idx_products_codigo UNIQUE)', () => {
        const plan = planificarAlineacionEtiquetas(products, barcodes);
        const finales = aplicarPlanEnSeco(products, plan).map(p => p.shortCode).filter(Boolean);

        expect(new Set(finales).size).toBe(finales.length);
    });

    it('toda prenda única no bloqueada termina con el código de su etiqueta', () => {
        const plan = planificarAlineacionEtiquetas(products, barcodes);
        const finales = new Map(aplicarPlanEnSeco(products, plan).map(p => [p.id, p.shortCode]));
        const bloqueadas = new Set(plan.bloqueos.map(b => b.id));

        for (const p of products) {
            const propias = barcodes.filter(b => b.productId === p.id);
            if (propias.length !== 1 || !propias[0].shortCode || bloqueadas.has(p.id)) continue;
            expect(finales.get(p.id), `producto ${p.id} (${p.name})`).toBe(propias[0].shortCode);
        }
    });

    it('cuenta cada situación en el resumen', () => {
        const { resumen } = planificarAlineacionEtiquetas(products, barcodes);

        expect(resumen).toEqual({
            productos: 8,
            prendasUnicas: 6,   // 1, 3, 5, 6, 7, 8
            yaAlineadas: 1,      // 1
            alineadas: 3,        // 3, 5, 6
            desalojadas: 1,      // 4
            bloqueadas: 2,       // 7 y 8, etiqueta 00075 repetida
            sinUnidades: 0,
            variasUnidades: 2,   // 2 y 4
            sinCodigoDeUnidad: 0,
        });
    });

    it('los códigos nuevos no pisan ni un código existente ni una etiqueta reservada', () => {
        const plan = planificarAlineacionEtiquetas(products, barcodes);
        const ocupados = new Set([
            ...products.map(p => p.shortCode).filter(Boolean),
            ...barcodes.map(b => b.shortCode).filter(Boolean),
        ]);

        for (const r of plan.reasignaciones.filter(r => r.motivo === 'desalojo')) {
            expect(ocupados.has(r.codigoNuevo), `${r.codigoNuevo} ya estaba ocupado`).toBe(false);
        }
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// aplicarPlanEnSeco
// ──────────────────────────────────────────────────────────────────────────────

describe('aplicarPlanEnSeco (previsualización sin tocar la BD)', () => {

    it('no muta los productos de entrada', () => {
        const products = [{ id: 1, name: 'A', shortCode: '00010' }];
        const barcodes = [{ id: 11, productId: 1, shortCode: '00020' }];
        const plan = planificarAlineacionEtiquetas(products, barcodes);

        aplicarPlanEnSeco(products, plan);

        expect(products[0].shortCode).toBe('00010');
    });

    it('con un plan vacío devuelve los mismos códigos', () => {
        const products = [{ id: 1, name: 'A', shortCode: '00010' }];

        expect(aplicarPlanEnSeco(products, { reasignaciones: [] })).toEqual(products);
    });
});
