/**
 * 🏷️ ALINEACIÓN DE CÓDIGOS (producto = etiqueta física) — lógica pura, testeable.
 *
 * Contexto (CLAUDE.md, sección "Diagnóstico etiquetas↔nube"): el POS maneja DOS
 * numeraciones de 5 dígitos en el mismo espacio —
 *   - products.shortCode  → por modelo; es el `codigo` que publica la tienda virtual
 *   - barcodes[].shortCode → por prenda física; es lo que imprime la etiqueta
 *                            (MassLabeling.jsx)
 * Como generateBarcodesForProduct asigna max+1 salteándose los códigos ya usados
 * (incluido el del propio producto), la etiqueta NUNCA coincide con el código web.
 * El POS no lo sufre porque findProductByBarcode resuelve ambas tablas; la web sólo
 * conoce la de productos, así que buscar el número de la etiqueta devuelve otra
 * prenda o nada.
 *
 * Regla de negocio (decisión de Alain): en una PRENDA ÚNICA mandan las etiquetas ya
 * impresas → el shortCode del producto pasa a ser el shortCode de su única unidad,
 * que es el número que el cliente tiene en la mano.
 *
 * PRECONDICIONES (reparar antes con las herramientas existentes):
 *   - shortCodes de producto únicos → fixDuplicateProductShortCodes()
 *   - shortCodes de unidad únicos   → fixMissingShortCodes()
 * Si no se cumplen, no hay forma de saber qué etiqueta manda y el caso se reporta
 * en `bloqueos` en vez de adivinar.
 *
 * Estas funciones NO tocan Dexie: reciben y devuelven datos planos. La capa de
 * acceso a IndexedDB vive en db/helpers.js, que envuelve estas funciones.
 */

const LIMITE_CODIGOS = 99999;

/** Devuelve el número de un código corto si es usable (1..99999), o null. */
function numeroDe(valor) {
    const n = parseInt(valor, 10);
    return !isNaN(n) && n > 0 && n <= LIMITE_CODIGOS ? n : null;
}

/** Código tal como se guarda: 5 dígitos con ceros a la izquierda. */
function formatear(n) {
    return n.toString().padStart(5, '0');
}

const codigoDe = (registro) => String(registro?.shortCode ?? '').trim();

/**
 * Planifica la alineación sin tocar la BD.
 *
 * El resultado es un ESTADO FINAL, no una secuencia con restricciones de orden:
 * `shortCode` no es índice único en Dexie (schema.js), así que los movimientos
 * pueden aplicarse en cualquier orden dentro de una transacción — incluido un
 * intercambio (ciclo de dos), que es justamente lo que alinea dos prendas cuyas
 * etiquetas están cruzadas. Lo que sí debe cumplirse es que los códigos finales
 * sean únicos entre productos: la nube tiene `idx_products_codigo` UNIQUE y
 * codigosDuplicadosEnFilas() bloquea la sync si llegan repetidos.
 *
 * @param {Array} products - Productos de la tabla `products`
 * @param {Array} barcodes - Unidades de la tabla `barcodes`
 * @returns {{
 *   reasignaciones: Array<{id, name, codigoAnterior, codigoNuevo, motivo: 'alineacion'|'desalojo'}>,
 *   bloqueos: Array<{id, name, codigo, motivo: 'etiqueta-duplicada'|'codigo-duplicado'}>,
 *   resumen: Object
 * }}
 * @throws {Error} Si se agota el espacio de códigos (99,999)
 */
export function planificarAlineacionEtiquetas(products = [], barcodes = []) {
    const lista = [...(products || [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    const unidades = barcodes || [];

    const unidadesPorProducto = new Map();
    const unidadesPorCodigo = new Map();
    for (const u of unidades) {
        if (!unidadesPorProducto.has(u.productId)) unidadesPorProducto.set(u.productId, []);
        unidadesPorProducto.get(u.productId).push(u);
        const codigo = codigoDe(u);
        if (codigo) {
            if (!unidadesPorCodigo.has(codigo)) unidadesPorCodigo.set(codigo, []);
            unidadesPorCodigo.get(codigo).push(u);
        }
    }

    const productosPorCodigo = new Map();
    for (const p of lista) {
        const codigo = codigoDe(p);
        if (!codigo) continue;
        if (!productosPorCodigo.has(codigo)) productosPorCodigo.set(codigo, []);
        productosPorCodigo.get(codigo).push(p);
    }

    const resumen = {
        productos: lista.length,
        prendasUnicas: 0,
        yaAlineadas: 0,
        alineadas: 0,
        desalojadas: 0,
        bloqueadas: 0,
        sinUnidades: 0,
        variasUnidades: 0,
        sinCodigoDeUnidad: 0,
    };
    const bloqueos = [];
    const candidatas = []; // { producto, objetivo }

    for (const p of lista) {
        const propias = unidadesPorProducto.get(p.id) || [];
        if (propias.length === 0) { resumen.sinUnidades++; continue; }
        if (propias.length > 1) { resumen.variasUnidades++; continue; }
        resumen.prendasUnicas++;

        const objetivo = codigoDe(propias[0]);
        if (!objetivo) { resumen.sinCodigoDeUnidad++; continue; }
        if (objetivo === codigoDe(p)) { resumen.yaAlineadas++; continue; }

        // Dos prendas físicas con el mismo número impreso: no hay forma de saber
        // cuál de las dos manda → reparar primero con fixMissingShortCodes().
        if ((unidadesPorCodigo.get(objetivo) || []).length > 1) {
            bloqueos.push({
                id: p.id, name: p.name ?? '', codigo: objetivo,
                motivo: 'etiqueta-duplicada',
            });
            continue;
        }
        // El objetivo lo tienen 2+ productos: reparar primero los duplicados.
        const ocupantes = (productosPorCodigo.get(objetivo) || []).filter((o) => o.id !== p.id);
        if (ocupantes.length > 1) {
            bloqueos.push({
                id: p.id, name: p.name ?? '', codigo: objetivo,
                motivo: 'codigo-duplicado',
            });
            continue;
        }
        candidatas.push({ producto: p, objetivo, ocupante: ocupantes[0] || null });
    }

    // ── quién tiene que soltar su código ───────────────────────────────────────
    // Si el ocupante es a su vez prenda única candidata, ya se va a mover a su
    // propia etiqueta y libera el código solo. Si no (tiene varias unidades, o
    // ninguna, o su código sólo vive en la web), hay que darle uno nuevo.
    // Los objetivos de las candidatas son todos distintos (dos iguales serían una
    // etiqueta duplicada, ya bloqueada arriba), así que cada ocupante aparece una
    // sola vez.
    const idsCandidatas = new Set(candidatas.map((c) => c.producto.id));
    const porDesalojar = [];
    for (const { ocupante } of candidatas) {
        if (!ocupante || idsCandidatas.has(ocupante.id)) continue;
        porDesalojar.push(ocupante);
    }

    // ── códigos nuevos: max+1 sobre products ∪ barcodes, mismo criterio que
    // generateShortCode y planificarReasignacionDuplicados. NO se rellenan huecos
    // libres: un hueco puede ser el número de una etiqueta ya impresa cuya prenda
    // se vendió o se dio de baja, y acá mandan las etiquetas físicas.
    const usados = new Set();
    for (const p of lista) {
        const n = numeroDe(codigoDe(p));
        if (n !== null) usados.add(n);
    }
    for (const u of unidades) {
        const n = numeroDe(codigoDe(u));
        if (n !== null) usados.add(n);
    }

    let siguiente = usados.size > 0 ? Math.max(...usados) + 1 : 1;

    const reasignaciones = [];
    for (const q of porDesalojar.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))) {
        if (siguiente > LIMITE_CODIGOS) {
            throw new Error('Se ha alcanzado el límite de 99,999 códigos cortos');
        }
        const n = siguiente++;
        usados.add(n);
        reasignaciones.push({
            id: q.id,
            name: q.name ?? '',
            codigoAnterior: codigoDe(q),
            codigoNuevo: formatear(n),
            motivo: 'desalojo',
        });
    }
    for (const { producto, objetivo } of candidatas) {
        reasignaciones.push({
            id: producto.id,
            name: producto.name ?? '',
            codigoAnterior: codigoDe(producto),
            codigoNuevo: objetivo,
            motivo: 'alineacion',
        });
    }

    reasignaciones.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    resumen.alineadas = candidatas.length;
    resumen.desalojadas = porDesalojar.length;
    resumen.bloqueadas = bloqueos.length;

    return { reasignaciones, bloqueos, resumen };
}

/**
 * Aplica un plan sobre una lista de productos y devuelve la lista con los códigos
 * finales. Sirve para previsualizar el resultado (y para verificar en tests que no
 * queden códigos repetidos) sin tocar la BD.
 *
 * @param {Array} products
 * @param {{reasignaciones: Array}} plan - salida de planificarAlineacionEtiquetas
 * @returns {Array} copia de products con el shortCode final aplicado
 */
export function aplicarPlanEnSeco(products = [], plan) {
    const porId = new Map((plan?.reasignaciones || []).map((r) => [r.id, r.codigoNuevo]));
    return (products || []).map((p) =>
        porId.has(p.id) ? { ...p, shortCode: porId.get(p.id) } : { ...p }
    );
}
