import {
    db,
    ensureBranchExists,
    generateUniqueBarcode,
    getLocalISOString,
    obtenerConfigSyncV2,
    registerBranchTransferInProduct,
} from '../db';
import {
    evaluarCodigoSucursal,
    sugerirCodigoLibre,
} from './branchTransferIn';
import {
    CLAVE_SUCURSAL_LOCAL,
    SUCURSAL_LOCAL_DEFAULT,
    buscarProductoCompatibleLocal,
    filtrarBandejaEntrante,
    normalizarNombreSucursal,
    validarPaqueteTraslado,
} from './cloudBranchTransfers';
import { URL_TIENDA_DEFAULT } from './syncV2Cliente';

/**
 * Obtiene el nombre configurado para ESTA tienda física (ej. "TIENDA PRINCIPAL" o "SUCURSAL 1").
 */
export async function obtenerSucursalLocal() {
    const row = await db.settings.get(CLAVE_SUCURSAL_LOCAL);
    return normalizarNombreSucursal(row?.value) || SUCURSAL_LOCAL_DEFAULT;
}

/**
 * Guarda el nombre de ESTA tienda física en `settings`.
 */
export async function guardarSucursalLocal(nombre) {
    const norm = normalizarNombreSucursal(nombre) || SUCURSAL_LOCAL_DEFAULT;
    await db.settings.put({ key: CLAVE_SUCURSAL_LOCAL, value: norm });
    await ensureBranchExists(norm);
    return norm;
}

/**
 * Obtiene URL base y token Bearer de la nube configurados en /sync.
 */
async function obtenerCredencialesNube() {
    const cfg = await obtenerConfigSyncV2();
    const base = String(cfg?.url || URL_TIENDA_DEFAULT).replace(/\/+$/, '');
    const token = String(cfg?.token || '').trim();
    return { base, token };
}

async function fetchJsonNube(base, token, ruta, { method = 'GET', body = null, query = null } = {}) {
    if (!token) {
        const err = new Error('Falta configurar el Token de sincronización en /sync.');
        err.code = 'NO_TOKEN';
        throw err;
    }
    const url = new URL(`${base}${ruta}`);
    if (query) {
        for (const [k, v] of Object.entries(query)) {
            if (v !== undefined && v !== null && String(v).trim() !== '') {
                url.searchParams.set(k, String(v));
            }
        }
    }

    const resp = await fetch(url.toString(), {
        method,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await resp.text().catch(() => '');
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch {
        data = null;
    }

    if (!resp.ok) {
        const msg =
            resp.status === 404
                ? 'El buzón de traslados aún no está habilitado en la tienda virtual (/api/traslados).'
                : data?.error || `Error ${resp.status} al comunicarse con la nube.`;
        const err = new Error(msg);
        err.status = resp.status;
        throw err;
    }

    return data || {};
}

/**
 * Registra un paquete de traslado saliente en la cola local (`db.branchTransfers`)
 * e intenta subirlo inmediatamente al buzón en la nube.
 *
 * @returns {Promise<{ queued: boolean, sentToCloud: boolean, message: string, recordId: number }>}
 */
export async function encolarYEnviarTrasladoNube(paquete) {
    if (!db.branchTransfers) {
        return {
            queued: false,
            sentToCloud: false,
            message: 'Tabla branchTransfers no disponible.',
            recordId: null,
        };
    }

    const record = {
        transferUid: paquete.transferUid,
        direction: 'salida',
        status: 'pendiente_envio',
        originBranch: paquete.originBranch,
        destinationBranch: paquete.destinationBranch,
        createdAt: paquete.createdAt,
        syncedAt: null,
        lastError: null,
        payload: paquete,
    };

    const recordId = await db.branchTransfers.add(record);

    try {
        const { base, token } = await obtenerCredencialesNube();
        await fetchJsonNube(base, token, '/api/traslados/enviar', {
            method: 'POST',
            body: paquete,
        });
        const now = new Date().toISOString();
        await db.branchTransfers.update(recordId, {
            status: 'enviado_nube',
            syncedAt: now,
            lastError: null,
        });
        return {
            queued: true,
            sentToCloud: true,
            message: 'Enviado al buzón de la nube ✓',
            recordId,
        };
    } catch (err) {
        await db.branchTransfers.update(recordId, {
            lastError: err.message,
        });
        return {
            queued: true,
            sentToCloud: false,
            message: err.message,
            recordId,
        };
    }
}

/**
 * Reintenta subir todos los traslados salientes pendientes (`status === 'pendiente_envio'`).
 */
export async function sincronizarColaTrasladosSalientes() {
    if (!db.branchTransfers) {
        return { total: 0, enviados: 0, fallidos: 0, errores: [] };
    }

    const pendientes = await db.branchTransfers
        .where('status')
        .equals('pendiente_envio')
        .and((r) => r.direction === 'salida')
        .toArray();

    if (pendientes.length === 0) {
        return { total: 0, enviados: 0, fallidos: 0, errores: [] };
    }

    const { base, token } = await obtenerCredencialesNube();
    let enviados = 0;
    const errores = [];

    for (const item of pendientes) {
        try {
            await fetchJsonNube(base, token, '/api/traslados/enviar', {
                method: 'POST',
                body: item.payload,
            });
            await db.branchTransfers.update(item.id, {
                status: 'enviado_nube',
                syncedAt: new Date().toISOString(),
                lastError: null,
            });
            enviados++;
        } catch (err) {
            await db.branchTransfers.update(item.id, {
                lastError: err.message,
            });
            errores.push(`${item.transferUid}: ${err.message}`);
        }
    }

    return {
        total: pendientes.length,
        enviados,
        fallidos: pendientes.length - enviados,
        errores,
    };
}

/**
 * Consulta en la nube los envíos en tránsito dirigidos a esta tienda física.
 */
export async function consultarTrasladosEntrantesNube(destinoOpcional = null) {
    const localBranch = normalizarNombreSucursal(destinoOpcional) || (await obtenerSucursalLocal());
    const { base, token } = await obtenerCredencialesNube();

    const resp = await fetchJsonNube(base, token, '/api/traslados/pendientes', {
        method: 'GET',
        query: { destino: localBranch },
    });

    const listaNube = Array.isArray(resp?.traslados)
        ? resp.traslados
        : Array.isArray(resp)
            ? resp
            : [];

    const yaRecibidos = db.branchTransfers
        ? await db.branchTransfers
              .where('direction')
              .equals('entrada')
              .and((r) => r.status === 'recibido')
              .toArray()
        : [];
    const recibidosSet = new Set(yaRecibidos.map((r) => r.transferUid));

    return {
        localBranch,
        pendientes: filtrarBandejaEntrante(listaNube, localBranch, recibidosSet),
    };
}

/**
 * Confirma en la nube que el envío fue recibido físicamente en esta tienda.
 */
export async function confirmarRecepcionTrasladoNube(transferUid, user = null) {
    const { base, token } = await obtenerCredencialesNube();
    const localBranch = await obtenerSucursalLocal();
    return fetchJsonNube(base, token, '/api/traslados/confirmar', {
        method: 'POST',
        body: {
            transferUid,
            receivedBy: user?.name || user?.username || 'Sistema',
            receivedAt: new Date().toISOString(),
            receivedBranch: localBranch,
        },
    });
}

/**
 * Aplica contablemente en la BD local la recepción de un paquete de traslado
 * (proveniente de la nube o de un archivo `.traslado.json`).
 */
export async function aplicarRecepcionPaqueteLocal(
    rawPaquete,
    { user = null, overrideTargetProductId = null, overrideShortCode = null } = {}
) {
    const check = validarPaqueteTraslado(rawPaquete);
    if (!check.valido) {
        throw new Error(check.error);
    }
    const pkg = check.paquete;

    if (db.branchTransfers) {
        const yaExiste = await db.branchTransfers
            .where('transferUid')
            .equals(pkg.transferUid)
            .and((r) => r.direction === 'entrada' && r.status === 'recibido')
            .first();
        if (yaExiste) {
            throw new Error('Este paquete de traslado ya fue recibido anteriormente en esta tienda.');
        }
    }

    const [products, barcodes] = await Promise.all([
        db.products.toArray(),
        db.barcodes.toArray(),
    ]);

    const resultados = [];

    for (const item of pkg.items) {
        const evalCode = evaluarCodigoSucursal({
            rawCode: overrideShortCode || item.shortCode,
            products,
            barcodes,
            targetProductId: overrideTargetProductId || null,
        });

        let codigoFinal = evalCode.shortCode;
        if (!evalCode.valido && evalCode.status === 'colision') {
            if (evalCode.conflictProduct && !overrideTargetProductId) {
                codigoFinal = sugerirCodigoLibre(products, barcodes, []);
            } else {
                throw new Error(evalCode.mensaje);
            }
        }

        // 1) Si es retorno de unidad que salió antes, o se encontró producto compatible
        const productoCompatible =
            (overrideTargetProductId && products.find((p) => p.id === overrideTargetProductId)) ||
            (evalCode.status === 'retorno_mismo_producto' && evalCode.conflictProduct) ||
            buscarProductoCompatibleLocal(item, products);

        if (productoCompatible) {
            await registerBranchTransferInProduct({
                productId: productoCompatible.id,
                originBranch: pkg.originBranch,
                notes: pkg.notes || `RECEPCIÓN PAQUETE ${pkg.transferUid.slice(0, 8)}`,
                rawCodes: [codigoFinal],
                user,
            });
            resultados.push({
                action: 'updated_existing',
                productId: productoCompatible.id,
                name: productoCompatible.name,
                shortCode: codigoFinal,
            });
            continue;
        }

        // 2) Producto nuevo en esta tienda (conserva código corto de sucursal o sugerido libre)
        const nowLocal = getLocalISOString();
        const nowISO = new Date().toISOString();
        const eanProducto = await generateUniqueBarcode();
        const eanUnidad = await generateUniqueBarcode(new Set([eanProducto]));

        const tablas = [db.products, db.barcodes, db.kardex];
        if (db.branches) tablas.push(db.branches);

        const newProductId = await db.transaction('rw', tablas, async () => {
            await ensureBranchExists(pkg.originBranch);

            const prodId = await db.products.add({
                globalId: item.globalId || crypto.randomUUID(),
                name: item.name,
                category: item.category || 'Otros',
                brand: item.brand || '',
                size: item.size || '',
                color: item.color || '',
                cost: Number(item.cost) || 0,
                price: Number(item.price) || 0,
                stock: item.qty || 1,
                shortCode: codigoFinal,
                barcode: eanProducto,
                active: true,
                isBranchTransfer: true,
                originBranch: pkg.originBranch,
                createdAt: nowLocal,
                updatedAt: nowISO,
                hasEmbedding: 0,
            });

            await db.barcodes.add({
                productId: prodId,
                barcode: eanUnidad,
                shortCode: codigoFinal,
                used: false,
                isBranchTransfer: true,
                originBranch: pkg.originBranch,
                transferInDate: nowLocal,
                createdAt: nowLocal,
            });

            await db.kardex.add({
                productId: prodId,
                date: nowLocal,
                type: 'entrada',
                subType: 'traslado_entrada',
                originBranch: pkg.originBranch,
                qty: item.qty || 1,
                notes: (
                    `INGRESO DESDE ${pkg.originBranch} (${pkg.sentBy})` +
                    (pkg.notes ? ` — ${pkg.notes}` : '')
                ).toUpperCase(),
                balanceAfter: item.qty || 1,
                unitCodes: [{ shortCode: codigoFinal, barcode: eanUnidad }],
                userId: user?.id ?? null,
                registeredBy: user?.name || user?.username || 'Sistema',
            });

            return prodId;
        });

        resultados.push({
            action: 'created_new',
            productId: newProductId,
            name: item.name,
            shortCode: codigoFinal,
        });
    }

    if (db.branchTransfers) {
        await db.branchTransfers.add({
            transferUid: pkg.transferUid,
            direction: 'entrada',
            status: 'recibido',
            originBranch: pkg.originBranch,
            destinationBranch: pkg.destinationBranch,
            createdAt: pkg.createdAt,
            syncedAt: new Date().toISOString(),
            payload: pkg,
        });
    }

    let cloudConfirmed = false;
    try {
        await confirmarRecepcionTrasladoNube(pkg.transferUid, user);
        cloudConfirmed = true;
    } catch {
        // Si se recibió desde archivo offline o sin internet, queda recibido localmente igual
    }

    return {
        transferUid: pkg.transferUid,
        originBranch: pkg.originBranch,
        items: resultados,
        cloudConfirmed,
    };
}

/**
 * Descarga un archivo `.traslado.json` como respaldo manual (ej. para enviar por WhatsApp).
 */
export function descargarArchivoTraslado(paquete) {
    const json = JSON.stringify(paquete, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const fecha = String(paquete?.createdAt || new Date().toISOString()).slice(0, 10);
    const origen = String(paquete?.originBranch || 'SUC').replace(/[^A-Z0-9_-]/gi, '_');
    const destino = String(paquete?.destinationBranch || 'DEST').replace(/[^A-Z0-9_-]/gi, '_');
    anchor.href = url;
    anchor.download = `traslado_${origen}_a_${destino}_${fecha}.traslado.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}
