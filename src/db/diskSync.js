import {
    POS_DB_TABLES,
    decidirSincronizacionInicial,
} from '../utils/localDiskDbEngine';

const LAST_REV_STORAGE_KEY = 'pos_local_disk_last_rev';
const DEXIE_BATCH_SIZE = 300;

const CLIENT_ID =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let syncInitialized = false;
let isApplyingRemote = false;
let isBootstrapping = true;
let currentRevision = 0;
let flushTimer = null;

/** @type {Map<string, Set<any>>} */
const dirtyUpsertKeys = new Map();
/** @type {Map<string, Set<any>>} */
const dirtyDeleteKeys = new Map();

const statusListeners = new Set();

let lastKnownStatus = {
    connected: false,
    engine: 'sqlite',
    initialized: false,
    revision: 0,
    updatedAt: null,
    dbPath: '',
    imagesDir: '',
    imagesCount: 0,
    backupsDir: '',
    backupsCount: 0,
    stats: null,
};

function notifyStatusListeners(patch = {}) {
    lastKnownStatus = { ...lastKnownStatus, ...patch };
    for (const listener of statusListeners) {
        try {
            listener(lastKnownStatus);
        } catch {
            // Ignorar errores en listeners de UI
        }
    }
}

export function subscribeDiskSyncStatus(listener) {
    statusListeners.add(listener);
    listener(lastKnownStatus);
    return () => statusListeners.delete(listener);
}

function getStoredLastRev() {
    try {
        return Number(localStorage.getItem(LAST_REV_STORAGE_KEY)) || 0;
    } catch {
        return 0;
    }
}

function setStoredLastRev(rev) {
    currentRevision = Number(rev) || 0;
    try {
        localStorage.setItem(LAST_REV_STORAGE_KEY, String(currentRevision));
    } catch {
        // Ignorar si localStorage no está disponible
    }
}

/**
 * Ejecuta una operación masiva local en Dexie pausando temporalmente los hooks fila-por-fila.
 */
export async function runWithDiskSyncPaused(fn) {
    const prev = isApplyingRemote;
    isApplyingRemote = true;
    try {
        return await fn();
    } finally {
        isApplyingRemote = prev;
    }
}

/**
 * Sube una imagen `data:image/...` a `datos-pos/imagenes/` y devuelve su ruta `/__local_media/...`.
 * Si el servidor local no está disponible (ej. tests en memoria), devuelve el `dataUrl` original.
 */
export async function uploadProductImageToDisk(dataUrl, prefixHint = 'prenda') {
    if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        return dataUrl || '';
    }
    if (typeof fetch !== 'function') return dataUrl;
    try {
        const res = await fetch('/__local_media/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dataUrl, prefixHint }),
        });
        if (!res.ok) return dataUrl;
        const data = await res.json();
        return data?.ok && data.url ? data.url : dataUrl;
    } catch {
        return dataUrl;
    }
}

/**
 * Lee un subconjunto de tablas desde Dexie.
 */
async function readTablesFromDexie(db, tableNames = POS_DB_TABLES) {
    const result = {};
    for (const name of tableNames) {
        if (db[name]) {
            result[name] = await db[name].toArray();
        }
    }
    return result;
}

/**
 * Escribe un conjunto de tablas dentro de Dexie por lotes ligeros sin disparar eco al servidor.
 */
async function applyTablesToDexie(db, tablesMap = {}) {
    const validTableNames = Object.keys(tablesMap).filter(
        name => POS_DB_TABLES.includes(name) && db[name] && Array.isArray(tablesMap[name])
    );
    if (validTableNames.length === 0) return;

    await runWithDiskSyncPaused(async () => {
        for (const name of validTableNames) {
            const rows = tablesMap[name];
            await db[name].clear();
            for (let i = 0; i < rows.length; i += DEXIE_BATCH_SIZE) {
                const slice = rows.slice(i, i + DEXIE_BATCH_SIZE);
                if (slice.length > 0) {
                    await db[name].bulkPut(slice);
                }
            }
        }
    });
}

/**
 * Aplica operaciones incrementales por fila recibidas desde otra pestaña/caja o saneadas por SQLite.
 */
async function applyIncrementalOpsToDexie(db, { upserts = {}, deletes = {} } = {}) {
    await runWithDiskSyncPaused(async () => {
        for (const table of POS_DB_TABLES) {
            if (!db[table]) continue;
            const dels = Array.isArray(deletes[table]) ? deletes[table] : [];
            if (dels.length > 0) {
                await db[table].bulkDelete(dels);
            }
            const ups = Array.isArray(upserts[table]) ? upserts[table] : [];
            if (ups.length > 0) {
                await db[table].bulkPut(ups);
            }
        }
    });
}

function hasPendingOps() {
    for (const s of dirtyUpsertKeys.values()) {
        if (s.size > 0) return true;
    }
    for (const s of dirtyDeleteKeys.values()) {
        if (s.size > 0) return true;
    }
    return false;
}

function markUpsertKey(tableName, key, db) {
    if (key === undefined || key === null) return;
    let upSet = dirtyUpsertKeys.get(tableName);
    if (!upSet) {
        upSet = new Set();
        dirtyUpsertKeys.set(tableName, upSet);
    }
    upSet.add(key);

    const delSet = dirtyDeleteKeys.get(tableName);
    if (delSet) delSet.delete(key);

    scheduleFlush(db);
}

function markDeleteKey(tableName, key, db) {
    if (key === undefined || key === null) return;
    let delSet = dirtyDeleteKeys.get(tableName);
    if (!delSet) {
        delSet = new Set();
        dirtyDeleteKeys.set(tableName, delSet);
    }
    delSet.add(key);

    const upSet = dirtyUpsertKeys.get(tableName);
    if (upSet) upSet.delete(key);

    scheduleFlush(db);
}

/**
 * Envía inmediatamente a SQLite ÚNICAMENTE las filas modificadas/eliminadas (`mode: 'ops'`).
 */
export async function flushDiskSyncNow(db) {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (isApplyingRemote || isBootstrapping || !hasPendingOps()) return;

    const snapshotUpserts = new Map();
    const snapshotDeletes = new Map();

    for (const [t, set] of dirtyUpsertKeys.entries()) {
        if (set.size > 0) snapshotUpserts.set(t, Array.from(set));
    }
    for (const [t, set] of dirtyDeleteKeys.entries()) {
        if (set.size > 0) snapshotDeletes.set(t, Array.from(set));
    }
    dirtyUpsertKeys.clear();
    dirtyDeleteKeys.clear();

    try {
        const upsertsPayload = {};
        const deletesPayload = {};

        for (const [t, keys] of snapshotUpserts.entries()) {
            if (!db[t]) continue;
            const rows = await db[t].bulkGet(keys);
            const validRows = rows.filter(Boolean);
            if (validRows.length > 0) {
                upsertsPayload[t] = validRows;
            }
        }
        for (const [t, keys] of snapshotDeletes.entries()) {
            if (keys.length > 0) {
                deletesPayload[t] = keys;
            }
        }

        if (
            Object.keys(upsertsPayload).length === 0 &&
            Object.keys(deletesPayload).length === 0
        ) {
            return;
        }

        const res = await fetch('/__local_db/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: CLIENT_ID,
                mode: 'ops',
                upserts: upsertsPayload,
                deletes: deletesPayload,
            }),
        });

        if (!res.ok) throw new Error('Sync incremental falló');

        const data = await res.json();
        if (data.revision) {
            setStoredLastRev(data.revision);
        }

        // Si SQLite externalizó alguna foto Base64 heredada a `/__local_media/...`,
        // actualizar esa fila localmente en Dexie para liberar memoria del navegador.
        if (
            data.sanitizedUpserts &&
            (data.sanitizedUpserts.products || data.sanitizedUpserts.sales)
        ) {
            await applyIncrementalOpsToDexie(db, {
                upserts: data.sanitizedUpserts,
            });
        }

        notifyStatusListeners({
            connected: true,
            initialized: true,
            revision: data.revision || currentRevision,
            updatedAt: data.updatedAt || new Date().toISOString(),
            stats: data.stats || lastKnownStatus.stats,
            imagesCount:
                typeof data.imagesCount === 'number'
                    ? data.imagesCount
                    : lastKnownStatus.imagesCount,
        });
    } catch {
        // Re-encolar claves pendientes para el próximo intento
        for (const [t, keys] of snapshotUpserts.entries()) {
            let s = dirtyUpsertKeys.get(t);
            if (!s) {
                s = new Set();
                dirtyUpsertKeys.set(t, s);
            }
            keys.forEach(k => s.add(k));
        }
        for (const [t, keys] of snapshotDeletes.entries()) {
            let s = dirtyDeleteKeys.get(t);
            if (!s) {
                s = new Set();
                dirtyDeleteKeys.set(t, s);
            }
            keys.forEach(k => s.add(k));
        }
        notifyStatusListeners({ connected: false });
    }
}

function scheduleFlush(db) {
    if (isApplyingRemote || isBootstrapping) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushDiskSyncNow(db);
    }, 60);
}

/**
 * Registra hooks en todas las tablas de Dexie capturando únicamente las claves primarias afectadas.
 */
function attachDexieHooks(db) {
    for (const tableName of POS_DB_TABLES) {
        const table = db[tableName];
        if (!table || !table.hook) continue;

        table.hook('creating', function (primKey) {
            this.onsuccess = function (resultingKey) {
                if (!isApplyingRemote && !isBootstrapping) {
                    markUpsertKey(tableName, resultingKey ?? primKey, db);
                }
            };
        });

        table.hook('updating', function (_mods, primKey) {
            this.onsuccess = function () {
                if (!isApplyingRemote && !isBootstrapping) {
                    markUpsertKey(tableName, primKey, db);
                }
            };
        });

        table.hook('deleting', function (primKey) {
            this.onsuccess = function () {
                if (!isApplyingRemote && !isBootstrapping) {
                    markDeleteKey(tableName, primKey, db);
                }
            };
        });
    }
}

/**
 * Sube el estado completo del navegador actual hacia SQLite (`mode: 'full'`).
 * Si SQLite externalizó fotos Base64 o separó embeddings durante la subida,
 * recarga automáticamente las tablas livianas en el navegador.
 */
export async function forcePushBrowserToDisk(dbInstance) {
    const targetDb = dbInstance || (await import('./schema')).db;
    dirtyUpsertKeys.clear();
    dirtyDeleteKeys.clear();

    const allTables = await readTablesFromDexie(targetDb, POS_DB_TABLES);
    const res = await fetch('/__local_db/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientId: CLIENT_ID,
            mode: 'full',
            tables: allTables,
        }),
    });
    if (!res.ok) {
        throw new Error('No se pudo sincronizar la base de datos hacia SQLite en disco.');
    }
    const data = await res.json();
    if (data.revision) {
        setStoredLastRev(data.revision);
    }

    // Si había fotos Base64 en IndexedDB, SQLite ya las extrajo a `datos-pos/imagenes/`:
    // bajamos las tablas limpias para adelgazar IndexedDB inmediatamente.
    if (data.sanitizedUpserts?.productsChanged || data.sanitizedUpserts?.salesChanged) {
        const tablesToSlim = [];
        if (data.sanitizedUpserts.productsChanged) {
            tablesToSlim.push('products', 'productEmbeddings');
        }
        if (data.sanitizedUpserts.salesChanged) {
            tablesToSlim.push('sales');
        }
        await forcePullDiskToBrowser(targetDb, tablesToSlim);
    }

    notifyStatusListeners({
        connected: true,
        initialized: true,
        revision: data.revision || currentRevision,
        updatedAt: data.updatedAt,
        stats: data.stats || lastKnownStatus.stats,
        imagesCount:
            typeof data.imagesCount === 'number'
                ? data.imagesCount
                : lastKnownStatus.imagesCount,
    });
    return data;
}

/**
 * Descarga el estado de SQLite en disco y lo aplica al navegador actual.
 */
export async function forcePullDiskToBrowser(dbInstance, specificTables = null) {
    const targetDb = dbInstance || (await import('./schema')).db;

    if (Array.isArray(specificTables) && specificTables.length > 0) {
        const query = `?tables=${encodeURIComponent(specificTables.join(','))}`;
        const res = await fetch(`/__local_db/snapshot${query}`, { cache: 'no-store' });
        if (!res.ok) {
            throw new Error('No se pudo leer la base de datos SQLite en disco local.');
        }
        const snap = await res.json();
        if (snap.tables) {
            await applyTablesToDexie(targetDb, snap.tables);
        }
        if (snap.revision) {
            setStoredLastRev(snap.revision);
        }
        return snap;
    }

    // Descarga prioritaria de tablas operativas (< 3 MB, sin embeddings) para hidratación instantánea
    const res = await fetch('/__local_db/snapshot?exclude=productEmbeddings', {
        cache: 'no-store',
    });
    if (!res.ok) {
        throw new Error('No se pudo leer la base de datos SQLite en disco local.');
    }
    const snap = await res.json();
    if (snap.tables) {
        await applyTablesToDexie(targetDb, snap.tables);
    }
    if (snap.revision) {
        setStoredLastRev(snap.revision);
    }

    notifyStatusListeners({
        connected: true,
        initialized: Boolean(snap.initialized),
        revision: snap.revision || currentRevision,
        updatedAt: snap.updatedAt,
    });

    // Hidratar vectores de búsqueda por foto en segundo plano sin bloquear la interfaz
    if (targetDb.productEmbeddings) {
        setTimeout(() => {
            fetch('/__local_db/snapshot?tables=productEmbeddings', { cache: 'no-store' })
                .then(r => (r.ok ? r.json() : null))
                .then(embSnap => {
                    if (embSnap?.tables?.productEmbeddings) {
                        return applyTablesToDexie(targetDb, {
                            productEmbeddings: embSnap.tables.productEmbeddings,
                        });
                    }
                })
                .catch(() => {});
        }, 400);
    }

    return snap;
}

/**
 * Envía un archivo `.json` de backup (incluso de 300+ MB) por streaming directo al servidor SQLite
 * sin cargarlo con FileReader en la memoria del navegador, y luego recarga las tablas ligeras.
 */
export async function importBackupFileViaServer(file, dbInstance) {
    const targetDb = dbInstance || (await import('./schema')).db;
    const res = await fetch('/__local_db/import-backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
        throw new Error(data.error || 'No se pudo restaurar el backup en SQLite.');
    }
    await forcePullDiskToBrowser(targetDb);
    await getDiskDbStatus();
    return data;
}

/**
 * Limpia también la base de datos SQLite en disco cuando se ejecuta "Borrar Toda la Base de Datos".
 */
export async function notifyDiskWipe() {
    try {
        dirtyUpsertKeys.clear();
        dirtyDeleteKeys.clear();
        await fetch('/__local_db/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: CLIENT_ID,
                mode: 'wipe',
            }),
        });
        setStoredLastRev(0);
    } catch {
        // Ignorar si no hay servidor en disco
    }
}

/**
 * Consulta el estado actual de SQLite en disco (`< 1 ms`).
 */
export async function getDiskDbStatus() {
    try {
        const res = await fetch('/__local_db/status', { cache: 'no-store' });
        if (!res.ok) throw new Error('Status no disponible');
        const data = await res.json();
        notifyStatusListeners({
            connected: true,
            engine: data.engine || 'sqlite',
            initialized: data.initialized,
            revision: data.revision,
            updatedAt: data.updatedAt,
            dbPath: data.dbPath,
            imagesDir: data.imagesDir || '',
            imagesCount: data.imagesCount || 0,
            backupsDir: data.backupsDir,
            backupsCount: data.backupsCount,
            stats: data.stats,
        });
        return data;
    } catch {
        notifyStatusListeners({ connected: false });
        return null;
    }
}

/**
 * Solicita a SQLite en disco que guarde una copia `.sqlite` inmediata en `datos-pos/backups/`.
 */
export async function triggerDiskBackupNow() {
    const res = await fetch('/__local_db/backup-now', {
        method: 'POST',
    });
    if (!res.ok) {
        throw new Error('No se pudo crear el respaldo SQLite en disco.');
    }
    const data = await res.json();
    await getDiskDbStatus();
    return data;
}

/**
 * Inicializa la sincronización rápida entre Dexie y SQLite en disco local.
 */
export async function initDiskSync(db) {
    if (syncInitialized) return;
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    if (import.meta.env?.MODE === 'test' || import.meta.env?.VITEST) return;

    syncInitialized = true;
    currentRevision = getStoredLastRev();
    attachDexieHooks(db);

    try {
        // 1. Consulta ultraligera de estado (~300 bytes) antes de pedir cualquier snapshot
        const status = await getDiskDbStatus();
        if (!status) {
            isBootstrapping = false;
            return;
        }

        const [localProdCount, localSalesCount, localUsersCount, localClosuresCount] =
            await Promise.all([
                db.products.count(),
                db.sales.count(),
                db.users.count(),
                db.cashClosures.count(),
            ]);

        const fakeDiskTables = {
            products: new Array(status.stats?.products || 0),
            sales: new Array(status.stats?.sales || 0),
            kardex: new Array(status.stats?.kardex || 0),
            users: new Array(status.stats?.users || 0),
            cashClosures: new Array(status.stats?.cashClosures || 0),
        };
        const fakeLocalTables = {
            products: new Array(localProdCount),
            sales: new Array(localSalesCount),
            kardex: [],
            users: new Array(localUsersCount),
            cashClosures: new Array(localClosuresCount),
        };

        // Si en IndexedDB todavía quedó alguna foto Base64 antigua, forzar sincronización con SQLite
        // para que extraiga las imágenes a `datos-pos/imagenes/` y adelgace el navegador.
        const firstInlinePhoto = await db.products
            .filter(p => typeof p.photo === 'string' && p.photo.startsWith('data:image/'))
            .first();

        const decision = decidirSincronizacionInicial({
            diskInitialized: Boolean(status.initialized),
            diskRevision: Number(status.revision) || 0,
            diskTables: fakeDiskTables,
            localTables: fakeLocalTables,
            localLastSyncedRev: currentRevision,
        });

        if (decision.action === 'push_local_to_disk') {
            await forcePushBrowserToDisk(db);
        } else if (decision.action === 'pull_disk_to_local' && status.initialized) {
            await forcePullDiskToBrowser(db);
        } else if (firstInlinePhoto) {
            // Mismo número de revisión pero aún tenía fotos Base64 locales: empujar para externalizarlas
            await forcePushBrowserToDisk(db);
        }
    } catch {
        notifyStatusListeners({ connected: false });
    } finally {
        isBootstrapping = false;
    }

    // Suscripción en tiempo real mediante Server-Sent Events (SSE)
    if (typeof EventSource !== 'undefined') {
        try {
            const es = new EventSource('/__local_db/stream');
            es.onmessage = async ev => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.type === 'connected') {
                        notifyStatusListeners({
                            connected: true,
                            initialized: msg.initialized,
                            revision: msg.revision,
                            updatedAt: msg.updatedAt,
                        });
                        if (msg.initialized && msg.revision > currentRevision && !isBootstrapping) {
                            await forcePullDiskToBrowser(db);
                        }
                        return;
                    }

                    // Ignorar eventos originados por esta misma pestaña
                    if (msg.clientId && msg.clientId === CLIENT_ID) {
                        return;
                    }

                    if (msg.type === 'ops') {
                        if (msg.upserts || msg.deletes) {
                            await applyIncrementalOpsToDexie(db, {
                                upserts: msg.upserts || {},
                                deletes: msg.deletes || {},
                            });
                            if (msg.revision) setStoredLastRev(msg.revision);
                        } else if (Array.isArray(msg.updatedTables)) {
                            await forcePullDiskToBrowser(db, msg.updatedTables);
                        }
                        await getDiskDbStatus();
                    } else if (msg.type === 'patch' && Array.isArray(msg.updatedTables)) {
                        await forcePullDiskToBrowser(db, msg.updatedTables);
                        await getDiskDbStatus();
                    } else if (msg.type === 'full' || msg.type === 'wipe') {
                        await forcePullDiskToBrowser(db);
                        await getDiskDbStatus();
                    }
                } catch {
                    // Ignorar mensajes malformados
                }
            };
            es.onerror = () => {
                notifyStatusListeners({ connected: false });
            };
        } catch {
            // Ignorar si EventSource no está disponible
        }
    }

    // Al recuperar el foco de la ventana, verificar con `/__local_db/status` (<1 ms) si la revisión avanzó
    window.addEventListener('focus', async () => {
        if (isBootstrapping || isApplyingRemote) return;
        try {
            const status = await getDiskDbStatus();
            if (status && status.initialized && status.revision > currentRevision) {
                await forcePullDiskToBrowser(db);
            }
        } catch {
            // Ignorar
        }
    });
}
