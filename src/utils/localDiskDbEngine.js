/**
 * Motor puro de lógica y decisión para la Base de Datos en Disco Local.
 *
 * Permite que todos los navegadores de la PC (Chrome, Edge, perfiles distintos)
 * y otras PCs en la misma red local (LAN) compartan la misma base de datos
 * almacenada en un archivo físico en disco (`datos-pos/pos-db.json`),
 * manteniendo la velocidad en memoria de Dexie.js.
 */

export const POS_DB_TABLES = [
    'products',
    'kardex',
    'sales',
    'expenseCategories',
    'expenses',
    'users',
    'settings',
    'reservations',
    'reservationPayments',
    'categories',
    'productNames',
    'productFields',
    'barcodes',
    'brands',
    'colors',
    'branches',
    'branchTransfers',
    'cashClosures',
    'cashClosureHistory',
    'securityLogs',
    'cashOpenings',
    'webEventos',
];

/**
 * Calcula estadísticas resumidas de un conjunto de tablas.
 */
export function calcularEstadisticasTablas(tables = {}) {
    return {
        products: Array.isArray(tables.products) ? tables.products.length : 0,
        barcodes: Array.isArray(tables.barcodes) ? tables.barcodes.length : 0,
        sales: Array.isArray(tables.sales) ? tables.sales.length : 0,
        kardex: Array.isArray(tables.kardex) ? tables.kardex.length : 0,
        users: Array.isArray(tables.users) ? tables.users.length : 0,
        branches: Array.isArray(tables.branches) ? tables.branches.length : 0,
        cashClosures: Array.isArray(tables.cashClosures) ? tables.cashClosures.length : 0,
    };
}

/**
 * Determina si un conjunto de tablas tiene datos operativos reales (más allá del seed vacío).
 */
export function tieneDatosOperativos(tables = {}) {
    const stats = calcularEstadisticasTablas(tables);
    return (
        stats.products > 0 ||
        stats.sales > 0 ||
        stats.kardex > 0 ||
        stats.cashClosures > 0
    );
}

/**
 * Decide la dirección de sincronización inicial cuando un navegador se conecta al servidor en disco:
 * - 'push_local_to_disk': El navegador actual tiene datos reales (ej. el perfil original del admin)
 *   y el disco está vacío o aún no tiene datos operativos. Se sube el navegador al disco para no perder nada.
 * - 'pull_disk_to_local': El disco ya tiene datos (o el navegador está vacío/nuevo) y debe hidratar al navegador.
 * - 'noop': Ambos están vacíos y sin inicializar.
 */
export function decidirSincronizacionInicial({
    diskInitialized = false,
    diskRevision = 0,
    diskTables = {},
    localTables = {},
    localLastSyncedRev = 0,
} = {}) {
    const diskHasData = tieneDatosOperativos(diskTables);
    const localHasData = tieneDatosOperativos(localTables);
    const diskStats = calcularEstadisticasTablas(diskTables);
    const localStats = calcularEstadisticasTablas(localTables);

    // 1. Si el disco aún no fue inicializado nunca:
    if (!diskInitialized || diskRevision === 0) {
        if (localHasData || localStats.users > 0) {
            return {
                action: 'push_local_to_disk',
                reason: 'El servidor en disco es nuevo; se migran los datos del navegador actual al disco.',
            };
        }
        return {
            action: 'noop',
            reason: 'Tanto el disco como el navegador están sin inicializar.',
        };
    }

    // 2. Si el disco fue inicializado solo con el seed vacío (0 productos/ventas)
    //    pero el usuario abrió ahora su navegador principal que sí tiene productos/ventas reales:
    if (!diskHasData && localHasData) {
        return {
            action: 'push_local_to_disk',
            reason: 'El navegador actual contiene datos operativos que aún no estaban en el disco.',
        };
    }

    // 3. Si el navegador actual nunca se había sincronizado con el disco (localLastSyncedRev === 0)
    //    pero tiene MÁS productos y ventas que el disco (caso de migración desde perfil antiguo):
    if (
        localLastSyncedRev === 0 &&
        localHasData &&
        localStats.products > diskStats.products &&
        localStats.sales >= diskStats.sales
    ) {
        return {
            action: 'push_local_to_disk',
            reason: 'El perfil del navegador tiene un catálogo más completo que el disco inicial.',
        };
    }

    // 4. En cualquier otro caso, el disco es la fuente de la verdad para todos los navegadores:
    return {
        action: 'pull_disk_to_local',
        reason: 'El disco local es la fuente de verdad compartida entre navegadores.',
    };
}

/**
 * Aplica un parche parcial o reemplazo completo sobre el estado en memoria del servidor en disco.
 */
export function aplicarCambioEstadoDisco(estadoActual, payload = {}) {
    const baseTables = {};
    for (const table of POS_DB_TABLES) {
        baseTables[table] = Array.isArray(estadoActual?.tables?.[table])
            ? estadoActual.tables[table]
            : [];
    }

    const mode = payload.mode || 'patch';
    const now = payload.now || new Date().toISOString();
    const nextRevision = (Number(estadoActual?.revision) || 0) + 1;

    if (mode === 'wipe') {
        const emptyTables = {};
        for (const table of POS_DB_TABLES) {
            emptyTables[table] = [];
        }
        return {
            version: 1,
            initialized: false,
            revision: nextRevision,
            updatedAt: now,
            lastClientId: payload.clientId || null,
            tables: emptyTables,
            updatedTables: [...POS_DB_TABLES],
        };
    }

    if (mode === 'full') {
        const fullTables = {};
        for (const table of POS_DB_TABLES) {
            fullTables[table] = Array.isArray(payload.tables?.[table])
                ? payload.tables[table]
                : [];
        }
        return {
            version: 1,
            initialized: true,
            revision: nextRevision,
            updatedAt: now,
            lastClientId: payload.clientId || null,
            tables: fullTables,
            updatedTables: [...POS_DB_TABLES],
        };
    }

    // mode === 'patch'
    const patchedTables = { ...baseTables };
    const updatedTables = [];
    if (payload.tables && typeof payload.tables === 'object') {
        for (const [table, rows] of Object.entries(payload.tables)) {
            if (POS_DB_TABLES.includes(table) && Array.isArray(rows)) {
                patchedTables[table] = rows;
                updatedTables.push(table);
            }
        }
    }

    return {
        version: 1,
        initialized: true,
        revision: nextRevision,
        updatedAt: now,
        lastClientId: payload.clientId || null,
        tables: patchedTables,
        updatedTables,
    };
}
