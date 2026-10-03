/**
 * 🔄 SINCRONIZACIÓN v2 POR EVENTOS — lógica PURA (sin Dexie, sin red).
 *
 * Diseño: docs/DISENO_SYNC_EVENTOS.md. La nube registra cada venta /
 * cancelación / expiración web como un evento con id creciente; el POS los baja
 * en orden, los aplica y confirma hasta qué id llegó. Este módulo decide QUÉ
 * hacer con una página de eventos y cómo armar el snapshot; la capa Dexie
 * (db/helpers.js) y la de red (syncV2Cliente.js) solo ejecutan lo decidido.
 *
 * Además (2026-10-03): eventos `confirmacion` / `entrega` (delta 0) crean o
 * actualizan el historial de ventas como "Venta en línea" sin tocar caja:
 * Pendiente de entrega → Entregado.
 *
 * Idempotencia: cada evento aplicado queda en la tabla `webEventos` con su id
 * de nube como clave primaria. `planificarAplicacionEventos` recibe ese
 * conjunto y salta lo ya aplicado, así que repetir una página tras un corte
 * de red nunca descuenta dos veces.
 */

/** Método de pago de las ventas web: no cuenta en efectivo ni en QR de caja. */
export const PAGO_VENTA_EN_LINEA = 'en_linea';

export const CLAVES_SYNC_V2 = Object.freeze({
    dispositivoId: 'syncV2.dispositivoId',
    nombreDispositivo: 'syncV2.nombreDispositivo',
    ultimoEventoAck: 'syncV2.ultimoEventoAck',
    auto: 'syncV2.auto',
    intervaloMin: 'syncV2.intervaloMin',
    ultimaOk: 'syncV2.ultimaOk',
    ultimoError: 'syncV2.ultimoError',
});

export const TAM_LOTE_SNAPSHOT = 250;
export const TAM_LOTE_ETIQUETAS = 500;
export const TAM_PAGINA_EVENTOS = 500;
export const INTERVALO_AUTO_DEFAULT_MIN = 10;

/** Prefijo con el que se marca en `barcodes.usedRef` la unidad vendida en la web. */
export const PREFIJO_REF_WEB = 'WEB #';

const texto = (v) => String(v ?? '').trim();

/**
 * Normalización ESTRICTA de una etiqueta física (shortCode de UNIDAD, lo que
 * imprime MassLabeling). Válida = 1 a 5 dígitos → se rellena a 5 con ceros
 * ('2797' → '02797'). Cualquier otra cosa devuelve null: nunca se recorta ni
 * se limpia para "rescatar" un código inválido. Debe ser idéntica a la de la
 * nube (functions/lib/codigo.js::normalizarEtiqueta).
 */
export function normalizarEtiqueta(valor) {
    const c = texto(valor);
    return /^\d{1,5}$/.test(c) ? c.padStart(5, '0') : null;
}

/**
 * Parte una lista en lotes de tamaño fijo (el último puede ser más corto).
 */
export function trocear(lista = [], tam = TAM_LOTE_SNAPSHOT) {
    const n = Math.max(1, Number(tam) || TAM_LOTE_SNAPSHOT);
    const lotes = [];
    for (let i = 0; i < (lista || []).length; i += n) lotes.push(lista.slice(i, i + n));
    return lotes;
}

/**
 * Filas del snapshot a partir de los productos del POS. Solo activos con
 * shortCode; el globalId es OBLIGATORIO (la nube rechaza filas sin él).
 *
 * @returns {{ filas: Array, sinCodigo: Array, sinGlobalId: Array, productosDistintos: number }}
 */
export function armarFilasSnapshot(products = []) {
    const filas = [];
    const sinCodigo = [];
    const sinGlobalId = [];
    const globalIds = new Set();

    for (const p of products || []) {
        if (p?.active === false) continue;
        const codigo = texto(p?.shortCode);
        if (!codigo) {
            sinCodigo.push(p);
            continue;
        }
        const globalId = texto(p?.globalId);
        if (!globalId) {
            sinGlobalId.push(p);
            continue;
        }
        const precio = Number(p.price);
        globalIds.add(globalId);
        filas.push({
            globalId,
            codigo,
            nombre: p.name ?? '',
            talla: p.size ?? '',
            color: p.color ?? '',
            stock: Math.max(0, Math.floor(Number(p.stock) || 0)),
            precio: Number.isFinite(precio) && precio >= 0 ? precio : 0,
        });
    }

    return { filas, sinCodigo, sinGlobalId, productosDistintos: globalIds.size };
}

/**
 * Filas de ETIQUETAS FÍSICAS para la nube: una por (etiqueta, producto) con
 * el globalId del producto y si la unidad sigue disponible (`!used`).
 *
 * La etiqueta es `barcodes.shortCode` (lo impreso en la prenda), que NO es el
 * shortCode del producto: por eso la nube encontraba otra prenda (02797 =
 * etiqueta de VESTIDO BRILLO y a la vez código de modelo de VESTIDO
 * VICTORIANO) o ninguna (prendas con varias unidades). Se publican como alias
 * de búsqueda vinculados por identidad; el código de modelo sigue en
 * `armarFilasSnapshot`.
 *
 * Reglas:
 *  - Solo unidades de productos que VAN en el snapshot (activos, con shortCode
 *    y globalId): las de productos archivados o sin publicar se omiten y, al
 *    finalizar la sesión, la nube retira lo que no llegó.
 *  - Las unidades vendidas (`used`) SÍ viajan con `disponible: false`: la
 *    etiqueta sigue identificando la prenda, pero la web avisa que esa unidad
 *    ya se vendió. `disponible` es informativo: no toca el stock.
 *  - Varias unidades del mismo producto con la misma etiqueta → una fila,
 *    disponible si alguna lo está.
 *  - La misma etiqueta en productos DISTINTOS se envía tal cual (la nube la
 *    muestra como conflicto) y se reporta en `duplicadas` para repararla en
 *    el POS (fixMissingShortCodes).
 *  - Etiquetas que no son 1-5 dígitos se omiten y se listan en `invalidas`.
 *
 * @param {Array} products
 * @param {Array} barcodes  tabla `barcodes` (productId, shortCode, used)
 * @returns {{ filas: Array<{ etiqueta, globalId, disponible }>, invalidas: Array, duplicadas: Array<{ etiqueta, productos: Array<{ id, name, globalId }> }>, omitidasSinPublicar: number }}
 */
export function armarFilasEtiquetas(products = [], barcodes = []) {
    const publicados = new Map(); // productId → producto publicable
    for (const p of products || []) {
        if (p?.active === false) continue;
        if (!texto(p?.shortCode) || !texto(p?.globalId)) continue;
        publicados.set(p.id, p);
    }

    const porClave = new Map();      // `${etiqueta}|${globalId}` → fila
    const productosPorEtiqueta = new Map(); // etiqueta → Map(productId → producto)
    const invalidas = [];
    let omitidasSinPublicar = 0;

    for (const u of barcodes || []) {
        const producto = publicados.get(u?.productId);
        if (!producto) {
            omitidasSinPublicar++;
            continue;
        }
        const etiqueta = normalizarEtiqueta(u?.shortCode);
        if (!etiqueta) {
            invalidas.push({ unidadId: u?.id ?? null, productId: u.productId, shortCode: texto(u?.shortCode), name: producto.name ?? '' });
            continue;
        }
        const globalId = texto(producto.globalId);
        const disponible = !u.used;
        const clave = `${etiqueta}|${globalId}`;
        const previa = porClave.get(clave);
        if (previa) previa.disponible = previa.disponible || disponible;
        else porClave.set(clave, { etiqueta, globalId, disponible });

        if (!productosPorEtiqueta.has(etiqueta)) productosPorEtiqueta.set(etiqueta, new Map());
        productosPorEtiqueta.get(etiqueta).set(producto.id, producto);
    }

    const duplicadas = [];
    for (const [etiqueta, mapa] of productosPorEtiqueta) {
        if (mapa.size > 1) {
            duplicadas.push({
                etiqueta,
                productos: [...mapa.values()].map(p => ({ id: p.id, name: p.name ?? '', globalId: texto(p.globalId) })),
            });
        }
    }
    duplicadas.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta));

    const filas = [...porClave.values()].sort((a, b) => a.etiqueta.localeCompare(b.etiqueta) || a.globalId.localeCompare(b.globalId));
    return { filas, invalidas, duplicadas, omitidasSinPublicar };
}

/**
 * Decide cómo aplicar una página de eventos sobre el estado actual del POS.
 * NO muta los arrays recibidos: trabaja sobre copias en memoria para que
 * varios eventos del mismo producto en la misma página se encadenen bien.
 *
 * @param {Object} p
 * @param {Array}  p.eventos     [{ id, tipo, globalId, codigo, nombre, talla, color, delta, pedidoRef, creadoEn }]
 * @param {Array}  p.products    tabla `products` (id, globalId, shortCode, stock, name)
 * @param {Array}  p.barcodes    tabla `barcodes` (id, productId, used, usedRef?, shortCode, barcode)
 * @param {Set}    p.yaAplicados ids de `webEventos`
 * @returns {{
 *   operaciones: Array<{
 *     eventoId, tipo, productId, delta, stockAnterior, stockNuevo, pedidoRef,
 *     unidadesAMarcar: Array<{id, shortCode, barcode}>,
 *     unidadesALiberar: Array<{id, shortCode, barcode}>,
 *     kardex: { type: 'salida'|'entrada', qty, notes },
 *     aviso: string|null
 *   }>,
 *   huerfanos: Array<{ eventoId, tipo, globalId, codigo, nombre, motivo }>,
 *   saltados: number[],
 *   ultimoId: number,
 *   resumen: { eventos, aplicados, huerfanos, saltados, unidadesDescontadas, unidadesRepuestas, avisos }
 * }}
 */
export function planificarAplicacionEventos({ eventos = [], products = [], barcodes = [], yaAplicados = new Set() }) {
    const porGlobalId = new Map();
    const porCodigo = new Map();
    const estadoProducto = new Map(); // id → { stock }
    for (const p of products || []) {
        const g = texto(p?.globalId);
        if (g) porGlobalId.set(g, p);
        const c = texto(p?.shortCode);
        if (c && !porCodigo.has(c)) porCodigo.set(c, p);
        estadoProducto.set(p.id, { stock: Math.max(0, Number(p.stock) || 0) });
    }
    const unidadesDe = new Map(); // productId → [{...unidad}] copia mutable
    for (const u of barcodes || []) {
        if (!unidadesDe.has(u.productId)) unidadesDe.set(u.productId, []);
        unidadesDe.get(u.productId).push({ ...u });
    }
    for (const lista of unidadesDe.values()) lista.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

    const plan = {
        operaciones: [],
        huerfanos: [],
        saltados: [],
        ultimoId: 0,
        resumen: { eventos: 0, aplicados: 0, huerfanos: 0, saltados: 0, unidadesDescontadas: 0, unidadesRepuestas: 0, avisos: 0 },
    };

    const ordenados = [...(eventos || [])].sort((a, b) => Number(a.id) - Number(b.id));
    for (const e of ordenados) {
        const id = Number(e?.id);
        if (!Number.isInteger(id) || id <= 0) continue;
        plan.resumen.eventos++;
        plan.ultimoId = Math.max(plan.ultimoId, id);

        if (yaAplicados.has(id)) {
            plan.saltados.push(id);
            plan.resumen.saltados++;
            continue;
        }

        const tipo = texto(e.tipo);
        const delta = Number(e.delta);
        const globalId = texto(e.globalId);
        const codigo = texto(e.codigo);
        const pedidoRef = texto(e.pedidoRef) || 'SIN-REF';
        const nombreEvt = texto(e.nombre);
        const talla = texto(e.talla);
        const color = texto(e.color);
        const precioUnit = Number(e.precioUnit) || 0;
        const cantidadEvt = Math.max(1, Math.abs(Number(e.cantidad) || Number(e.delta) || 1));

        // Identidad: globalId manda. Fallback por código SOLO si el evento no
        // trae globalId (venta anterior al bootstrap del producto en la nube).
        const producto = (globalId && porGlobalId.get(globalId)) || (!globalId && codigo ? porCodigo.get(codigo) : null);

        // Historial (sin stock ni caja): confirmacion / entrega.
        if (tipo === 'confirmacion' || tipo === 'entrega') {
            plan.operaciones.push({
                eventoId: id,
                tipo,
                soloHistorial: true,
                productId: producto?.id ?? null,
                delta: 0,
                stockAnterior: producto ? estadoProducto.get(producto.id).stock : null,
                stockNuevo: producto ? estadoProducto.get(producto.id).stock : null,
                pedidoRef,
                unidadesAMarcar: [],
                unidadesALiberar: [],
                kardex: { type: 'salida', qty: 0, notes: '' },
                historial: {
                    accion: tipo === 'confirmacion' ? 'alta' : 'entregar',
                    deliveryStatus: tipo === 'confirmacion' ? 'pendiente_entrega' : 'entregado',
                    item: {
                        productId: producto?.id ?? null,
                        name: nombreEvt || producto?.name || 'Prenda web',
                        qty: cantidadEvt,
                        price: precioUnit || Number(producto?.price) || 0,
                        size: talla || producto?.size || '',
                        color: color || producto?.color || '',
                        shortCode: codigo || producto?.shortCode || '',
                        globalId: globalId || producto?.globalId || '',
                        eventoId: id,
                    },
                    creadoEn: e.creadoEn || null,
                },
                aviso: producto ? null : `Producto no encontrado en POS; historial igual se registra (${nombreEvt || codigo || globalId})`,
            });
            plan.resumen.aplicados++;
            if (!producto) plan.resumen.avisos++;
            continue;
        }

        if (!producto || !Number.isInteger(delta) || delta === 0 || !['venta', 'cancelacion', 'expiracion'].includes(tipo)) {
            plan.huerfanos.push({
                eventoId: id,
                tipo,
                globalId,
                codigo,
                nombre: nombreEvt,
                motivo: !producto
                    ? (globalId ? `Producto con globalId ${globalId} no existe en este POS` : `Sin globalId y código ${codigo || '?'} no encontrado`)
                    : 'Evento inválido (tipo o delta)',
            });
            plan.resumen.huerfanos++;
            continue;
        }

        const estado = estadoProducto.get(producto.id);
        const unidades = unidadesDe.get(producto.id) || [];
        const qty = Math.abs(delta);
        const refWeb = `${PREFIJO_REF_WEB}${pedidoRef}`;
        let aviso = null;

        if (delta < 0) {
            const descontable = Math.min(qty, estado.stock);
            if (descontable < qty) {
                aviso = `Stock insuficiente en el POS para ${qty} unidad(es): se descontó ${descontable}`;
            }
            const stockNuevo = estado.stock - descontable;
            const libres = unidades.filter((u) => !u.used).slice(0, descontable);
            for (const u of libres) {
                u.used = true;
                u.usedRef = refWeb;
            }
            estado.stock = stockNuevo;
            plan.operaciones.push({
                eventoId: id,
                tipo,
                productId: producto.id,
                delta: -descontable,
                stockAnterior: stockNuevo + descontable,
                stockNuevo,
                pedidoRef,
                unidadesAMarcar: libres.map((u) => ({ id: u.id, shortCode: u.shortCode || '', barcode: u.barcode || '' })),
                unidadesALiberar: [],
                kardex: {
                    type: 'salida',
                    qty: descontable,
                    notes: `VENTA EN LÍNEA #${pedidoRef}`.toUpperCase(),
                },
                aviso,
            });
            plan.resumen.unidadesDescontadas += descontable;
        } else {
            const stockNuevo = estado.stock + qty;
            // Liberar SOLO unidades marcadas por ESTE pedido web; nunca una
            // vendida en mostrador.
            const propias = unidades.filter((u) => u.used && texto(u.usedRef) === refWeb).slice(0, qty);
            for (const u of propias) {
                u.used = false;
                u.usedRef = '';
            }
            if (propias.length < qty) {
                aviso = `Se repuso el stock (+${qty}) pero solo ${propias.length} etiqueta(s) se pudieron reactivar: revisar unidades del producto`;
            }
            estado.stock = stockNuevo;
            plan.operaciones.push({
                eventoId: id,
                tipo,
                productId: producto.id,
                delta: qty,
                stockAnterior: stockNuevo - qty,
                stockNuevo,
                pedidoRef,
                unidadesAMarcar: [],
                unidadesALiberar: propias.map((u) => ({ id: u.id, shortCode: u.shortCode || '', barcode: u.barcode || '' })),
                kardex: {
                    type: 'entrada',
                    qty,
                    notes: `${tipo === 'expiracion' ? 'EXPIRACIÓN' : 'CANCELACIÓN'} WEB #${pedidoRef}`.toUpperCase(),
                },
                // Si ya había historial por confirmación, anularlo.
                historial: { accion: 'cancelar' },
                aviso,
            });
            plan.resumen.unidadesRepuestas += qty;
        }
        plan.resumen.aplicados++;
        if (aviso) plan.resumen.avisos++;
    }

    return plan;
}

/**
 * Traduce una respuesta HTTP de la nube a un mensaje accionable en español.
 * @param {number} status
 * @param {any} data  cuerpo JSON (o null si no era JSON)
 * @param {string} contexto  p.ej. 'snapshot lote 3/11'
 */
export function mensajeErrorHttp(status, data, contexto = '') {
    const sufijo = contexto ? ` (${contexto})` : '';
    if (status === 401) return 'Token inválido: revísalo en el admin web → Ajustes.';
    if (status === 503) return 'La tienda aún no tiene token configurado (admin web → Ajustes).';
    if (status === 400) return `La tienda rechazó la solicitud${sufijo}: ${data?.error || 'datos inválidos'}.`;
    if (status === 409) return `${data?.error || 'Conflicto en la tienda'}${sufijo}`;
    if (status === 404) return `La tienda no tiene la sincronización v2 desplegada${sufijo}. Actualiza la tienda virtual.`;
    if (data === null) return `La tienda respondió ${status} sin JSON${sufijo} (posible timeout). Vuelve a sincronizar.`;
    return `La tienda respondió error ${status}${sufijo}: ${data?.error || 'sin detalle'}. Vuelve a sincronizar.`;
}

/**
 * Decide si toca correr la sync automática.
 * @param {Object} p
 * @param {boolean} p.auto            settings.syncV2.auto
 * @param {string|null} p.ultimaOk    ISO de la última sync OK
 * @param {number} p.intervaloMin
 * @param {Date|number} p.ahora
 */
export function debeSincronizarAuto({ auto, ultimaOk, intervaloMin = INTERVALO_AUTO_DEFAULT_MIN, ahora = Date.now() }) {
    if (!auto) return false;
    const intervaloMs = Math.max(1, Number(intervaloMin) || INTERVALO_AUTO_DEFAULT_MIN) * 60 * 1000;
    if (!ultimaOk) return true;
    const t = new Date(ultimaOk).getTime();
    if (!Number.isFinite(t)) return true;
    const ahoraMs = ahora instanceof Date ? ahora.getTime() : Number(ahora);
    return ahoraMs - t >= intervaloMs;
}
