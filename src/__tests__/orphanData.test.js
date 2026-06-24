/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🧪 TESTS DE DATOS HUÉRFANOS — Tienda de Ropas
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * Estos tests verifican la integridad referencial de toda la base de datos.
 * Las funciones de detección son puras (reciben arrays, no tocan IndexedDB),
 * por lo que se ejecutan en Node.js sin necesidad de browser.
 *
 * Relaciones cubiertas:
 *   barcodes.productId        → products.id
 *   kardex.productId          → products.id
 *   reservations.productId    → products.id
 *   reservationPayments.reservationId → reservations.id
 *   sales.items[].productId   → products.id
 *   expenses.categoryId       → expenseCategories.id
 *   cashClosureHistory.closureId → cashClosures.id
 *   securityLogs              → sin huérfanos posibles (standalone)
 *
 * Integridad de unicidad:
 *   products.shortCode        → único en toda la tabla
 *   barcodes.shortCode        → único en toda la tabla
 *   products.barcode          → único en toda la tabla
 *   barcodes.barcode          → único en toda la tabla
 *   shortCode colisión inter-tablas (products ∩ barcodes)
 *
 * Invariantes de negocio:
 *   products.stock            ≥ 0
 *   sales.total               > 0
 *   sales                     con items
 *   reservationPayments.amount > 0
 *   barcodes.productId        es número (no string)
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// FUNCIONES DE DETECCIÓN PURAS
// Mismas reglas que checkDataIntegrity() en audit.js, pero expresadas como
// funciones puras para ser testables unitariamente sin IndexedDB.
// ──────────────────────────────────────────────────────────────────────────────

/** Barcodes cuyos productId no corresponden a ningún producto existente */
function findOrphanBarcodes(barcodes, products) {
    const ids = new Set(products.map(p => p.id));
    return barcodes.filter(b => !ids.has(b.productId));
}

/** Entradas de kardex sin producto padre */
function findOrphanKardex(kardex, products) {
    const ids = new Set(products.map(p => p.id));
    return kardex.filter(k => !ids.has(k.productId));
}

/** Reservas cuyo producto referenciado no existe */
function findOrphanReservations(reservations, products) {
    const ids = new Set(products.map(p => p.id));
    return reservations.filter(r => !ids.has(r.productId));
}

/** Pagos de reserva sin reserva padre */
function findOrphanReservationPayments(payments, reservations) {
    const ids = new Set(reservations.map(r => r.id));
    return payments.filter(p => !ids.has(p.reservationId));
}

/** Items de venta cuyo productId no existe */
function findOrphanSaleItems(sales, products) {
    const ids = new Set(products.map(p => p.id));
    return sales.flatMap(s =>
        (s.items || [])
            .filter(item => !ids.has(item.productId))
            .map(item => ({ saleId: s.id, orphanProductId: item.productId }))
    );
}

/** Gastos cuya categoryId no existe */
function findOrphanExpenses(expenses, expenseCategories) {
    const ids = new Set(expenseCategories.map(c => c.id));
    return expenses.filter(e => e.categoryId !== undefined && e.categoryId !== null && !ids.has(e.categoryId));
}

/** Historial de cierres cuyo closureId no existe */
function findOrphanCashClosureHistory(history, cashClosures) {
    const ids = new Set(cashClosures.map(c => c.id));
    return history.filter(h => !ids.has(h.closureId));
}

/** ShortCodes duplicados dentro de la tabla products */
function findDuplicateProductShortCodes(products) {
    const shortCodes = products.map(p => p.shortCode).filter(Boolean);
    return shortCodes.filter((code, idx) => shortCodes.indexOf(code) !== idx);
}

/** ShortCodes duplicados dentro de la tabla barcodes */
function findDuplicateBarcodeShortCodes(barcodes) {
    const shortCodes = barcodes.map(b => b.shortCode).filter(Boolean);
    return shortCodes.filter((code, idx) => shortCodes.indexOf(code) !== idx);
}

/** ShortCodes que existen tanto en products como en barcodes (colisión inter-tablas) */
function findInterTableShortCodeCollisions(products, barcodes) {
    const productCodes = new Set(products.map(p => p.shortCode).filter(Boolean));
    return barcodes
        .filter(b => b.shortCode && productCodes.has(b.shortCode))
        .map(b => ({ barcodeId: b.id, shortCode: b.shortCode }));
}

/** Barcodes EAN duplicados dentro de la tabla barcodes */
function findDuplicateBarcodeEANs(barcodes) {
    const codes = barcodes.map(b => b.barcode).filter(Boolean);
    return codes.filter((code, idx) => codes.indexOf(code) !== idx);
}

/** Productos con barcode EAN duplicado */
function findDuplicateProductEANs(products) {
    const codes = products.map(p => p.barcode).filter(Boolean);
    return codes.filter((code, idx) => codes.indexOf(code) !== idx);
}

/** Productos con stock negativo */
function findNegativeStock(products) {
    return products.filter(p => typeof p.stock === 'number' && p.stock < 0);
}

/** Ventas sin items */
function findSalesWithoutItems(sales) {
    return sales.filter(s => !s.items || s.items.length === 0);
}

/** Ventas con total <= 0 */
function findSalesWithInvalidTotal(sales) {
    return sales.filter(s => s.status !== 'annulled' && (typeof s.total !== 'number' || s.total <= 0));
}

/** Pagos de reserva con monto <= 0 */
function findInvalidPayments(payments) {
    return payments.filter(p => p.status !== 'annulled' && (typeof p.amount !== 'number' || p.amount <= 0));
}

/** Barcodes con productId almacenado como string en lugar de número */
function findBarcodesWithStringProductId(barcodes) {
    return barcodes.filter(b => typeof b.productId === 'string');
}

// ──────────────────────────────────────────────────────────────────────────────
// FIXTURES — datos base válidos
// ──────────────────────────────────────────────────────────────────────────────

const PRODUCTS = [
    { id: 1, name: 'CAMISA BLANCA', barcode: '2001234567890', shortCode: '00001', stock: 10, price: 150, category: 'CAMISAS', active: true },
    { id: 2, name: 'PANTALON NEGRO', barcode: '2001234567891', shortCode: '00002', stock: 5, price: 200, category: 'PANTALONES', active: true },
    { id: 3, name: 'VESTIDO ROJO', barcode: '2001234567892', shortCode: '00003', stock: 0, price: 350, category: 'VESTIDOS', active: true },
];

const BARCODES = [
    { id: 1, productId: 1, barcode: '2009999900001', shortCode: '00004', used: false, createdAt: '2026-03-01T10:00:00' },
    { id: 2, productId: 1, barcode: '2009999900002', shortCode: '00005', used: false, createdAt: '2026-03-01T10:00:00' },
    { id: 3, productId: 2, barcode: '2009999900003', shortCode: '00006', used: false, createdAt: '2026-03-01T10:00:00' },
];

const KARDEX = [
    { id: 1, productId: 1, type: 'entrada', qty: 10, date: '2026-03-01T10:00:00', balanceAfter: 10 },
    { id: 2, productId: 2, type: 'entrada', qty: 5, date: '2026-03-01T10:00:00', balanceAfter: 5 },
];

const RESERVATIONS = [
    { id: 1, productId: 2, clientName: 'CLIENTE A', totalPrice: 200, status: 'pending', createdAt: '2026-03-10T09:00:00' },
    { id: 2, productId: 3, clientName: 'CLIENTE B', totalPrice: 350, status: 'completed', createdAt: '2026-03-11T09:00:00' },
];

const RESERVATION_PAYMENTS = [
    { id: 1, reservationId: 1, amount: 100, date: '2026-03-10T09:00:00', paymentMethod: 'efectivo' },
    { id: 2, reservationId: 2, amount: 350, date: '2026-03-12T09:00:00', paymentMethod: 'efectivo' },
];

const SALES = [
    { id: 1, items: [{ productId: 1, name: 'CAMISA BLANCA', qty: 2, price: 150 }], total: 300, date: '2026-03-15T14:00:00', paymentMethod: 'efectivo' },
    { id: 2, items: [{ productId: 3, name: 'VESTIDO ROJO', qty: 1, price: 350 }], total: 350, date: '2026-03-15T15:00:00', paymentMethod: 'qr', status: 'annulled' },
];

const EXPENSE_CATEGORIES = [
    { id: 1, name: 'SERVICIOS' },
    { id: 2, name: 'ALQUILER' },
];

const EXPENSES = [
    { id: 1, categoryId: 1, amount: 200, date: '2026-03-15T10:00:00', description: 'Luz' },
    { id: 2, categoryId: 2, amount: 500, date: '2026-03-15T10:00:00', description: 'Alquiler mensual' },
];

const CASH_CLOSURES = [
    { id: 1, date: '2026-03-15', totalSales: 300, closedAt: '2026-03-15T22:00:00' },
];

const CASH_CLOSURE_HISTORY = [
    { id: 1, closureId: 1, changedBy: 'admin', changedAt: '2026-03-15T22:05:00' },
];

// ──────────────────────────────────────────────────────────────────────────────
// SUITE 1 — INTEGRIDAD REFERENCIAL (datos huérfanos)
// ──────────────────────────────────────────────────────────────────────────────

describe('Integridad referencial — sin datos huérfanos', () => {

    it('todos los barcodes tienen un producto padre válido', () => {
        const orphans = findOrphanBarcodes(BARCODES, PRODUCTS);
        expect(orphans).toHaveLength(0);
    });

    it('detecta barcodes huérfanos cuando el producto no existe', () => {
        const withOrphan = [...BARCODES, { id: 99, productId: 999, barcode: '2000000000099', shortCode: '00099', used: false }];
        const orphans = findOrphanBarcodes(withOrphan, PRODUCTS);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe(99);
    });

    it('todos los movimientos de kardex tienen un producto padre válido', () => {
        const orphans = findOrphanKardex(KARDEX, PRODUCTS);
        expect(orphans).toHaveLength(0);
    });

    it('detecta kardex huérfano cuando el producto fue eliminado', () => {
        const withOrphan = [...KARDEX, { id: 99, productId: 888, type: 'salida', qty: 1, date: '2026-03-01T10:00:00' }];
        const orphans = findOrphanKardex(withOrphan, PRODUCTS);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe(99);
    });

    it('todas las reservas tienen un producto padre válido', () => {
        const orphans = findOrphanReservations(RESERVATIONS, PRODUCTS);
        expect(orphans).toHaveLength(0);
    });

    it('detecta reserva huérfana cuando el producto no existe', () => {
        const withOrphan = [...RESERVATIONS, { id: 99, productId: 777, clientName: 'TEST', totalPrice: 100, status: 'pending' }];
        const orphans = findOrphanReservations(withOrphan, PRODUCTS);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe(99);
    });

    it('todos los pagos de reserva tienen una reserva padre válida', () => {
        const orphans = findOrphanReservationPayments(RESERVATION_PAYMENTS, RESERVATIONS);
        expect(orphans).toHaveLength(0);
    });

    it('detecta pago huérfano cuando la reserva no existe', () => {
        const withOrphan = [...RESERVATION_PAYMENTS, { id: 99, reservationId: 666, amount: 50, date: '2026-03-10T09:00:00' }];
        const orphans = findOrphanReservationPayments(withOrphan, RESERVATIONS);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe(99);
    });

    it('todos los items de venta tienen un producto padre válido', () => {
        const orphans = findOrphanSaleItems(SALES, PRODUCTS);
        expect(orphans).toHaveLength(0);
    });

    it('detecta item de venta huérfano cuando el producto fue eliminado', () => {
        const withOrphan = [...SALES, {
            id: 99,
            items: [{ productId: 555, name: 'ELIMINADO', qty: 1, price: 100 }],
            total: 100, date: '2026-03-16T10:00:00',
        }];
        const orphans = findOrphanSaleItems(withOrphan, PRODUCTS);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].saleId).toBe(99);
        expect(orphans[0].orphanProductId).toBe(555);
    });

    it('todos los gastos tienen una categoría padre válida', () => {
        const orphans = findOrphanExpenses(EXPENSES, EXPENSE_CATEGORIES);
        expect(orphans).toHaveLength(0);
    });

    it('detecta gasto huérfano cuando la categoría fue eliminada', () => {
        const withOrphan = [...EXPENSES, { id: 99, categoryId: 444, amount: 100, date: '2026-03-15T10:00:00' }];
        const orphans = findOrphanExpenses(withOrphan, EXPENSE_CATEGORIES);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe(99);
    });

    it('todo el historial de cierres tiene un cierre padre válido', () => {
        const orphans = findOrphanCashClosureHistory(CASH_CLOSURE_HISTORY, CASH_CLOSURES);
        expect(orphans).toHaveLength(0);
    });

    it('detecta historial de cierre huérfano cuando el cierre fue eliminado', () => {
        const withOrphan = [...CASH_CLOSURE_HISTORY, { id: 99, closureId: 333, changedBy: 'admin', changedAt: '2026-03-15T23:00:00' }];
        const orphans = findOrphanCashClosureHistory(withOrphan, CASH_CLOSURES);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].id).toBe(99);
    });

    it('una base de datos completamente vacía no produce huérfanos', () => {
        expect(findOrphanBarcodes([], [])).toHaveLength(0);
        expect(findOrphanKardex([], [])).toHaveLength(0);
        expect(findOrphanReservations([], [])).toHaveLength(0);
        expect(findOrphanReservationPayments([], [])).toHaveLength(0);
        expect(findOrphanSaleItems([], [])).toHaveLength(0);
        expect(findOrphanExpenses([], [])).toHaveLength(0);
        expect(findOrphanCashClosureHistory([], [])).toHaveLength(0);
    });

    it('múltiples huérfanos son detectados todos a la vez', () => {
        const withMultiple = [
            ...RESERVATION_PAYMENTS,
            { id: 98, reservationId: 500, amount: 50, date: '2026-03-10T09:00:00' },
            { id: 97, reservationId: 501, amount: 75, date: '2026-03-10T09:00:00' },
        ];
        const orphans = findOrphanReservationPayments(withMultiple, RESERVATIONS);
        expect(orphans).toHaveLength(2);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// SUITE 2 — UNICIDAD DE CÓDIGOS
// ──────────────────────────────────────────────────────────────────────────────

describe('Unicidad de códigos — sin duplicados', () => {

    it('los shortCodes de productos son únicos', () => {
        const dups = findDuplicateProductShortCodes(PRODUCTS);
        expect(dups).toHaveLength(0);
    });

    it('detecta shortCodes duplicados en products', () => {
        const withDup = [...PRODUCTS, { id: 99, name: 'OTRO', shortCode: '00001', barcode: '2001111111111', stock: 1, price: 100 }];
        const dups = findDuplicateProductShortCodes(withDup);
        expect(dups.length).toBeGreaterThan(0);
        expect(dups).toContain('00001');
    });

    it('los shortCodes de barcodes son únicos', () => {
        const dups = findDuplicateBarcodeShortCodes(BARCODES);
        expect(dups).toHaveLength(0);
    });

    it('detecta shortCodes duplicados en barcodes', () => {
        const withDup = [...BARCODES, { id: 99, productId: 1, barcode: '2000000000099', shortCode: '00004', used: false }];
        const dups = findDuplicateBarcodeShortCodes(withDup);
        expect(dups.length).toBeGreaterThan(0);
        expect(dups).toContain('00004');
    });

    it('no hay colisión de shortCode entre products y barcodes', () => {
        const collisions = findInterTableShortCodeCollisions(PRODUCTS, BARCODES);
        expect(collisions).toHaveLength(0);
    });

    it('detecta colisión de shortCode entre products y barcodes', () => {
        // Barcode con mismo shortCode que un producto
        const collidingBarcodes = [...BARCODES, { id: 77, productId: 1, barcode: '2000000000077', shortCode: '00001', used: false }];
        const collisions = findInterTableShortCodeCollisions(PRODUCTS, collidingBarcodes);
        expect(collisions).toHaveLength(1);
        expect(collisions[0].shortCode).toBe('00001');
    });

    it('los EAN de barcodes son únicos', () => {
        const dups = findDuplicateBarcodeEANs(BARCODES);
        expect(dups).toHaveLength(0);
    });

    it('detecta EAN duplicado en barcodes', () => {
        const withDup = [...BARCODES, { id: 99, productId: 2, barcode: '2009999900001', shortCode: '00099', used: false }];
        const dups = findDuplicateBarcodeEANs(withDup);
        expect(dups.length).toBeGreaterThan(0);
        expect(dups).toContain('2009999900001');
    });

    it('los EAN de products son únicos', () => {
        const dups = findDuplicateProductEANs(PRODUCTS);
        expect(dups).toHaveLength(0);
    });

    it('detecta EAN duplicado en products', () => {
        const withDup = [...PRODUCTS, { id: 99, name: 'DUPLICADO', barcode: '2001234567890', shortCode: '00099', stock: 1, price: 100 }];
        const dups = findDuplicateProductEANs(withDup);
        expect(dups.length).toBeGreaterThan(0);
        expect(dups).toContain('2001234567890');
    });

    it('barcodes sin shortCode no generan falsos positivos de duplicado', () => {
        const withNulls = [
            ...BARCODES,
            { id: 88, productId: 1, barcode: '2000000000088', shortCode: null, used: false },
            { id: 89, productId: 1, barcode: '2000000000089', shortCode: null, used: false },
        ];
        // Los nulls NO deben considerarse duplicados entre sí
        const dups = findDuplicateBarcodeShortCodes(withNulls);
        expect(dups).toHaveLength(0);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// SUITE 3 — INVARIANTES DE NEGOCIO
// ──────────────────────────────────────────────────────────────────────────────

describe('Invariantes de negocio', () => {

    it('ningún producto tiene stock negativo', () => {
        const neg = findNegativeStock(PRODUCTS);
        expect(neg).toHaveLength(0);
    });

    it('detecta productos con stock negativo', () => {
        const withNeg = [...PRODUCTS, { id: 99, name: 'MAL STOCK', stock: -3, price: 100 }];
        const neg = findNegativeStock(withNeg);
        expect(neg).toHaveLength(1);
        expect(neg[0].id).toBe(99);
    });

    it('stock cero es válido (agotado, no error)', () => {
        const withZero = [...PRODUCTS, { id: 99, name: 'AGOTADO', stock: 0, price: 200, shortCode: '00099', barcode: '2009000000099' }];
        const neg = findNegativeStock(withZero);
        expect(neg).toHaveLength(0);
    });

    it('todas las ventas activas tienen items', () => {
        const empty = findSalesWithoutItems(SALES);
        expect(empty).toHaveLength(0);
    });

    it('detecta ventas sin items', () => {
        const withEmpty = [...SALES, { id: 99, items: [], total: 100, date: '2026-03-16T10:00:00' }];
        const empty = findSalesWithoutItems(withEmpty);
        expect(empty).toHaveLength(1);
        expect(empty[0].id).toBe(99);
    });

    it('detecta venta con items undefined', () => {
        const withUndef = [...SALES, { id: 99, total: 200, date: '2026-03-16T10:00:00' }];
        const empty = findSalesWithoutItems(withUndef);
        expect(empty).toHaveLength(1);
    });

    it('todas las ventas activas tienen total positivo', () => {
        const invalid = findSalesWithInvalidTotal(SALES);
        expect(invalid).toHaveLength(0);
    });

    it('detecta venta activa con total cero', () => {
        const withZero = [...SALES, { id: 99, items: [{ productId: 1, qty: 1, price: 0 }], total: 0, date: '2026-03-16T10:00:00' }];
        const invalid = findSalesWithInvalidTotal(withZero);
        expect(invalid).toHaveLength(1);
    });

    it('las ventas anuladas no se validan por total', () => {
        const withAnnulled = [...SALES, { id: 99, items: [], total: 0, status: 'annulled', date: '2026-03-16T10:00:00' }];
        // La anulada NO debe aparecer en el reporte de total inválido
        const invalid = findSalesWithInvalidTotal(withAnnulled);
        expect(invalid).toHaveLength(0);
    });

    it('todos los pagos de reserva activos tienen monto positivo', () => {
        const invalid = findInvalidPayments(RESERVATION_PAYMENTS);
        expect(invalid).toHaveLength(0);
    });

    it('detecta pago con monto cero', () => {
        const withZero = [...RESERVATION_PAYMENTS, { id: 99, reservationId: 1, amount: 0, date: '2026-03-10T09:00:00' }];
        const invalid = findInvalidPayments(withZero);
        expect(invalid).toHaveLength(1);
        expect(invalid[0].id).toBe(99);
    });

    it('detecta pago con monto negativo', () => {
        const withNeg = [...RESERVATION_PAYMENTS, { id: 98, reservationId: 1, amount: -50, date: '2026-03-10T09:00:00' }];
        const invalid = findInvalidPayments(withNeg);
        expect(invalid).toHaveLength(1);
        expect(invalid[0].id).toBe(98);
    });

    it('los pagos anulados no se validan por monto', () => {
        const withAnnulled = [...RESERVATION_PAYMENTS, { id: 99, reservationId: 1, amount: -10, status: 'annulled', date: '2026-03-10T09:00:00' }];
        const invalid = findInvalidPayments(withAnnulled);
        expect(invalid).toHaveLength(0);
    });

    it('ningún barcode tiene productId almacenado como string', () => {
        const stringIds = findBarcodesWithStringProductId(BARCODES);
        expect(stringIds).toHaveLength(0);
    });

    it('detecta barcode con productId como string (bug de importación)', () => {
        const withString = [...BARCODES, { id: 99, productId: '1', barcode: '2000000000099', shortCode: '00099', used: false }];
        const stringIds = findBarcodesWithStringProductId(withString);
        expect(stringIds).toHaveLength(1);
        expect(stringIds[0].id).toBe(99);
    });
});

// ──────────────────────────────────────────────────────────────────────────────
// SUITE 4 — ESCENARIOS DE BORDE Y COMBINADOS
// ──────────────────────────────────────────────────────────────────────────────

describe('Escenarios de borde y combinados', () => {

    it('una venta con múltiples items donde solo uno es huérfano', () => {
        const sale = {
            id: 50,
            items: [
                { productId: 1, name: 'CAMISA', qty: 1, price: 150 },   // ✓ existe
                { productId: 999, name: 'INEXISTENTE', qty: 1, price: 100 }, // ✗ huérfano
            ],
            total: 250, date: '2026-03-16T10:00:00',
        };
        const orphans = findOrphanSaleItems([sale], PRODUCTS);
        expect(orphans).toHaveLength(1);
        expect(orphans[0].orphanProductId).toBe(999);
    });

    it('una venta con todos los items huérfanos reporta todos', () => {
        const sale = {
            id: 51,
            items: [
                { productId: 800, qty: 1, price: 100 },
                { productId: 801, qty: 2, price: 200 },
            ],
            total: 500, date: '2026-03-16T10:00:00',
        };
        const orphans = findOrphanSaleItems([sale], PRODUCTS);
        expect(orphans).toHaveLength(2);
    });

    it('gastos sin categoryId no son reportados como huérfanos', () => {
        // Un gasto podría no tener categoría (campo opcional)
        const withNoCat = [...EXPENSES, { id: 99, amount: 50, date: '2026-03-15T10:00:00' }];
        const orphans = findOrphanExpenses(withNoCat, EXPENSE_CATEGORIES);
        // No debe reportar el gasto sin categoryId
        expect(orphans.find(e => e.id === 99)).toBeUndefined();
    });

    it('conjunto completo de datos válidos no genera ningún huérfano ni violación', () => {
        // Test de integración: todos los checks al mismo tiempo sobre datos válidos
        expect(findOrphanBarcodes(BARCODES, PRODUCTS)).toHaveLength(0);
        expect(findOrphanKardex(KARDEX, PRODUCTS)).toHaveLength(0);
        expect(findOrphanReservations(RESERVATIONS, PRODUCTS)).toHaveLength(0);
        expect(findOrphanReservationPayments(RESERVATION_PAYMENTS, RESERVATIONS)).toHaveLength(0);
        expect(findOrphanSaleItems(SALES, PRODUCTS)).toHaveLength(0);
        expect(findOrphanExpenses(EXPENSES, EXPENSE_CATEGORIES)).toHaveLength(0);
        expect(findOrphanCashClosureHistory(CASH_CLOSURE_HISTORY, CASH_CLOSURES)).toHaveLength(0);
        expect(findDuplicateProductShortCodes(PRODUCTS)).toHaveLength(0);
        expect(findDuplicateBarcodeShortCodes(BARCODES)).toHaveLength(0);
        expect(findInterTableShortCodeCollisions(PRODUCTS, BARCODES)).toHaveLength(0);
        expect(findDuplicateBarcodeEANs(BARCODES)).toHaveLength(0);
        expect(findDuplicateProductEANs(PRODUCTS)).toHaveLength(0);
        expect(findNegativeStock(PRODUCTS)).toHaveLength(0);
        expect(findSalesWithoutItems(SALES)).toHaveLength(0);
        expect(findSalesWithInvalidTotal(SALES)).toHaveLength(0);
        expect(findInvalidPayments(RESERVATION_PAYMENTS)).toHaveLength(0);
        expect(findBarcodesWithStringProductId(BARCODES)).toHaveLength(0);
    });

    it('escenario de backup corrupto: todos los tipos de huérfanos a la vez', () => {
        // Simula un import de backup que mezcla IDs de distintas tiendas
        const badBarcodes = [{ id: 1, productId: 9999, barcode: '2000000000001', shortCode: '00001', used: false }];
        const badKardex = [{ id: 1, productId: 8888, type: 'entrada', qty: 5, date: '2026-01-01T10:00:00' }];
        const badPayments = [{ id: 1, reservationId: 7777, amount: 100, date: '2026-01-01T10:00:00' }];
        const badExpenses = [{ id: 1, categoryId: 6666, amount: 200, date: '2026-01-01T10:00:00' }];
        const badHistory = [{ id: 1, closureId: 5555, changedBy: 'admin', changedAt: '2026-01-01T10:00:00' }];

        expect(findOrphanBarcodes(badBarcodes, [])).toHaveLength(1);
        expect(findOrphanKardex(badKardex, [])).toHaveLength(1);
        expect(findOrphanReservationPayments(badPayments, [])).toHaveLength(1);
        expect(findOrphanExpenses(badExpenses, [])).toHaveLength(1);
        expect(findOrphanCashClosureHistory(badHistory, [])).toHaveLength(1);
    });
});
