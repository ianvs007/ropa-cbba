/**
 * 🏬 INGRESO DE MERCADERÍA DESDE SUCURSAL — Lógica pura y testeable (sin Dexie).
 *
 * Contempla:
 *  1. Normalización estricta de códigos cortos de sucursal (1 a 5 dígitos → 5 dígitos
 *     con ceros a la izquierda, 100% compatible con `normalizarEtiqueta` de syncV2).
 *  2. Evaluación de cada código contra `products` y `barcodes` locales:
 *     - Libre / disponible (incluso si coincide con el `shortCode` del propio producto)
 *     - Retorno de traslado previo (`used === true && transferStatus === 'traslado'`)
 *     - Colisión con otra prenda local (unidad activa, unidad vendida o código de otro modelo)
 *     - Duplicado dentro del mismo lote de ingreso
 *  3. Sugerencia de código corto libre cuando el usuario decide re-etiquetar por colisión.
 *  4. Planificación completa del ingreso (para producto nuevo o producto existente),
 *     incluyendo la alineación automática `product.shortCode = unit.shortCode` en prendas
 *     únicas nuevas para que la Tienda Virtual y la etiqueta física coincidan sin pasos extra.
 */

const LIMITE_CODIGOS = 99999;

const texto = (v) => String(v ?? '').trim();

/**
 * Normaliza un código corto de sucursal a 5 dígitos ('123' -> '00123').
 * Devuelve null si está vacío, no es numérico o está fuera de 00001..99999.
 *
 * @param {string|number} valor
 * @returns {string|null}
 */
export function normalizarCodigoSucursal(valor) {
    const limpio = texto(valor);
    if (!/^\d{1,5}$/.test(limpio)) return null;
    const n = parseInt(limpio, 10);
    if (isNaN(n) || n < 1 || n > LIMITE_CODIGOS) return null;
    return n.toString().padStart(5, '0');
}

/**
 * Calcula el siguiente código corto libre considerando `products`, `barcodes`
 * y un conjunto opcional de códigos ya reservados en el formulario actual.
 *
 * @param {Array} products
 * @param {Array} barcodes
 * @param {Iterable<string>} [codigosEnLote]
 * @returns {string} Código de 5 dígitos (ej. '02411')
 */
export function sugerirCodigoLibre(products = [], barcodes = [], codigosEnLote = []) {
    const usados = new Set();

    for (const p of products || []) {
        const n = parseInt(p?.shortCode, 10);
        if (!isNaN(n) && n > 0 && n <= LIMITE_CODIGOS) usados.add(n);
    }
    for (const b of barcodes || []) {
        const n = parseInt(b?.shortCode, 10);
        if (!isNaN(n) && n > 0 && n <= LIMITE_CODIGOS) usados.add(n);
    }
    for (const c of codigosEnLote || []) {
        const norm = normalizarCodigoSucursal(c);
        if (norm) usados.add(parseInt(norm, 10));
    }

    let siguiente = usados.size > 0 ? Math.max(...usados) + 1 : 1;
    while (usados.has(siguiente)) siguiente++;

    if (siguiente > LIMITE_CODIGOS) {
        throw new Error('Se ha alcanzado el límite de 99,999 códigos cortos');
    }
    return siguiente.toString().padStart(5, '0');
}

/**
 * Evalúa un código corto proveniente de sucursal contra el catálogo y las unidades
 * de la tienda principal.
 *
 * @param {Object} params
 * @param {string} params.rawCode            Código escrito por el usuario
 * @param {Array}  params.products           Tabla `products`
 * @param {Array}  params.barcodes           Tabla `barcodes`
 * @param {number|null} [params.targetProductId] ID del producto destino (null si es producto nuevo)
 * @returns {Object} Resultado detallado de la validación
 */
export function evaluarCodigoSucursal({
    rawCode,
    products = [],
    barcodes = [],
    targetProductId = null,
} = {}) {
    const crudo = texto(rawCode);
    if (!crudo) {
        return {
            valido: false,
            status: 'vacio',
            shortCode: '',
            mensaje: 'Ingresa el código corto de la etiqueta de sucursal',
        };
    }

    const shortCode = normalizarCodigoSucursal(crudo);
    if (!shortCode) {
        return {
            valido: false,
            status: 'invalido',
            shortCode: crudo,
            mensaje: 'El código debe ser numérico de 1 a 5 dígitos (00001 a 99999)',
        };
    }

    const mapaProductos = new Map((products || []).map((p) => [p.id, p]));
    const unidadesCoincidentes = (barcodes || []).filter(
        (b) => normalizarCodigoSucursal(b?.shortCode) === shortCode
    );
    const productosCoincidentes = (products || []).filter(
        (p) => normalizarCodigoSucursal(p?.shortCode) === shortCode
    );

    // 1. Revisar si existe como unidad en `barcodes`
    if (unidadesCoincidentes.length > 0) {
        // Priorizar unidad activa si hubiera más de una
        const unidadActiva = unidadesCoincidentes.find((u) => !u.used);
        if (unidadActiva) {
            const prodDueno = mapaProductos.get(unidadActiva.productId) || null;
            return {
                valido: false,
                status: 'colision',
                conflictType: 'unidad_activa',
                shortCode,
                conflictUnit: unidadActiva,
                conflictProduct: prodDueno,
                mensaje: prodDueno
                    ? `El código ${shortCode} ya está activo en esta tienda para "${prodDueno.name}"${prodDueno.size ? ` (Talla ${prodDueno.size})` : ''}`
                    : `El código ${shortCode} ya pertenece a una unidad disponible en esta tienda`,
            };
        }

        // Revisar si es una unidad que había salido por traslado desde esta misma tienda
        const unidadTrasladada = unidadesCoincidentes.find(
            (u) => u.used === true && u.transferStatus === 'traslado'
        );
        if (unidadTrasladada) {
            const prodDueno = mapaProductos.get(unidadTrasladada.productId) || null;
            // Si estamos ajustando exactamente ese producto (o buscando sin producto fijo)
            if (targetProductId === null || unidadTrasladada.productId === targetProductId) {
                return {
                    valido: true,
                    status: 'retorno_mismo_producto',
                    action: 'reactivate',
                    shortCode,
                    existingUnit: unidadTrasladada,
                    conflictProduct: prodDueno,
                    originBranchSuggested: unidadTrasladada.transferTo || '',
                    mensaje: `Retorno detectado: esta unidad salió a ${unidadTrasladada.transferTo || 'sucursal'} y se reactivará con su mismo código ${shortCode}`,
                };
            }
            // Pertenece a otro producto distinto al que el usuario tiene abierto
            return {
                valido: false,
                status: 'retorno_otro_producto',
                conflictType: 'retorno_otro_producto',
                shortCode,
                conflictUnit: unidadTrasladada,
                conflictProduct: prodDueno,
                originBranchSuggested: unidadTrasladada.transferTo || '',
                mensaje: prodDueno
                    ? `El código ${shortCode} salió antes a ${unidadTrasladada.transferTo || 'sucursal'} como "${prodDueno.name}". Reingrésalo en ese producto o asigna un código nuevo.`
                    : `El código ${shortCode} corresponde a un traslado previo de otro producto.`,
            };
        }

        // Unidad ya vendida en esta tienda (used === true sin ser traslado)
        const unidadVendida = unidadesCoincidentes[0];
        const prodDueno = mapaProductos.get(unidadVendida.productId) || null;
        return {
            valido: false,
            status: 'colision',
            conflictType: 'unidad_vendida',
            shortCode,
            conflictUnit: unidadVendida,
            conflictProduct: prodDueno,
            mensaje: prodDueno
                ? `El código ${shortCode} ya fue utilizado en una prenda vendida en esta tienda ("${prodDueno.name}")`
                : `El código ${shortCode} ya pertenece a una unidad vendida en esta tienda`,
        };
    }

    // 2. Revisar si choca con el `shortCode` de modelo de OTRO producto
    const otroProductoConCodigo = productosCoincidentes.find((p) => p.id !== targetProductId);
    if (otroProductoConCodigo) {
        return {
            valido: false,
            status: 'colision',
            conflictType: 'codigo_modelo',
            shortCode,
            conflictUnit: null,
            conflictProduct: otroProductoConCodigo,
            mensaje: `El código ${shortCode} ya identifica al modelo "${otroProductoConCodigo.name}" en esta tienda`,
        };
    }

    // 3. Código completamente libre (o coincide con el shortCode del propio producto destino)
    return {
        valido: true,
        status: 'disponible',
        action: 'insert',
        shortCode,
        mensaje: `Código ${shortCode} disponible (se conservará de la sucursal)`,
    };
}

/**
 * Evalúa una lista de códigos cortos correspondientes a N unidades traídas de sucursal.
 * Detecta también códigos repetidos dentro del mismo formulario.
 *
 * @param {Object} params
 * @param {Array<string>} params.rawCodes
 * @param {Array}         params.products
 * @param {Array}         params.barcodes
 * @param {number|null}   [params.targetProductId]
 * @returns {{
 *   items: Array,
 *   valido: boolean,
 *   nuevosCount: number,
 *   retornosCount: number,
 *   erroresCount: number
 * }}
 */
export function evaluarLoteCodigosSucursal({
    rawCodes = [],
    products = [],
    barcodes = [],
    targetProductId = null,
} = {}) {
    const frecuencia = new Map();
    for (const raw of rawCodes || []) {
        const norm = normalizarCodigoSucursal(raw);
        if (norm) {
            frecuencia.set(norm, (frecuencia.get(norm) || 0) + 1);
        }
    }

    let nuevosCount = 0;
    let retornosCount = 0;
    let erroresCount = 0;

    const items = (rawCodes || []).map((rawCode, index) => {
        const base = evaluarCodigoSucursal({
            rawCode,
            products,
            barcodes,
            targetProductId,
        });

        if (base.shortCode && (frecuencia.get(base.shortCode) || 0) > 1) {
            erroresCount++;
            return {
                ...base,
                index,
                valido: false,
                status: 'duplicado_en_lote',
                mensaje: `El código ${base.shortCode} está repetido dentro de este mismo registro`,
            };
        }

        if (!base.valido) {
            erroresCount++;
        } else if (base.status === 'retorno_mismo_producto') {
            retornosCount++;
        } else {
            nuevosCount++;
        }

        return { ...base, index };
    });

    return {
        items,
        valido: items.length > 0 && erroresCount === 0,
        nuevosCount,
        retornosCount,
        erroresCount,
    };
}

/**
 * Arma la nota contable estandarizada para el Kardex en ingresos desde sucursal.
 *
 * @param {Object} params
 * @param {string} params.originBranch  Nombre de la sucursal de origen
 * @param {string} [params.notes]       Motivo o nota adicional
 * @param {number} [params.retornosCount] Cantidad de unidades que eran retorno
 * @returns {string}
 */
export function construirNotaKardexSucursal({ originBranch, notes = '', retornosCount = 0 } = {}) {
    const sucursal = texto(originBranch).toUpperCase();
    const motivo = texto(notes).toUpperCase();
    const etiquetaBase = retornosCount > 0
        ? `RETORNO/INGRESO DESDE ${sucursal}`
        : `INGRESO DESDE ${sucursal}`;
    return motivo ? `${etiquetaBase} — ${motivo}` : etiquetaBase;
}

/**
 * Planifica todas las escrituras necesarias para registrar un ingreso de sucursal
 * (tanto en producto nuevo como en producto existente).
 *
 * @param {Object} params
 * @param {'producto_nuevo'|'producto_existente'} params.modo
 * @param {string}        params.originBranch
 * @param {string}        [params.notes]
 * @param {Array<string>} params.rawCodes
 * @param {Array}         params.products
 * @param {Array}         params.barcodes
 * @param {Object|null}   [params.targetProduct]    Requerido si modo === 'producto_existente'
 * @param {string}        [params.fallbackModelShortCode] Código corto pre-generado para modelo nuevo
 * @param {Function}      params.buildEAN           Función `() => string` que entrega un EAN-13 único
 * @returns {Object} Plan listo para persistir en transacción Dexie
 */
export function planificarIngresoSucursal({
    modo,
    originBranch,
    notes = '',
    rawCodes = [],
    products = [],
    barcodes = [],
    targetProduct = null,
    fallbackModelShortCode = '',
    buildEAN,
} = {}) {
    const sucursal = texto(originBranch).toUpperCase();
    if (!sucursal) {
        throw new Error('Debes seleccionar la sucursal de origen');
    }
    if (!Array.isArray(rawCodes) || rawCodes.length === 0) {
        throw new Error('Debes ingresar al menos 1 unidad con su código corto de sucursal');
    }
    if (modo === 'producto_existente' && !targetProduct?.id) {
        throw new Error('Producto destino no válido');
    }

    const targetProductId = modo === 'producto_existente' ? targetProduct.id : null;
    const evaluacion = evaluarLoteCodigosSucursal({
        rawCodes,
        products,
        barcodes,
        targetProductId,
    });

    if (!evaluacion.valido) {
        const primerError = evaluacion.items.find((it) => !it.valido);
        throw new Error(primerError?.mensaje || 'Hay códigos cortos con conflicto');
    }

    const genEAN = typeof buildEAN === 'function' ? buildEAN : () => '';
    const unidadesAInsertar = [];
    const unidadesAReactivar = [];
    const unitCodesKardex = [];

    for (const item of evaluacion.items) {
        if (item.action === 'reactivate' && item.existingUnit) {
            const barcodeFinal = item.existingUnit.barcode || genEAN();
            unidadesAReactivar.push({
                id: item.existingUnit.id,
                shortCode: item.shortCode,
                barcode: barcodeFinal,
                originBranch: sucursal,
                previousTransferTo: item.existingUnit.transferTo || sucursal,
            });
            unitCodesKardex.push({
                shortCode: item.shortCode,
                barcode: barcodeFinal,
                originBranch: sucursal,
                isReturn: true,
            });
        } else {
            const barcodeFinal = genEAN();
            unidadesAInsertar.push({
                shortCode: item.shortCode,
                barcode: barcodeFinal,
                originBranch: sucursal,
            });
            unitCodesKardex.push({
                shortCode: item.shortCode,
                barcode: barcodeFinal,
                originBranch: sucursal,
                isReturn: false,
            });
        }
    }

    // Determinar el shortCode del producto (modelo) para la Tienda Virtual:
    // - Si es un producto NUEVO de 1 sola unidad (prenda única), el modelo adopta
    //   directamente el shortCode de la etiqueta de sucursal (regla de alineación).
    // - Si tiene varias unidades, usa fallbackModelShortCode salvo que haya sido
    //   tomado por una de las unidades ingresadas, en cuyo caso sugiere otro libre.
    let modelShortCode = targetProduct?.shortCode || fallbackModelShortCode || '';
    if (modo === 'producto_nuevo') {
        const codigosUnidades = evaluacion.items.map((it) => it.shortCode);
        if (codigosUnidades.length === 1) {
            modelShortCode = codigosUnidades[0];
        } else {
            const normFallback = normalizarCodigoSucursal(fallbackModelShortCode);
            const ocupadoPorLote = normFallback && codigosUnidades.includes(normFallback);
            const ocupadoPorOtroProd = normFallback && (products || []).some(
                (p) => normalizarCodigoSucursal(p?.shortCode) === normFallback
            );
            const ocupadoPorOtraUnidad = normFallback && (barcodes || []).some(
                (b) => normalizarCodigoSucursal(b?.shortCode) === normFallback
            );
            if (!normFallback || ocupadoPorLote || ocupadoPorOtroProd || ocupadoPorOtraUnidad) {
                modelShortCode = sugerirCodigoLibre(products, barcodes, codigosUnidades);
            } else {
                modelShortCode = normFallback;
            }
        }
    }

    const qty = evaluacion.items.length;
    const stockAnterior = modo === 'producto_existente' ? (Number(targetProduct.stock) || 0) : 0;
    const stockNuevo = stockAnterior + qty;

    return {
        modo,
        originBranch: sucursal,
        notes: texto(notes).toUpperCase(),
        kardexNotes: construirNotaKardexSucursal({
            originBranch: sucursal,
            notes,
            retornosCount: evaluacion.retornosCount,
        }),
        qty,
        stockAnterior,
        stockNuevo,
        modelShortCode,
        unidadesAInsertar,
        unidadesAReactivar,
        unitCodesKardex,
        resumen: {
            nuevosCount: evaluacion.nuevosCount,
            retornosCount: evaluacion.retornosCount,
        },
    };
}
