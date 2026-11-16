import {
    POS_DB_TABLES,
    decidirSincronizacionInicial,
} from '../utils/localDiskDbEngine';

const LAST_REV_STORAGE_KEY = 'pos_local_disk_last_rev';

const CLIENT_ID =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `client-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let syncInitialized = false;
let isApplyingRemote = false;
let isBootstrapping = true;
let currentRevision = 0;
let flushTimer = null;
const dirtyTables = new Set();
const statusListeners = new Set();

let lastKnownStatus = {
    connected: false,
    initialized: false,
    revision: 0,
    updatedAt: null,
    dbPath: '',
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
 * Lee todas las tablas o un subconjunto de tablas desde Dexie.
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
 * Escribe un conjunto de tablas dentro de Dexie sin disparar eco hacia el servidor en disco.
 */
async function applyTablesToDexie(db, tablesMap = {}) {
    const validTableNames = Object.keys(tablesMap).filter(
        name => POS_DB_TABLES.includes(name) && db[name] && Array.isArray(tablesMap[name])
    );
    if (validTableNames.length === 0) return;

    isApplyingRemote = true;
    try {
        const dexieTables = validTableNames.map(name => db[name]);
        await db.transaction('rw', dexieTables, async () => {
            for (const name of validTableNames) {
                const rows = tablesMap[name];
                await db[name].clear();
                if (rows.length > 0) {
                    await db[name].bulkPut(rows);
                }
            }
        });
    } finally {
        isApplyingRemote = false;
    }
}

/**
 * Envía inmediatamente al disco las tablas marcadas como modificadas.
 */
export async function flushDiskSyncNow(db) {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (isApplyingRemote || isBootstrapping || dirtyTables.size === 0) return;

    const tablesToPush = Array.from(dirtyTables);
    dirtyTables.clear();

    try {
        const tablesPayload = await readTablesFromDexie(db, tablesToPush);
        const res = await fetch('/__local_db/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientId: CLIENT_ID,
                mode: 'patch',
                tables: tablesPayload,
            }),
        });
        if (res.ok) {
            const data = await res.json();
            if (data.revision) {
                setStoredLastRev(data.revision);
            }
            notifyStatusListeners({
                connected: true,
                initialized: true,
                revision: data.revision || currentRevision,
                updatedAt: data.updatedAt || new Date().toISOString(),
                stats: data.stats || lastKnownStatus.stats,
            });
        }
    } catch {
        // Si falla momentáneamente, re-encolar las tablas para el próximo intento
        tablesToPush.forEach(t => dirtyTables.add(t));
        notifyStatusListeners({ connected: false });
    }
}

function scheduleFlush(db) {
    if (isApplyingRemote || isBootstrapping) return;
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
        flushDiskSyncNow(db);
    }, 100);
}

/**
 * Registra hooks en todas las tablas de Dexie para detectar cambios locales automáticamente.
 */
function attachDexieHooks(db) {
    for (const tableName of POS_DB_TABLES) {
        const table = db[tableName];
        if (!table || !table.hook) continue;

        table.hook('creating', function () {
            if (!isApplyingRemote && !isBootstrapping) {
                dirtyTables.add(tableName);
                this.onsuccess = () => scheduleFlush(db);
            }
        });

        table.hook('updating', function () {
            if (!isApplyingRemote && !isBootstrapping) {
                dirtyTables.add(tableName);
                this.onsuccess = () => scheduleFlush(db);
            }
        });

        table.hook('deleting', function () {
            if (!isApplyingRemote && !isBootstrapping) {
                dirtyTables.add(tableName);
                this.onsuccess = () => scheduleFlush(db);
            }
        });
    }
}

/**
 * Sube el estado completo del navegador actual al servidor en disco (`mode: 'full'`).
 */
export async function forcePushBrowserToDisk(dbInstance) {
    const targetDb = dbInstance || (await import('./schema')).db;
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
        throw new Error('No se pudo sincronizar la base de datos hacia el disco local.');
    }
    const data = await res.json();
    if (data.revision) {
        setStoredLastRev(data.revision);
    }
    notifyStatusListeners({
        connected: true,
        initialized: true,
        revision: data.revision || currentRevision,
        updatedAt: data.updatedAt,
        stats: data.stats || lastKnownStatus.stats,
    });
    return data;
}

/**
 * Descarga el estado del servidor en disco y lo aplica al navegador actual.
 */
export async function forcePullDiskToBrowser(dbInstance, specificTables = null) {
    const targetDb = dbInstance || (await import('./schema')).db;
    const query =
        Array.isArray(specificTables) && specificTables.length > 0
            ? `?tables=${encodeURIComponent(specificTables.join(','))}`
            : '';
    const res = await fetch(`/__local_db/snapshot${query}`, { cache: 'no-store' });
    if (!res.ok) {
        throw new Error('No se pudo leer la base de datos en disco local.');
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
    return snap;
}

/**
 * Limpia también la base de datos en disco cuando se ejecuta "Borrar Toda la Base de Datos".
 */
export async function notifyDiskWipe() {
    try {
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
        // Ignorar si no hay servidor local
    }
}

/**
 * Consulta el estado actual del servidor de base de datos en disco.
 */
export async function getDiskDbStatus() {
    try {
        const res = await fetch('/__local_db/status', { cache: 'no-store' });
        if (!res.ok) throw new Error('Status no disponible');
        const data = await res.json();
        notifyStatusListeners({
            connected: true,
            initialized: data.initialized,
            revision: data.revision,
            updatedAt: data.updatedAt,
            dbPath: data.dbPath,
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
 * Solicita al servidor en disco que guarde una copia de seguridad inmediata en `datos-pos/backups/`.
 */
export async function triggerDiskBackupNow() {
    const res = await fetch('/__local_db/backup-now', {
        method: 'POST',
    });
    if (!res.ok) {
        throw new Error('No se pudo crear el respaldo en disco.');
    }
    const data = await res.json();
    await getDiskDbStatus();
    return data;
}

/**
 * Inicializa la sincronización bidireccional entre Dexie y el archivo en disco local.
 */
export async function initDiskSync(db) {
    if (syncInitialized) return;
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    if (import.meta.env?.MODE === 'test' || import.meta.env?.VITEST) return;

    syncInitialized = true;
    attachDexieHooks(db);

    try {
        const res = await fetch('/__local_db/snapshot', { cache: 'no-store' });
        if (!res.ok) {
            isBootstrapping = false;
            return;
        }

        const diskSnap = await res.json();
        const localTables = await readTablesFromDexie(db, POS_DB_TABLES);
        const decision = decidirSincronizacionInicial({
            diskInitialized: Boolean(diskSnap.initialized),
            diskRevision: Number(diskSnap.revision) || 0,
            diskTables: diskSnap.tables || {},
            localTables,
            localLastSyncedRev: getStoredLastRev(),
        });

        if (decision.action === 'push_local_to_disk') {
            await forcePushBrowserToDisk(db);
        } else if (decision.action === 'pull_disk_to_local' && diskSnap.initialized) {
            await applyTablesToDexie(db, diskSnap.tables || {});
            setStoredLastRev(diskSnap.revision || 0);
        }

        await getDiskDbStatus();
    } catch {
        // Si el servidor estático no tiene el middleware activo, opera normalmente en IndexedDB
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

                    if (msg.type === 'patch' && Array.isArray(msg.updatedTables)) {
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

    // Respaldo adicional: al recuperar el foco de la ventana, verificar si la revisión en disco avanzó
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
