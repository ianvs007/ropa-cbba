/**
 * 🔄 SINCRONIZACIÓN v2 — cliente de red y orquestador (POS ↔ tienda virtual).
 *
 * Protocolo (docs/DISENO_SYNC_EVENTOS.md):
 *   1. PULL: bajar eventos (ventas/cancelaciones web) desde el último ack,
 *      aplicarlos en UNA transacción Dexie (idempotente por id) y confirmar.
 *   2. PUSH: subir el stock por globalId en lotes de 250 dentro de una sesión.
 *   2b. ETIQUETAS: subir las etiquetas físicas (shortCode de UNIDAD → globalId,
 *      disponible) en lotes de 500 dentro de la MISMA sesión. La nube las
 *      publica en bloque al finalizar, solo si llegaron todas.
 *   3. FINALIZAR: la nube desactiva lo que no vino en la sesión (solo si vio
 *      todos los productos esperados) y publica las etiquetas de la sesión.
 *   4. PULL corto: recoger ventas ocurridas durante el push.
 *
 * Cualquier corte se resuelve volviendo a llamar a `sincronizarV2()`.
 * No toca `sales` ni caja: el dinero de la web va al banco.
 */

import {
    db,
    getLocalISOString,
    garantizarGlobalIds,
    obtenerConfigSyncV2,
    idsEventosYaAplicados,
    aplicarPlanEventos,
} from '../db';
import { codigosDuplicadosEnFilas } from './syncExcel';
import {
    CLAVES_SYNC_V2,
    TAM_LOTE_SNAPSHOT,
    TAM_LOTE_ETIQUETAS,
    TAM_PAGINA_EVENTOS,
    armarFilasSnapshot,
    armarFilasEtiquetas,
    planificarAplicacionEventos,
    trocear,
    mensajeErrorHttp,
} from './syncV2';

export const URL_TIENDA_DEFAULT = 'https://tienda-virtual-26n.pages.dev';

const REINTENTOS_LOTE = 2;
const ESPERA_REINTENTO_MS = 1500;

let enCurso = false;
export const estaSincronizando = () => enCurso;

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

export class ErrorSync extends Error {
    constructor(mensaje, { fase = null, status = null, data = null } = {}) {
        super(mensaje);
        this.name = 'ErrorSync';
        this.fase = fase;
        this.status = status;
        this.data = data;
    }
}

/** Llamada JSON a la nube con manejo uniforme de errores (siempre JSON o mensaje claro). */
async function llamar(base, token, ruta, { method = 'GET', body = null, query = null } = {}, contexto = '') {
    const url = new URL(`${base}${ruta}`);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    let resp;
    try {
        resp = await fetch(url.toString(), {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            body: body ? JSON.stringify(body) : undefined,
        });
    } catch (err) {
        console.error(`Fallo de red/CORS en ${ruta}:`, err);
        throw new ErrorSync(
            `No se pudo contactar la tienda (red o CORS)${contexto ? ` en ${contexto}` : ''}. Si la web abre en el navegador, vuelve a sincronizar.`,
            { status: 0 }
        );
    }
    const textoResp = await resp.text().catch(() => '');
    let data = null;
    try {
        data = textoResp ? JSON.parse(textoResp) : null;
    } catch {
        data = null;
    }
    if (!resp.ok) {
        throw new ErrorSync(mensajeErrorHttp(resp.status, data, contexto), { status: resp.status, data });
    }
    if (data === null) {
        throw new ErrorSync(`La tienda respondió sin JSON${contexto ? ` (${contexto})` : ''}. Vuelve a sincronizar.`, { status: resp.status });
    }
    return data;
}

/** Con reintentos para fallos de red o 5xx (nunca para 4xx). */
async function llamarConReintentos(...args) {
    let ultimo;
    for (let intento = 0; intento <= REINTENTOS_LOTE; intento++) {
        try {
            return await llamar(...args);
        } catch (err) {
            ultimo = err;
            const reintentable = err instanceof ErrorSync && (err.status === 0 || err.status >= 500);
            if (!reintentable || intento === REINTENTOS_LOTE) throw err;
            await dormir(ESPERA_REINTENTO_MS * (intento + 1));
        }
    }
    throw ultimo;
}

async function leerConexion() {
    const [url, token] = await Promise.all([db.settings.get('syncUrl'), db.settings.get('syncToken')]);
    const base = String(url?.value || URL_TIENDA_DEFAULT).replace(/\/+$/, '');
    const tok = String(token?.value || '').trim();
    if (!tok) throw new ErrorSync('Configura primero la URL y el token de la tienda (admin web → Ajustes).', { fase: 'preparando' });
    return { base, token: tok };
}

/**
 * Baja y aplica TODOS los eventos pendientes (paginado). Devuelve el acumulado.
 */
async function bajarYAplicarEventos({ base, token, config, onProgreso }) {
    const acumulado = {
        eventos: 0, aplicados: 0, huerfanos: 0, saltados: 0,
        unidadesDescontadas: 0, unidadesRepuestas: 0, avisos: 0,
        detalleAvisos: [], huerfanosDetalle: [], ultimoId: config.ultimoEventoAck,
    };
    let desde = config.ultimoEventoAck;
    // Tope defensivo: nunca más de 200 páginas (100k eventos) por corrida.
    for (let pagina = 0; pagina < 200; pagina++) {
        const r = await llamarConReintentos(base, token, '/api/sync/v2/eventos', {
            query: { dispositivo: config.dispositivoId, desde, limite: TAM_PAGINA_EVENTOS },
        }, `eventos desde ${desde}`);
        const eventos = Array.isArray(r.eventos) ? r.eventos : [];
        if (eventos.length === 0) break;

        const [products, barcodes, yaAplicados] = await Promise.all([
            db.products.toArray(),
            db.barcodes.toArray(),
            idsEventosYaAplicados(eventos.map(e => e.id)),
        ]);
        const plan = planificarAplicacionEventos({ eventos, products, barcodes, yaAplicados });
        await aplicarPlanEventos(plan);

        acumulado.eventos += plan.resumen.eventos;
        acumulado.aplicados += plan.resumen.aplicados;
        acumulado.huerfanos += plan.resumen.huerfanos;
        acumulado.saltados += plan.resumen.saltados;
        acumulado.unidadesDescontadas += plan.resumen.unidadesDescontadas;
        acumulado.unidadesRepuestas += plan.resumen.unidadesRepuestas;
        acumulado.avisos += plan.resumen.avisos;
        for (const op of plan.operaciones) {
            if (op.aviso && acumulado.detalleAvisos.length < 50) {
                acumulado.detalleAvisos.push(`#${op.pedidoRef} · ${op.aviso}`);
            }
        }
        for (const h of plan.huerfanos) {
            if (acumulado.huerfanosDetalle.length < 50) acumulado.huerfanosDetalle.push(h);
        }
        if (plan.ultimoId > desde) desde = plan.ultimoId;
        acumulado.ultimoId = Math.max(acumulado.ultimoId, desde);

        // Ack: si falla, no importa — la tabla webEventos neutraliza la repetición.
        try {
            await llamar(base, token, '/api/sync/v2/ack', {
                method: 'POST',
                body: { dispositivo: config.dispositivoId, hastaId: desde },
            }, 'ack');
        } catch (err) {
            console.warn('Ack de eventos falló (se repetirá en la próxima sync):', err?.message);
        }
        onProgreso?.({ fase: 'bajando', eventos: acumulado.eventos });
        if (!r.hayMas) break;
    }
    return acumulado;
}

/**
 * Sincronización completa. Lanza ErrorSync con mensaje accionable si algo
 * impide continuar. Guarda `syncV2.ultimaOk` / `syncV2.ultimoError` en settings.
 *
 * @param {Object} [opts]
 * @param {(p: {fase: string, hechas?: number, total?: number, eventos?: number}) => void} [opts.onProgreso]
 * @param {boolean} [opts.desactivarAusentes=true]
 */
export async function sincronizarV2({ onProgreso, desactivarAusentes = true } = {}) {
    if (enCurso) throw new ErrorSync('Ya hay una sincronización en curso.', { fase: 'preparando' });
    enCurso = true;
    const inicio = Date.now();
    try {
        onProgreso?.({ fase: 'preparando' });
        const { base, token } = await leerConexion();
        const completados = await garantizarGlobalIds();
        const config = await obtenerConfigSyncV2();

        // ── 1. PULL ──
        onProgreso?.({ fase: 'bajando', eventos: 0 });
        const eventos = await bajarYAplicarEventos({ base, token, config, onProgreso });

        // ── 2. PUSH ──
        const todos = await db.products.toArray();
        const { filas, sinCodigo, sinGlobalId, productosDistintos } = armarFilasSnapshot(todos);
        if (filas.length === 0) {
            throw new ErrorSync('No hay productos activos con código corto y globalId para sincronizar.', { fase: 'subiendo' });
        }
        const dups = codigosDuplicadosEnFilas(filas);
        if (dups.length > 0) {
            const e = new ErrorSync(
                `Sincronización bloqueada: ${dups.length} código(s) corto(s) duplicado(s). Repáralos con "Reparar códigos duplicados".`,
                { fase: 'subiendo' }
            );
            e.duplicados = dups;
            throw e;
        }

        const sesion = `${getLocalISOString().replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomUUID().slice(0, 8)}`;
        const lotes = trocear(filas, TAM_LOTE_SNAPSHOT);
        const snapshot = {
            filas: filas.length, lotes: lotes.length, creadasProductos: 0, creadasVariantes: 0,
            actualizadas: 0, adoptados: 0, codigosLiberados: 0, rechazadas: 0, detalle: [],
        };
        onProgreso?.({ fase: 'subiendo', hechas: 0, total: filas.length });
        for (let i = 0; i < lotes.length; i++) {
            const r = await llamarConReintentos(base, token, '/api/sync/v2/snapshot', {
                method: 'POST',
                body: {
                    dispositivo: config.dispositivoId,
                    nombreDispositivo: config.nombreDispositivo,
                    sesion,
                    filas: lotes[i],
                },
            }, `lote ${i + 1}/${lotes.length}`);
            snapshot.creadasProductos += r.creadasProductos || 0;
            snapshot.creadasVariantes += r.creadasVariantes || 0;
            snapshot.actualizadas += r.actualizadas || 0;
            snapshot.adoptados += r.adoptados || 0;
            snapshot.codigosLiberados += r.codigosLiberados || 0;
            snapshot.rechazadas += r.rechazadas || 0;
            for (const d of r.detalle || []) {
                if (d?.aviso && snapshot.detalle.length < 100) snapshot.detalle.push(d);
            }
            onProgreso?.({ fase: 'subiendo', hechas: Math.min((i + 1) * TAM_LOTE_SNAPSHOT, filas.length), total: filas.length });
        }

        // ── 2b. ETIQUETAS FÍSICAS (misma sesión) ──
        // Cada unidad (barcodes.shortCode) viaja con el globalId de su producto y
        // si sigue disponible. La nube las aterriza por lote y las publica en
        // bloque al finalizar; un corte acá no deja nada a medias en la web.
        const barcodes = await db.barcodes.toArray();
        const planEtiquetas = armarFilasEtiquetas(todos, barcodes);
        const etiquetas = {
            soportado: true,
            filas: planEtiquetas.filas.length,
            lotes: 0,
            recibidas: 0,
            rechazadas: 0,
            invalidas: planEtiquetas.invalidas.length,
            duplicadas: planEtiquetas.duplicadas,
            publicadas: 0,
            retiradas: 0,
            sinProducto: 0,
            detalle: [],
        };
        const lotesEtiquetas = trocear(planEtiquetas.filas, TAM_LOTE_ETIQUETAS);
        etiquetas.lotes = lotesEtiquetas.length;
        onProgreso?.({ fase: 'subiendo_etiquetas', hechas: 0, total: planEtiquetas.filas.length });
        for (let i = 0; i < lotesEtiquetas.length && etiquetas.soportado; i++) {
            let r;
            try {
                r = await llamarConReintentos(base, token, '/api/sync/v2/etiquetas', {
                    method: 'POST',
                    body: {
                        dispositivo: config.dispositivoId,
                        sesion,
                        etiquetas: lotesEtiquetas[i],
                    },
                }, `etiquetas lote ${i + 1}/${lotesEtiquetas.length}`);
            } catch (err) {
                // Tienda anterior a la migración 007: sin el endpoint. Se sigue sin
                // etiquetas y NO se manda el campo en finalizar (la nube no borra nada).
                if (err instanceof ErrorSync && err.status === 404) {
                    etiquetas.soportado = false;
                    console.warn('La tienda aún no soporta etiquetas físicas (404 en /api/sync/v2/etiquetas).');
                    break;
                }
                throw err;
            }
            etiquetas.recibidas += r.recibidas || 0;
            etiquetas.rechazadas += r.rechazadas || 0;
            for (const d of r.detalle || []) {
                if (etiquetas.detalle.length < 50) etiquetas.detalle.push(d);
            }
            onProgreso?.({
                fase: 'subiendo_etiquetas',
                hechas: Math.min((i + 1) * TAM_LOTE_ETIQUETAS, planEtiquetas.filas.length),
                total: planEtiquetas.filas.length,
            });
        }

        // ── 3. FINALIZAR ──
        onProgreso?.({ fase: 'finalizando' });
        const fin = await llamarConReintentos(base, token, '/api/sync/v2/finalizar', {
            method: 'POST',
            body: {
                dispositivo: config.dispositivoId,
                sesion,
                productosEsperados: productosDistintos,
                desactivarAusentes,
                // Solo si la tienda aceptó las etiquetas: omitir el campo significa
                // "no toques las asociaciones publicadas" (cliente anterior).
                ...(etiquetas.soportado ? { etiquetas: { esperadas: etiquetas.recibidas } } : {}),
            },
        }, 'finalizar');
        if (etiquetas.soportado && fin.etiquetas) {
            etiquetas.publicadas = fin.etiquetas.publicadas || 0;
            etiquetas.retiradas = fin.etiquetas.retiradas || 0;
            etiquetas.sinProducto = fin.etiquetas.sinProducto || 0;
        }

        // ── 4. PULL corto ──
        onProgreso?.({ fase: 'bajando_final' });
        const configPost = await obtenerConfigSyncV2();
        const eventosFinal = await bajarYAplicarEventos({ base, token, config: configPost, onProgreso: null });

        const fecha = getLocalISOString();
        await db.settings.bulkPut([
            { key: CLAVES_SYNC_V2.ultimaOk, value: fecha },
            { key: CLAVES_SYNC_V2.ultimoError, value: '' },
            { key: 'ultimaSyncDirecta', value: fecha }, // compat con la tarjeta actual
        ]);
        onProgreso?.({ fase: 'ok' });

        return {
            fecha,
            duracionMs: Date.now() - inicio,
            globalIdsCompletados: completados,
            eventos: {
                ...eventos,
                eventos: eventos.eventos + eventosFinal.eventos,
                aplicados: eventos.aplicados + eventosFinal.aplicados,
                huerfanos: eventos.huerfanos + eventosFinal.huerfanos,
                saltados: eventos.saltados + eventosFinal.saltados,
                unidadesDescontadas: eventos.unidadesDescontadas + eventosFinal.unidadesDescontadas,
                unidadesRepuestas: eventos.unidadesRepuestas + eventosFinal.unidadesRepuestas,
                avisos: eventos.avisos + eventosFinal.avisos,
                detalleAvisos: [...eventos.detalleAvisos, ...eventosFinal.detalleAvisos].slice(0, 50),
                huerfanosDetalle: [...eventos.huerfanosDetalle, ...eventosFinal.huerfanosDetalle].slice(0, 50),
            },
            snapshot,
            etiquetas,
            finalizar: { desactivados: fin.desactivados || 0, vistos: fin.vistos || 0 },
            sinCodigo: sinCodigo.length,
            sinGlobalId: sinGlobalId.length,
        };
    } catch (err) {
        const mensaje = err?.message || String(err);
        try {
            await db.settings.put({ key: CLAVES_SYNC_V2.ultimoError, value: `${getLocalISOString()} · ${mensaje}` });
        } catch { /* sin bloquear el error original */ }
        throw err;
    } finally {
        enCurso = false;
    }
}
