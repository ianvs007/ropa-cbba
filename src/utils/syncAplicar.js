/**
 * 🔄 APLICAR VENTAS EN LÍNEA — Descuento de stock compartido.
 *
 * Lógica extraída de la tarjeta ② de Sync.jsx para que la importación por
 * Excel y la sincronización directa por API apliquen las ventas con
 * EXACTAMENTE el mismo código: descuento de stock + unidades (FIFO) + kárdex,
 * todo en UNA transacción Dexie (si algo falla a la mitad, rollback completo).
 *
 * NO crea registros en `sales`: el dinero de la web no entra a la caja
 * física, solo baja stock (decisión del dueño).
 */

import { db, getLocalISOString } from '../db';

/**
 * Aplica el descuento de stock de las filas cruzadas (salida de cruzarVentas).
 *
 * Guard contra doble importación: al terminar actualiza la clave
 * `ultimaImportacionVentas` de settings con la fecha máxima de las ventas
 * aplicadas; cruzarVentas marca como 'Ya importada anteriormente' cualquier
 * venta con fecha <= ese valor.
 *
 * @param {Array} preview - Filas cruzadas { productId, aDescontar, pedido, estado, fecha, ... }
 * @returns {Promise<{ unidades: number, fechaMax: string|null }>}
 *          `unidades` = total de ítems descontados; `fechaMax` = fecha máxima
 *          aplicada (la guardada en settings), o null si no se aplicó nada.
 */
export async function aplicarVentas(preview = []) {
    return db.transaction(
        'rw', [db.products, db.barcodes, db.kardex, db.settings],
        async () => {
            let unidades = 0;
            let fechaMax = null;

            for (const fila of preview) {
                if (fila.aDescontar <= 0 || !fila.productId) continue;

                const product = await db.products.get(fila.productId);
                if (!product) continue;

                // Defensivo: el stock pudo cambiar desde la vista previa
                const qty = Math.min(fila.aDescontar, product.stock);
                if (qty <= 0) continue;

                const nuevoStock = product.stock - qty;
                await db.products.update(product.id, {
                    stock: nuevoStock,
                    updatedAt: new Date().toISOString(),
                });

                // Marcar como usadas las primeras `qty` unidades disponibles (FIFO por id)
                const unidadesLibres = await db.barcodes
                    .where('productId').equals(product.id)
                    .and(b => !b.used)
                    .limit(qty)
                    .toArray();
                for (const b of unidadesLibres) {
                    await db.barcodes.update(b.id, { used: true });
                }

                await db.kardex.add({
                    productId: product.id,
                    date: getLocalISOString(),
                    type: 'salida',
                    qty,
                    notes: `VENTA EN LÍNEA #${fila.pedido || 'SIN-REF'} (${fila.estado || 'pagado'})`.toUpperCase(),
                    balanceAfter: nuevoStock,
                    unitCodes: unidadesLibres.map(b => ({
                        shortCode: b.shortCode || '',
                        barcode: b.barcode || '',
                    })),
                });

                unidades += qty;
                if (fila.fecha && (!fechaMax || fila.fecha > fechaMax)) fechaMax = fila.fecha;
            }

            // Bloquea el doble descuento si importan las mismas ventas otra vez
            if (fechaMax) {
                await db.settings.put({ key: 'ultimaImportacionVentas', value: fechaMax });
            }
            return { unidades, fechaMax };
        }
    );
}
