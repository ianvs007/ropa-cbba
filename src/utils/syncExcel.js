/**
 * 🔄 EXPORTACIÓN DE STOCK A EXCEL — Lógica pura, testeable.
 *
 * Respaldo de solo lectura del stock que el POS publica en la tienda virtual
 * (globalId | codigo | nombre | talla | color | stock | precio). La
 * sincronización real va por API con el protocolo v2 (utils/syncV2.js); la
 * importación de ventas por Excel se retiró: las ventas web llegan como
 * eventos idempotentes al sincronizar.
 *
 * Estas funciones NO tocan Dexie ni XLSX: reciben y devuelven datos planos.
 */

/**
 * Filas del Excel de stock a exportar a la tienda virtual.
 * Solo productos activos (active !== false) y con shortCode; el stock se
 * sanea a entero ≥ 0 y el precio a número ≥ 0.
 *
 * @param {Array} products - Productos de la tabla `products`
 * @returns {{ filas: Array<{codigo, nombre, talla, color, stock, precio, globalId}>, sinCodigo: Array }}
 *          `sinCodigo` trae los productos activos omitidos por falta de
 *          shortCode, para advertir al usuario.
 */
export function filasStockParaExportar(products = []) {
    const filas = [];
    const sinCodigo = [];

    for (const p of products || []) {
        if (p?.active === false) continue;
        const codigo = String(p?.shortCode ?? '').trim();
        if (!codigo) {
            sinCodigo.push(p);
            continue;
        }
        const precio = Number(p.price);
        filas.push({
            codigo,
            nombre: p.name ?? '',
            talla: p.size ?? '',
            color: p.color ?? '',
            stock: Math.max(0, Math.floor(Number(p.stock) || 0)),
            precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
            globalId: String(p.globalId ?? '').trim(),
        });
    }

    return { filas, sinCodigo };
}

/**
 * Detecta códigos cortos repetidos en las filas de stock a exportar/sincronizar.
 * Si un código aparece 2+ veces, la tienda virtual no puede publicar ambas
 * prendas (products.codigo es único), así que el envío/exportación debe
 * BLOQUEARSE hasta reparar los duplicados (fixDuplicateProductShortCodes).
 *
 * @param {Array<{codigo, nombre, talla, color, stock, precio}>} filas - Salida de filasStockParaExportar
 * @returns {Array<{ codigo: string, filas: Array }>} Un grupo por código repetido, ordenado por código
 */
export function codigosDuplicadosEnFilas(filas = []) {
    const porCodigo = new Map();

    for (const f of filas || []) {
        const codigo = String(f?.codigo ?? '').trim();
        if (!codigo) continue;
        if (!porCodigo.has(codigo)) porCodigo.set(codigo, []);
        porCodigo.get(codigo).push(f);
    }

    return [...porCodigo.entries()]
        .filter(([, lista]) => lista.length > 1)
        .map(([codigo, lista]) => ({ codigo, filas: lista }))
        .sort((a, b) => a.codigo.localeCompare(b.codigo));
}
