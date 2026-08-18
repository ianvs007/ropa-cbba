/**
 * 🔍 CÓDIGOS CORTOS DUPLICADOS EN PRODUCTS — Lógica pura, testeable.
 *
 * Contexto del bug: el shortCode se pre-genera al ABRIR el formulario de nueva
 * prenda (ProductList.openNew), así que dos pestañas abiertas generan el mismo
 * código y ambas pueden guardarlo → dos prendas distintas con el mismo código
 * de 5 dígitos. En la nube (tienda virtual) eso cruza la información de las
 * prendas (products.codigo = shortCode del POS).
 *
 * Estas funciones NO tocan Dexie: reciben y devuelven datos planos. La capa de
 * acceso a IndexedDB vive en db/helpers.js (findDuplicateProductShortCodes /
 * fixDuplicateProductShortCodes), que envuelve estas funciones.
 */

/**
 * Agrupa los productos que comparten el mismo shortCode NO vacío.
 * Incluye productos archivados (active === false): un duplicado archivado
 * puede reactivarse después y volver a cruzar datos en la tienda online.
 *
 * @param {Array} products - Productos de la tabla `products`
 * @returns {Array<{ shortCode: string, products: Array<{id, name, size, color, active}> }>}
 *          Un grupo por código repetido (2+ productos), ordenado por código;
 *          los productos de cada grupo van ordenados por id ascendente
 *          (el primero es el más antiguo).
 */
export function agruparDuplicadosProductos(products = []) {
    const porCodigo = new Map();

    for (const p of products || []) {
        const codigo = String(p?.shortCode ?? '').trim();
        if (!codigo) continue;
        if (!porCodigo.has(codigo)) porCodigo.set(codigo, []);
        porCodigo.get(codigo).push(p);
    }

    const grupos = [];
    for (const [shortCode, lista] of porCodigo.entries()) {
        if (lista.length < 2) continue;
        const ordenados = [...lista].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
        grupos.push({
            shortCode,
            products: ordenados.map(p => ({
                id: p.id,
                name: p.name ?? '',
                size: p.size ?? '',
                color: p.color ?? '',
                active: p.active !== false,
            })),
        });
    }

    return grupos.sort((a, b) => a.shortCode.localeCompare(b.shortCode));
}

/**
 * Planifica la reparación de shortCodes duplicados en products, SIN tocar la BD.
 *
 * Regla por grupo: el producto de MENOR id (el más antiguo) conserva el
 * código; los demás reciben códigos nuevos con el mismo criterio de
 * generateShortCode (max+1 con padStart(5,'0'), considerando los códigos ya
 * usados en products ∪ barcodes).
 *
 * @param {Array} products - Productos de la tabla `products`
 * @param {Array} barcodes - Unidades de la tabla `barcodes`
 * @returns {Array<{ id, name, codigoAnterior, codigoNuevo }>} Reasignaciones a aplicar
 * @throws {Error} Si se agota el espacio de códigos (99,999)
 */
export function planificarReasignacionDuplicados(products = [], barcodes = []) {
    const usados = new Set();

    for (const p of products || []) {
        const n = parseInt(p?.shortCode, 10);
        if (!isNaN(n) && n > 0 && n <= 99999) usados.add(n);
    }
    for (const b of barcodes || []) {
        const n = parseInt(b?.shortCode, 10);
        if (!isNaN(n) && n > 0 && n <= 99999) usados.add(n);
    }

    let siguiente = usados.size > 0 ? Math.max(...usados) + 1 : 1;

    const reasignaciones = [];
    for (const grupo of agruparDuplicadosProductos(products)) {
        // grupo.products ya viene ordenado por id: el primero (más antiguo)
        // CONSERVA el código; los demás se reasignan.
        for (const prod of grupo.products.slice(1)) {
            if (siguiente > 99999) {
                throw new Error('Se ha alcanzado el límite de 99,999 códigos cortos');
            }
            const codigoNuevo = siguiente.toString().padStart(5, '0');
            reasignaciones.push({
                id: prod.id,
                name: prod.name,
                codigoAnterior: grupo.shortCode,
                codigoNuevo,
            });
            usados.add(siguiente);
            siguiente++;
        }
    }

    return reasignaciones;
}
