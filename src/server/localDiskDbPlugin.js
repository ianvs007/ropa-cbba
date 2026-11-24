import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { randomBytes } from 'node:crypto';
import { POS_DB_TABLES } from '../utils/localDiskDbEngine.js';
import { evaluarAccesoLocalDb, TOKEN_MIN_LENGTH } from '../utils/localDiskDbAuth.js';
import { SqlitePosStore } from './sqliteStore.js';

/** Sync incremental: el catálogo sin fotos Base64 cabe holgado. */
const MAX_SYNC_BODY_BYTES = 256 * 1024 * 1024;
/**
 * Importación de un backup JSON histórico (el de ~300 MB, con fotos todavía en Base64).
 * El tope del sync no aplica aquí: ese archivo es más grande a propósito.
 */
const MAX_IMPORT_BODY_BYTES = 1024 * 1024 * 1024;
const TOKEN_FILE_NAME = '.local-db-token';

/**
 * Resuelve el token de acceso de la BD central: variable `POS_LOCAL_DB_TOKEN` si existe
 * (mín. 16 caracteres), si no el archivo `datos-pos/.local-db-token` (se crea con un valor
 * aleatorio la primera vez; `datos-pos/` está en .gitignore).
 */
export function obtenerOCrearTokenLocalDb(dataDir, env = process.env) {
    const deEntorno = (env.POS_LOCAL_DB_TOKEN || '').trim();
    if (deEntorno) {
        if (deEntorno.length < TOKEN_MIN_LENGTH) {
            throw new Error(
                `POS_LOCAL_DB_TOKEN debe tener al menos ${TOKEN_MIN_LENGTH} caracteres.`
            );
        }
        return deEntorno;
    }

    const tokenPath = path.join(dataDir, TOKEN_FILE_NAME);
    try {
        const guardado = fs.readFileSync(tokenPath, 'utf-8').trim();
        if (guardado.length >= TOKEN_MIN_LENGTH) return guardado;
    } catch {
        // No existe todavía: se genera abajo
    }

    const nuevo = randomBytes(24).toString('hex');
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(tokenPath, `${nuevo}\n`, { encoding: 'utf-8', mode: 0o600 });
    return nuevo;
}

/**
 * Lee el cuerpo crudo en UTF-8. `maxBytes` corta peticiones enormes (413) antes de parsearlas.
 */
function leerTextoBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let recibidos = 0;
        let rechazado = false;
        req.on('data', chunk => {
            if (rechazado) return;
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            recibidos += buf.length;
            if (maxBytes && recibidos > maxBytes) {
                rechazado = true;
                const err = new Error('El cuerpo de la petición supera el tamaño máximo permitido');
                err.statusCode = 413;
                reject(err);
                return;
            }
            chunks.push(buf);
        });
        req.on('end', () => {
            if (rechazado) return;
            try {
                resolve(Buffer.concat(chunks).toString('utf-8'));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', err => {
            if (!rechazado) reject(err);
        });
    });
}

async function leerJsonBody(req, maxBytes) {
    const raw = await leerTextoBody(req, maxBytes);
    return raw ? JSON.parse(raw) : {};
}

function enviarJson(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(body);
}

/**
 * Estado de SQLite para el cliente. Las rutas del disco (`dbPath`, `imagesDir`,
 * `backupsDir`, `fullPath` de un backup) solo se entregan a la propia máquina.
 */
function estadoParaCliente(store, { esLocal, connectedClients }) {
    const full = store.getStatus();
    const publico = {
        ok: true,
        engine: full.engine,
        initialized: full.initialized,
        revision: full.revision,
        updatedAt: full.updatedAt,
        imagesCount: full.imagesCount,
        backupsCount: full.backupsCount,
        stats: full.stats,
        connectedClients,
    };
    if (!esLocal) return publico;
    return {
        ...publico,
        dbPath: full.dbPath,
        imagesDir: full.imagesDir,
        backupsDir: full.backupsDir,
        lastClientId: full.lastClientId,
    };
}

/**
 * Middleware compartido para Vite dev server y Vite preview server.
 * Provee:
 *  - `/__local_db/*`    → Motor SQLite en disco (`datos-pos/pos.sqlite`) + SSE tiempo real
 *  - `/__local_media/*` → Servidor y subida de imágenes físicas (`datos-pos/imagenes/`)
 *
 * `/__local_db/*` y la subida de fotos exigen token a cualquier PC que no sea la central
 * (loopback + Host local). Las fotos ya guardadas se sirven en GET sin token: el `<img>`
 * del POS no puede mandar cabeceras y el nombre del archivo es un hash, no una ruta del disco.
 */
export function crearMiddlewareLocalDiskDb(options = {}) {
    const rootDir = options.rootDir || process.cwd();
    const dataDir = options.dataDir || path.join(rootDir, 'datos-pos');
    const maxSyncBodyBytes = options.maxSyncBodyBytes ?? MAX_SYNC_BODY_BYTES;
    const maxImportBodyBytes = options.maxImportBodyBytes ?? MAX_IMPORT_BODY_BYTES;

    const store = new SqlitePosStore({ dataDir });
    const sseClients = new Set();

    let token = options.token;
    const resolverToken = () => {
        if (token) return token;
        token = obtenerOCrearTokenLocalDb(dataDir);
        return token;
    };
    const confiarLoopback =
        options.confiarLoopback ?? process.env.POS_LOCAL_DB_TRUST_LOOPBACK !== '0';

    function emitirEventoSse(eventObj) {
        const msg = `data: ${JSON.stringify(eventObj)}\n\n`;
        for (const clientRes of sseClients) {
            try {
                clientRes.write(msg);
            } catch {
                sseClients.delete(clientRes);
            }
        }
    }

    function decidirAcceso(req, parsedUrl) {
        let tokenActual;
        try {
            tokenActual = resolverToken();
        } catch (err) {
            return {
                permitido: false,
                status: 503,
                codigo: 'token_no_configurado',
                mensaje: err.message || 'Token de acceso no configurado.',
            };
        }
        return evaluarAccesoLocalDb({
            headers: req.headers,
            searchParams: parsedUrl.searchParams,
            remoteAddress: req.socket?.remoteAddress,
            token: tokenActual,
            confiarLoopback,
        });
    }

    function rechazar(res, acceso) {
        return enviarJson(res, acceso.status, {
            ok: false,
            codigo: acceso.codigo,
            error: acceso.mensaje,
        });
    }

    const middleware = async function localDiskDbMiddleware(req, res, next) {
        if (!req.url) return next();

        // ── A. SERVIDOR Y SUBIDA DE IMÁGENES EN DISCO (`/__local_media/*`) ──
        if (req.url.startsWith('/__local_media')) {
            const parsedMediaUrl = new URL(req.url, 'http://localhost');
            const mediaPath = parsedMediaUrl.pathname;

            if (req.method === 'POST' && mediaPath === '/__local_media/upload') {
                const acceso = decidirAcceso(req, parsedMediaUrl);
                if (!acceso.permitido) return rechazar(res, acceso);
                try {
                    const body = await leerJsonBody(req, maxSyncBodyBytes);
                    if (!body?.dataUrl || typeof body.dataUrl !== 'string') {
                        return enviarJson(res, 400, { ok: false, error: 'dataUrl requerido' });
                    }
                    const url = store.externalizeDataUrl(body.dataUrl, body.prefixHint || 'prenda');
                    return enviarJson(res, 200, { ok: true, url });
                } catch (err) {
                    return enviarJson(res, err.statusCode || 500, {
                        ok: false,
                        error: err.message || 'Error guardando imagen en disco',
                    });
                }
            }

            if (req.method === 'GET' && mediaPath.startsWith('/__local_media/')) {
                const rawName = decodeURIComponent(mediaPath.slice('/__local_media/'.length));
                const resolved = store.resolveImageFile(rawName);
                if (!resolved) {
                    res.statusCode = 404;
                    res.end('Imagen no encontrada');
                    return;
                }
                const bytes = fs.readFileSync(resolved.fullPath);
                res.statusCode = 200;
                res.setHeader('Content-Type', resolved.contentType);
                res.setHeader('Content-Length', String(bytes.length));
                res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                res.end(bytes);
                return;
            }

            return enviarJson(res, 404, { ok: false, error: 'Ruta de imagen no encontrada' });
        }

        // ── B. ENDPOINTS DE BASE DE DATOS SQLITE (`/__local_db/*`) ──
        if (!req.url.startsWith('/__local_db')) {
            return next();
        }

        const parsedUrl = new URL(req.url, 'http://localhost');
        const pathname = parsedUrl.pathname;

        const acceso = decidirAcceso(req, parsedUrl);
        if (!acceso.permitido) return rechazar(res, acceso);
        const esLocal = acceso.via === 'loopback';

        // 0. Token de acceso: solo se entrega a la propia máquina (para configurar otras PCs)
        if (req.method === 'GET' && pathname === '/__local_db/token') {
            if (!esLocal) {
                return enviarJson(res, 403, {
                    ok: false,
                    codigo: 'solo_local',
                    error: 'El token solo puede consultarse desde la máquina central.',
                });
            }
            return enviarJson(res, 200, { ok: true, token: resolverToken() });
        }

        // 1. SSE Stream para sincronización en tiempo real entre navegadores y PCs en red
        if (req.method === 'GET' && pathname === '/__local_db/stream') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders?.();

            res.write(
                `data: ${JSON.stringify({
                    type: 'connected',
                    engine: 'sqlite',
                    initialized: store.isInitialized(),
                    revision: store.getRevision(),
                    updatedAt: store.getUpdatedAt(),
                })}\n\n`
            );

            sseClients.add(res);
            req.on('close', () => {
                sseClients.delete(res);
            });
            return;
        }

        // 2. Estado resumido de la base de datos SQLite en disco (< 1 ms)
        if (req.method === 'GET' && pathname === '/__local_db/status') {
            return enviarJson(
                res,
                200,
                estadoParaCliente(store, { esLocal, connectedClients: sseClients.size })
            );
        }

        // 3. Obtener snapshot completo o de tablas específicas
        if (req.method === 'GET' && pathname === '/__local_db/snapshot') {
            const requestedTablesParam = parsedUrl.searchParams.get('tables');
            const excludeParam = parsedUrl.searchParams.get('exclude');
            const excluded = new Set(
                excludeParam
                    ? excludeParam.split(',').map(s => s.trim()).filter(Boolean)
                    : []
            );

            let tableNames = POS_DB_TABLES;
            if (requestedTablesParam) {
                tableNames = requestedTablesParam
                    .split(',')
                    .map(s => s.trim())
                    .filter(t => Boolean(t) && POS_DB_TABLES.includes(t));
            }
            if (excluded.size > 0) {
                tableNames = tableNames.filter(t => !excluded.has(t));
            }

            const tablesToReturn = store.getTables(tableNames);
            return enviarJson(res, 200, {
                ok: true,
                engine: 'sqlite',
                initialized: store.isInitialized(),
                revision: store.getRevision(),
                updatedAt: store.getUpdatedAt(),
                lastClientId: store.getLastClientId(),
                tables: tablesToReturn,
            });
        }

        // 4. Sincronizar cambios incrementales (`ops`), por tabla (`patch`), completos (`full`) o borrado (`wipe`)
        if (req.method === 'POST' && pathname === '/__local_db/sync') {
            try {
                const body = await leerJsonBody(req, maxSyncBodyBytes);
                if (body.mode === 'wipe' && store.isInitialized()) {
                    try {
                        store.createBackup('backup-antes-de-borrar');
                    } catch {
                        // Continuar si falla backup previo
                    }
                }

                const resultado = store.applySync(body);

                const ssePayload = {
                    type:
                        body.mode === 'wipe'
                            ? 'wipe'
                            : body.mode === 'full'
                            ? 'full'
                            : body.mode === 'ops'
                            ? 'ops'
                            : 'patch',
                    initialized: resultado.initialized,
                    revision: resultado.revision,
                    updatedAt: resultado.updatedAt,
                    clientId: resultado.lastClientId,
                    updatedTables: resultado.updatedTables,
                };

                // Si es una operación incremental pequeña, enviar las filas directas por SSE
                // para que otras pestañas/cajas actualicen en <1 ms sin pedir snapshot de tabla
                if (body.mode === 'ops') {
                    const mergedUpserts = { ...(body.upserts || {}) };
                    if (resultado.sanitizedUpserts?.products) {
                        mergedUpserts.products = resultado.sanitizedUpserts.products;
                    }
                    if (resultado.sanitizedUpserts?.sales) {
                        mergedUpserts.sales = resultado.sanitizedUpserts.sales;
                    }
                    const serializedOps = JSON.stringify({
                        upserts: mergedUpserts,
                        deletes: body.deletes || {},
                    });
                    if (serializedOps.length <= 65536) {
                        ssePayload.upserts = mergedUpserts;
                        ssePayload.deletes = body.deletes || {};
                    }
                }

                emitirEventoSse(ssePayload);

                return enviarJson(res, 200, {
                    ok: true,
                    initialized: resultado.initialized,
                    revision: resultado.revision,
                    updatedAt: resultado.updatedAt,
                    updatedTables: resultado.updatedTables,
                    sanitizedUpserts: resultado.sanitizedUpserts,
                    stats: store.getStats(),
                    imagesCount: store.countImages(),
                });
            } catch (err) {
                console.error('[SQLite] Error guardando sync en disco:', err);
                return enviarJson(res, err.statusCode || 500, {
                    ok: false,
                    error: err.message || 'Error guardando en SQLite',
                });
            }
        }

        // 5. Importar un archivo `.json` pesado (ej. 300+ MB) directo en servidor Node + SQLite
        if (req.method === 'POST' && pathname === '/__local_db/import-backup') {
            try {
                if (store.isInitialized()) {
                    try {
                        store.createBackup('backup-previo-importacion');
                    } catch {
                        // Ignorar si falla backup previo
                    }
                }
                const rawText = await leerTextoBody(req, maxImportBodyBytes);
                const resultado = store.importBackupJsonString(rawText);

                emitirEventoSse({
                    type: 'full',
                    initialized: resultado.initialized,
                    revision: resultado.revision,
                    updatedAt: resultado.updatedAt,
                    clientId: 'server-backup-import',
                    updatedTables: resultado.updatedTables,
                });

                return enviarJson(res, 200, {
                    ok: true,
                    initialized: resultado.initialized,
                    revision: resultado.revision,
                    updatedAt: resultado.updatedAt,
                    stats: store.getStats(),
                    imagesCount: store.countImages(),
                });
            } catch (err) {
                console.error('[SQLite] Error importando backup en disco:', err);
                return enviarJson(res, err.statusCode || 500, {
                    ok: false,
                    error: err.message || 'No se pudo importar el backup en SQLite',
                });
            }
        }

        // 6. Crear respaldo instantáneo `.sqlite` en disco bajo demanda (`VACUUM INTO`)
        if (req.method === 'POST' && pathname === '/__local_db/backup-now') {
            try {
                const info = store.createBackup('backup-manual');
                return enviarJson(res, 200, {
                    ok: true,
                    fileName: info.fileName,
                    ...(esLocal ? { fullPath: info.fullPath } : {}),
                    backupsCount: store.countBackups(),
                });
            } catch (err) {
                return enviarJson(res, 500, {
                    ok: false,
                    error: err.message || 'No se pudo crear el respaldo SQLite en disco',
                });
            }
        }

        return enviarJson(res, 404, { ok: false, error: 'Ruta de BD local no encontrada' });
    };

    middleware.close = () => store.close();
    middleware.store = store;
    return middleware;
}

/**
 * Plugin de Vite que activa la Base de Datos SQLite + Imágenes en Disco tanto en dev como en preview.
 */
export function localDiskDbPlugin(options = {}) {
    let middleware = null;
    const ensureMiddleware = () => {
        if (!middleware) {
            middleware = crearMiddlewareLocalDiskDb(options);
        }
        return middleware;
    };

    return {
        name: 'ropa-cbba-local-disk-db',
        configureServer(server) {
            const mw = ensureMiddleware();
            server.middlewares.use(mw);
            server.httpServer?.once('close', () => mw.close?.());
        },
        configurePreviewServer(server) {
            const mw = ensureMiddleware();
            server.middlewares.use(mw);
            server.httpServer?.once('close', () => mw.close?.());
        },
    };
}
