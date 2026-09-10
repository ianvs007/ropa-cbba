/**
 * 🔄 SINCRONIZACIÓN v2 POR EVENTOS — lógica PURA (sin Dexie, sin red).
 *
 * Diseño: docs/DISENO_SYNC_EVENTOS.md. La nube registra cada venta /
 * cancelación / expiración web como un evento con id creciente; el POS los baja
 * en orden, los aplica y confirma hasta qué id llegó. Este módulo decide QUÉ
 * hacer con una página de eventos y cómo armar el snapshot; la capa Dexie
 * (db/helpers.js) y la de red (syncV2Cliente.js) solo ejecutan lo decidido.
 *
 * Idempotencia: cada evento aplicado queda en la tabla `webEventos` con su id
 * de nube como clave primaria. `planificarAplicacionEventos` recibe ese
 * conjunto y salta lo ya aplicado, así que repetir una página tras un corte
 * de red nunca descuenta dos veces.
 */

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
export const TAM_PAGINA_EVENTOS = 500;
export const INTERVALO_AUTO_DEFAULT_MIN = 10;

/** Prefijo con el que se marca en `barcodes.usedRef` la unidad vendida en la web. */
export const PREFIJO_REF_WEB = 'WEB #';

const texto = (v) => String(v ?? '').trim();

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

        // Identidad: globalId manda. Fallback por código SOLO si el evento no
        // trae globalId (venta anterior al bootstrap del producto en la nube).
        const producto = (globalId && porGlobalId.get(globalId)) || (!globalId && codigo ? porCodigo.get(codigo) : null);
        if (!producto || !Number.isInteger(delta) || delta === 0 || !['venta', 'cancelacion', 'expiracion'].includes(tipo)) {
            plan.huerfanos.push({
                eventoId: id,
                tipo,
                globalId,
                codigo,
                nombre: texto(e.nombre),
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
