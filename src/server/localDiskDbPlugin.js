import fs from 'node:fs';
import path from 'node:path';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import {

    POS_DB_TABLES,
    calcularEstadisticasTablas,
    aplicarCambioEstadoDisco,
} from '../utils/localDiskDbEngine.js';

const MAX_AUTO_BACKUPS = 15;

/**
 * Crea el estado vacío inicial cuando aún no existe archivo en disco.
 */
function crearEstadoVacio() {
    const tables = {};
    for (const t of POS_DB_TABLES) {
        tables[t] = [];
    }
    return {
        version: 1,
        initialized: false,
        revision: 0,
        updatedAt: null,
        lastClientId: null,
        tables,
    };
}

/**
 * Lee el archivo JSON de disco o devuelve un estado vacío seguro.
 */
function cargarEstadoDesdeDisco(dbFilePath) {
    try {
        if (!fs.existsSync(dbFilePath)) {
            return crearEstadoVacio();
        }
        const raw = fs.readFileSync(dbFilePath, 'utf-8');
        if (!raw.trim()) return crearEstadoVacio();
        const parsed = JSON.parse(raw);
        const tables = {};
        for (const t of POS_DB_TABLES) {
            tables[t] = Array.isArray(parsed?.tables?.[t]) ? parsed.tables[t] : [];
        }
        return {
            version: 1,
            initialized: Boolean(parsed.initialized),
            revision: Number(parsed.revision) || 0,
            updatedAt: parsed.updatedAt || null,
            lastClientId: parsed.lastClientId || null,
            tables,
        };
    } catch (err) {
        console.error('[LocalDiskDB] Error leyendo pos-db.json, iniciando vacío:', err.message);
        return crearEstadoVacio();
    }
}

/**
 * Guarda atómicamente el estado en disco usando archivo temporal + rename.
 */
function guardarEstadoEnDisco(dbFilePath, backupsDir, estado) {
    const dir = path.dirname(dbFilePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }

    const payload = JSON.stringify(
        {
            version: estado.version || 1,
            initialized: estado.initialized,
            revision: estado.revision,
            updatedAt: estado.updatedAt,
            lastClientId: estado.lastClientId,
            tables: estado.tables,
        },
        null,
        2
    );

    const tmpPath = `${dbFilePath}.tmp`;
    fs.writeFileSync(tmpPath, payload, 'utf-8');
    fs.renameSync(tmpPath, dbFilePath);

    // Respaldo diario automático (1 por día) si tiene datos inicializados
    if (estado.initialized) {
        const hoy = new Date().toISOString().slice(0, 10);
        const dailyBackupPath = path.join(backupsDir, `backup-auto-${hoy}.json`);
        if (!fs.existsSync(dailyBackupPath)) {
            try {
                fs.copyFileSync(dbFilePath, dailyBackupPath);
                rotarBackupsAutomaticos(backupsDir);
            } catch (err) {
                console.warn('[LocalDiskDB] No se pudo crear backup diario:', err.message);
            }
        }
    }
}

/**
 * Conserva únicamente los últimos MAX_AUTO_BACKUPS respaldos automáticos diarios.
 */
function rotarBackupsAutomaticos(backupsDir) {
    try {
        const files = fs
            .readdirSync(backupsDir)
            .filter(f => f.startsWith('backup-auto-') && f.endsWith('.json'))
            .sort();
        while (files.length > MAX_AUTO_BACKUPS) {
            const oldest = files.shift();
            if (oldest) {
                fs.unlinkSync(path.join(backupsDir, oldest));
            }
        }
    } catch {
        // Ignorar errores de rotación
    }
}

/**
 * Crea un backup instantáneo en la carpeta de backups del disco.
 */
function crearBackupEnDisco(backupsDir, estado, prefijo = 'backup-manual') {
    if (!fs.existsSync(backupsDir)) {
        fs.mkdirSync(backupsDir, { recursive: true });
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `${prefijo}-${stamp}.json`;
    const fullPath = path.join(backupsDir, fileName);
    const exportFormat = {
        version: 26,
        exportedAt: new Date().toISOString(),
        revision: estado.revision,
        data: estado.tables,
    };
    fs.writeFileSync(fullPath, JSON.stringify(exportFormat, null, 2), 'utf-8');
    return { fileName, fullPath };
}

/**
 * Lee el cuerpo JSON de una petición HTTP entrante (soporta catálogos grandes).
 */
function leerJsonBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', chunk => chunks.push(chunk));
        req.on('end', () => {
            try {
                const raw = Buffer.concat(chunks).toString('utf-8');
                resolve(raw ? JSON.parse(raw) : {});
            } catch (err) {
                reject(err);
            }
        });
        req.on('error', reject);
    });
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
 */
export function crearMiddlewareLocalDiskDb(options = {}) {
    const rootDir = options.rootDir || process.cwd();
    const dataDir = options.dataDir || path.join(rootDir, 'datos-pos');
    const dbFilePath = path.join(dataDir, 'pos-db.json');
    const backupsDir = path.join(dataDir, 'backups');

    let estado = cargarEstadoDesdeDisco(dbFilePath);
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

    function contarBackups() {
        try {
            if (!fs.existsSync(backupsDir)) return 0;
            return fs.readdirSync(backupsDir).filter(f => f.endsWith('.json')).length;
        } catch {
            return 0;
        }
    }

    return async function localDiskDbMiddleware(req, res, next) {
        if (!req.url || !req.url.startsWith('/__local_db')) {
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
                    initialized: estado.initialized,
                    revision: estado.revision,
                    updatedAt: estado.updatedAt,
                })}\n\n`
            );

            sseClients.add(res);
            req.on('close', () => {
                sseClients.delete(res);
            });
            return;
        }

        // 2. Estado resumido de la base de datos en disco
        if (req.method === 'GET' && pathname === '/__local_db/status') {
            return enviarJson(res, 200, {
                ok: true,
                initialized: estado.initialized,
                revision: estado.revision,
                updatedAt: estado.updatedAt,
                dbPath: dbFilePath,
                backupsDir,
                backupsCount: contarBackups(),
                connectedClients: sseClients.size,
                stats: calcularEstadisticasTablas(estado.tables),
            });
        }

        // 3. Obtener snapshot completo o de tablas específicas
        if (req.method === 'GET' && pathname === '/__local_db/snapshot') {
            const requestedTablesParam = parsedUrl.searchParams.get('tables');
            let tablesToReturn = estado.tables;
            if (requestedTablesParam) {
                const requested = requestedTablesParam
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean);
                tablesToReturn = {};
                for (const t of requested) {
                    if (POS_DB_TABLES.includes(t)) {
                        tablesToReturn[t] = estado.tables[t] || [];
                    }
                }
            }
            return enviarJson(res, 200, {
                ok: true,
                initialized: estado.initialized,
                revision: estado.revision,
                updatedAt: estado.updatedAt,
                lastClientId: estado.lastClientId,
                tables: tablesToReturn,
            });
        }

        // 4. Sincronizar cambios (patch, full o wipe) hacia el disco
        if (req.method === 'POST' && pathname === '/__local_db/sync') {
            try {
                const body = await leerJsonBody(req);
                if (body.mode === 'wipe' && estado.initialized) {
                    try {
                        crearBackupEnDisco(backupsDir, estado, 'backup-antes-de-borrar');
                    } catch {
                        // Continuar si falla backup previo
                    }
                }

                const resultado = aplicarCambioEstadoDisco(estado, body);
                estado = {
                    version: resultado.version,
                    initialized: resultado.initialized,
                    revision: resultado.revision,
                    updatedAt: resultado.updatedAt,
                    lastClientId: resultado.lastClientId,
                    tables: resultado.tables,
                };

                guardarEstadoEnDisco(dbFilePath, backupsDir, estado);

                emitirEventoSse({
                    type: body.mode === 'wipe' ? 'wipe' : body.mode === 'full' ? 'full' : 'patch',
                    initialized: estado.initialized,
                    revision: estado.revision,
                    updatedAt: estado.updatedAt,
                    clientId: estado.lastClientId,
                    updatedTables: resultado.updatedTables,
                });

                return enviarJson(res, 200, {
                    ok: true,
                    initialized: estado.initialized,
                    revision: estado.revision,
                    updatedAt: estado.updatedAt,
                    updatedTables: resultado.updatedTables,
                    stats: calcularEstadisticasTablas(estado.tables),
                });
            } catch (err) {
                console.error('[LocalDiskDB] Error guardando sync en disco:', err);
                return enviarJson(res, 500, {
                    ok: false,
                    error: err.message || 'Error guardando en disco',
                });
            }
        }

        // 5. Crear respaldo instantáneo en disco bajo demanda
        if (req.method === 'POST' && pathname === '/__local_db/backup-now') {
            try {
                const info = crearBackupEnDisco(backupsDir, estado, 'backup-manual');
                return enviarJson(res, 200, {
                    ok: true,
                    fileName: info.fileName,
                    fullPath: info.fullPath,
                    backupsCount: contarBackups(),
                });
            } catch (err) {
                return enviarJson(res, 500, {
                    ok: false,
                    error: err.message || 'No se pudo escribir el backup en disco',
                });
            }
        }

        return enviarJson(res, 404, { ok: false, error: 'Ruta de BD local no encontrada' });
    };
}

/**
 * Plugin de Vite que activa la Base de Datos en Disco Local tanto en dev como en preview.
 */
export function localDiskDbPlugin(options = {}) {
    const middleware = crearMiddlewareLocalDiskDb(options);
    return {
        name: 'ropa-cbba-local-disk-db',
        configureServer(server) {
            server.middlewares.use(middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use(middleware);
        },
    };
}
