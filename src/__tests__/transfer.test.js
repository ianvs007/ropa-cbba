/**
 * ══════════════════════════════════════════════════════════════════════════════
 * 🔄 TESTS DE TRASLADO ENTRE SUCURSALES — Tienda de Ropas
 * ══════════════════════════════════════════════════════════════════════════════
 *
 * El entorno de tests es Node (sin IndexedDB), por lo que — igual que orphanData.test.js —
 * estos tests modelan la lógica de negocio como funciones PURAS sobre arrays, replicando
 * exactamente las reglas implementadas en los componentes/helpers reales:
 *
 *   applyTransfer()      ↔ src/components/TransferModal.jsx (transacción de confirmación)
 *   shortCodeExistsPure() ↔ src/db/helpers.js → shortCodeExists()
 *
 * Verifican:
 *   1. Un traslado marca la unidad used:true + transferStatus:'traslado', baja el stock
 *      en 1 y genera un movimiento de kardex tipo 'traslado' — SIN crear ninguna venta.
 *   2. shortCodeExists bloquea un re-registro con un código corto ya usado (en products
 *      o en barcodes) y permite uno libre.
 * ══════════════════════════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';

// ──────────────────────────────────────────────────────────────────────────────
// MODELOS PUROS (misma lógica que el código real, sin IndexedDB)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Replica TransferModal.handleConfirm sobre estructuras en memoria.
 * Muta copias de los arrays y devuelve el nuevo estado. Lanza Error en los
 * mismos casos que aborta la transacción real.
 *
 * @returns {{ products, barcodes, kardex, sales }}
 */
function applyTransfer({ products, barcodes, kardex, sales, reservations = [] }, { shortCode, destino, motivo, userId }) {
    const barcodesCopy = barcodes.map(b => ({ ...b }));
    const productsCopy = products.map(p => ({ ...p }));
    const kardexCopy = kardex.map(k => ({ ...k }));
    const salesCopy = sales.map(s => ({ ...s }));

    const unit = barcodesCopy.find(b => b.shortCode === shortCode);
    if (!unit) throw new Error('No se encontró ninguna unidad con ese código corto');
    if (unit.used === true) throw new Error('Esta unidad ya fue vendida o trasladada');

    const product = productsCopy.find(p => p.id === unit.productId);
    if (!product) throw new Error('Producto no encontrado');
    if (product.stock < 1) throw new Error('El producto no tiene stock disponible para trasladar');

    const newStock = product.stock - 1;
    const pendingCount = reservations.filter(r => r.productId === product.id && r.status === 'pending').length;
    if (newStock < pendingCount) {
        throw new Error(`No se puede trasladar: existen ${pendingCount} reserva(s) pendientes`);
    }

    // Marcar la unidad (NO se borra)
    unit.used = true;
    unit.transferStatus = 'traslado';
    unit.transferDate = '2026-06-30T10:00:00.000Z';
    unit.transferTo = destino;

    // Baja de stock
    product.stock = newStock;

    // Movimiento neutro auditado
    kardexCopy.push({
        productId: product.id,
        date: '2026-06-30T10:00:00.000Z',
        type: 'traslado',
        qty: 1,
        notes: ('TRASLADO A ' + destino + ' — ' + motivo).toUpperCase(),
        balanceAfter: newStock,
        unitCodes: [{ shortCode: unit.shortCode || '', barcode: unit.barcode || '' }],
        transferTo: destino,
        userId,
    });

    return { products: productsCopy, barcodes: barcodesCopy, kardex: kardexCopy, sales: salesCopy };
}

/** Replica helpers.js → shortCodeExists() sobre arrays (products ∪ barcodes). */
function shortCodeExistsPure(shortCode, products, barcodes) {
    if (products.some(p => p.shortCode === shortCode)) return true;
    if (barcodes.some(b => b.shortCode === shortCode)) return true;
    return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// FIXTURE BASE
// ──────────────────────────────────────────────────────────────────────────────

function baseState() {
    return {
        products: [
            { id: 1, name: 'POLERA NEGRA', shortCode: '00001', stock: 3 },
            { id: 2, name: 'JEAN AZUL', shortCode: '00002', stock: 1 },
        ],
        barcodes: [
            { id: 10, productId: 1, barcode: '2001234567890', shortCode: '10001', used: false, createdAt: '2026-06-01T00:00:00.000Z' },
            { id: 11, productId: 1, barcode: '2001234567891', shortCode: '10002', used: false, createdAt: '2026-06-01T00:00:00.000Z' },
            { id: 12, productId: 2, barcode: '2001234567892', shortCode: '10003', used: true,  createdAt: '2026-06-01T00:00:00.000Z' },
        ],
        kardex: [
            { id: 1, productId: 1, type: 'entrada', qty: 3, date: '2026-06-01T00:00:00.000Z', balanceAfter: 3 },
        ],
        sales: [],
        reservations: [],
    };
}

// ──────────────────────────────────────────────────────────────────────────────
// TESTS
// ──────────────────────────────────────────────────────────────────────────────

describe('Traslado entre sucursales (lado origen)', () => {
    it('marca la unidad used:true + transferStatus y baja el stock en 1, sin crear venta', () => {
        const before = baseState();
        const out = applyTransfer(before, {
            shortCode: '10001', destino: 'SUCURSAL CENTRO', motivo: 'REPOSICIÓN', userId: 7,
        });

        const unit = out.barcodes.find(b => b.id === 10);
        // (1) La unidad NO se borra: sigue existiendo, marcada
        expect(unit).toBeDefined();
        expect(unit.used).toBe(true);
        expect(unit.transferStatus).toBe('traslado');
        expect(unit.transferTo).toBe('SUCURSAL CENTRO');
        // shortCode se conserva consultable
        expect(unit.shortCode).toBe('10001');

        // Stock baja exactamente en 1
        const prod = out.products.find(p => p.id === 1);
        expect(prod.stock).toBe(2);

        // Se registra UN movimiento de kardex tipo 'traslado' (neutro)
        const traslados = out.kardex.filter(k => k.type === 'traslado');
        expect(traslados).toHaveLength(1);
        expect(traslados[0].qty).toBe(1);
        expect(traslados[0].balanceAfter).toBe(2);
        expect(traslados[0].transferTo).toBe('SUCURSAL CENTRO');
        expect(traslados[0].userId).toBe(7);
        expect(traslados[0].unitCodes).toEqual([{ shortCode: '10001', barcode: '2001234567890' }]);

        // NO es venta: no se crea ningún registro de venta ni movimiento de 'salida'
        expect(out.sales).toHaveLength(0);
        expect(out.kardex.filter(k => k.type === 'salida')).toHaveLength(0);
    });

    it('rechaza trasladar una unidad ya usada (vendida o trasladada)', () => {
        expect(() => applyTransfer(baseState(), {
            shortCode: '10003', destino: 'X', motivo: 'Y', userId: 1,
        })).toThrow('ya fue vendida o trasladada');
    });

    it('rechaza un código corto inexistente', () => {
        expect(() => applyTransfer(baseState(), {
            shortCode: '99999', destino: 'X', motivo: 'Y', userId: 1,
        })).toThrow('No se encontró');
    });

    it('aborta si quedaría stock por debajo de las reservas pendientes', () => {
        const state = baseState();
        state.products.find(p => p.id === 1).stock = 1; // solo 1 en stock
        state.reservations = [{ id: 1, productId: 1, status: 'pending' }]; // 1 reserva pendiente
        expect(() => applyTransfer(state, {
            shortCode: '10001', destino: 'X', motivo: 'Y', userId: 1,
        })).toThrow('reserva(s) pendientes');
    });
});

describe('Re-registro de traslado (lado destino) — shortCodeExists', () => {
    it('bloquea un re-registro con un código ya usado en barcodes', () => {
        const { products, barcodes } = baseState();
        // 10001 ya existe como unidad → debe bloquear
        expect(shortCodeExistsPure('10001', products, barcodes)).toBe(true);
    });

    it('bloquea un re-registro con un código ya usado en products', () => {
        const { products, barcodes } = baseState();
        // 00001 ya existe como código de producto (modelo) → debe bloquear
        expect(shortCodeExistsPure('00001', products, barcodes)).toBe(true);
    });

    it('permite un re-registro con un código libre', () => {
        const { products, barcodes } = baseState();
        expect(shortCodeExistsPure('55555', products, barcodes)).toBe(false);
    });
});
