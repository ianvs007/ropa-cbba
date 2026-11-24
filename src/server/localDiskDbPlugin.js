import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import { POS_DB_TABLES } from '../utils/localDiskDbEngine.js';
import { SqlitePosStore } from './sqliteStore.js';

/**
 * Lee el cuerpo crudo en UTF-8 de una petición HTTP entrante (soporta backups de 300+ MB).
 */
function leerTextoBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        req.on('end', () => {
            try {
                resolve(Buffer.concat(chunks).toString('utf-8'));
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
}

async function leerJsonBody(req) {
    const raw = await leerTextoBody(req);
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
 * Middleware compartido para Vite dev server y Vite preview server.
 * Provee:
 *  - `/__local_db/*`    → Motor SQLite en disco (`datos-pos/pos.sqlite`) + SSE tiempo real
 *  - `/__local_media/*` → Servidor y subida de imágenes físicas (`datos-pos/imagenes/`)
 */
export function crearMiddlewareLocalDiskDb(options = {}) {
    const rootDir = options.rootDir || process.cwd();
    const dataDir = options.dataDir || path.join(rootDir, 'datos-pos');

    const store = new SqlitePosStore({ dataDir });
    const sseClients = new Set();

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

    const middleware = async function localDiskDbMiddleware(req, res, next) {
        if (!req.url) return next();

        // ── A. SERVIDOR Y SUBIDA DE IMÁGENES EN DISCO (`/__local_media/*`) ──
        if (req.url.startsWith('/__local_media')) {
            const parsedMediaUrl = new URL(req.url, 'http://localhost');
            const mediaPath = parsedMediaUrl.pathname;

            if (req.method === 'POST' && mediaPath === '/__local_media/upload') {
                try {
                    const body = await leerJsonBody(req);
                    if (!body?.dataUrl || typeof body.dataUrl !== 'string') {
                        return enviarJson(res, 400, { ok: false, error: 'dataUrl requerido' });
                    }
                    const url = store.externalizeDataUrl(body.dataUrl, body.prefixHint || 'prenda');
                    return enviarJson(res, 200, { ok: true, url });
                } catch (err) {
                    return enviarJson(res, 500, {
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
            return enviarJson(res, 200, {
                ok: true,
                ...store.getStatus(),
                connectedClients: sseClients.size,
            });
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
                const body = await leerJsonBody(req);
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
                return enviarJson(res, 500, {
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
                const rawText = await leerTextoBody(req);
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
                return enviarJson(res, 500, {
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
                    fullPath: info.fullPath,
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
