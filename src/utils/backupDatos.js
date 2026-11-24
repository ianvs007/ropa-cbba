/**
 * Arma y planifica el JSON de backup sin tocar Dexie ni SQLite.
 *
 * El archivo completo guarda el hash de la contraseña (no lo cambia por ***):
 * sin ese hash, importar usuarios deja la tienda sin forma de entrar.
 * La copia sin secretos omite hashes y syncToken y lo declara en `aviso`.
 * Un archivo viejo con *** no pisa el hash que ya está en la máquina.
 *
 * La versión 11 de main (SQLite, 24/11/2026) ya significaba embeddings y
 * sucursales, con claves en *** y sin caja. Esta copia es la versión 12:
 * mismas tablas del disco (incluye productEmbeddings) más aperturas, cierres,
 * historial y logs, con el hash real.
 */

export const VERSION_BACKUP = 12;

export const TABLAS_CAJA = [
    'cashOpenings',
    'cashClosures',
    'cashClosureHistory',
    'securityLogs',
];

/** Mismas tablas que `POS_DB_TABLES` en el motor SQLite (schema v28). */
export const TABLAS_BACKUP = [
    'products',
    'productEmbeddings',
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

/** Settings cuyo valor es un secreto. La copia sin secretos no los incluye. */
export const CLAVES_SETTINGS_SECRETAS = ['syncToken'];

export const MARCA_CLAVE_OMITIDA = '***';

export const AVISO_SIN_SECRETOS =
    'Se omitieron hashes de contraseña y settings secretos (syncToken). Esta copia no restaura el inicio de sesión ni el token de la tienda virtual. La caja, los cierres y el resto de la configuración sí viajan.';

export function esClaveEnmascarada(password) {
    return password == null || password === '' || password === MARCA_CLAVE_OMITIDA;
}

function copiarFilas(filas) {
    if (!Array.isArray(filas)) return [];
    return filas.map(fila => ({ ...fila }));
}

/** El vector vive en productEmbeddings (v28). El JSON nuevo no lo repite en la prenda. */
function copiarProductoSinVector(fila) {
    const copia = { ...fila };
    delete copia.embedding;
    return copia;
}

export function resumirSecretos(data = {}) {
    const usuariosConHash = (data.users || [])
        .filter(u => !esClaveEnmascarada(u.password))
        .map(u => u.username || String(u.id));
    const settingsSecretos = (data.settings || [])
        .filter(s => CLAVES_SETTINGS_SECRETAS.includes(s.key))
        .map(s => s.key);
    return {
        incluyeHashesDeClave: usuariosConHash.length > 0,
        usuariosConHash,
        settingsSecretos,
    };
}

export function armarBackup(tablas = {}, { exportedAt = null, version = VERSION_BACKUP } = {}) {
    const data = {};
    for (const nombre of TABLAS_BACKUP) {
        if (nombre === 'products') {
            data.products = (Array.isArray(tablas.products) ? tablas.products : []).map(copiarProductoSinVector);
        } else {
            data[nombre] = copiarFilas(tablas[nombre]);
        }
    }
    return {
        version,
        exportedAt,
        secretos: resumirSecretos(data),
        data,
    };
}

export function armarBackupSinSecretos(tablas = {}, opts = {}) {
    const completo = armarBackup(tablas, opts);
    const omitidos = [];
    const users = completo.data.users.map(u => {
        if (!esClaveEnmascarada(u.password)) {
            omitidos.push({ tipo: 'usuario', id: u.username || u.id, motivo: 'hash de contraseña' });
        }
        return { ...u, password: MARCA_CLAVE_OMITIDA, claveOmitida: true };
    });
    const settings = completo.data.settings.filter(s => {
        if (CLAVES_SETTINGS_SECRETAS.includes(s.key)) {
            omitidos.push({ tipo: 'setting', id: s.key, motivo: 'secreto' });
            return false;
        }
        return true;
    });
    const data = { ...completo.data, users, settings };
    return {
        version: completo.version,
        exportedAt: completo.exportedAt,
        sinSecretos: true,
        aviso: AVISO_SIN_SECRETOS,
        omitidos,
        secretos: resumirSecretos(data),
        data,
    };
}

function buscarUsuarioActual(usuario, porId, porNombre) {
    if (usuario.id != null && porId.has(usuario.id)) return porId.get(usuario.id);
    if (usuario.username && porNombre.has(usuario.username)) return porNombre.get(usuario.username);
    return null;
}

/**
 * Decide qué filas escribir. Las tablas de caja solo se reemplazan si el
 * archivo las trae: un backup viejo (v10 o v11 de main) no borra la caja.
 */
export function planificarImportacion(backup, { usuariosActuales = [], settingsActuales = [] } = {}) {
    if (!backup || !backup.data || typeof backup.data !== 'object' || Array.isArray(backup.data)) {
        return { ok: false, error: 'Archivo de backup inválido' };
    }

    const data = backup.data;
    const porId = new Map(usuariosActuales.filter(u => u && u.id != null).map(u => [u.id, u]));
    const porNombre = new Map(usuariosActuales.filter(u => u && u.username).map(u => [u.username, u]));
    const avisos = [];
    const usuariosOmitidos = [];
    const tablas = {};

    if (Array.isArray(data.users)) {
        const users = [];
        for (const usuario of data.users) {
            const copia = { ...usuario };
            const enmascarada = esClaveEnmascarada(copia.password) || copia.claveOmitida === true;
            delete copia.claveOmitida;
            if (!enmascarada) {
                users.push(copia);
                continue;
            }
            const actual = buscarUsuarioActual(copia, porId, porNombre);
            if (actual && !esClaveEnmascarada(actual.password)) {
                copia.password = actual.password;
                avisos.push(`Se conservó la contraseña actual de ${copia.username || copia.id} (el archivo la traía enmascarada).`);
                users.push(copia);
            } else {
                usuariosOmitidos.push({ id: copia.id, username: copia.username });
                avisos.push(`El usuario ${copia.username || copia.id} quedó sin contraseña utilizable: el archivo no trae el hash.`);
            }
        }
        tablas.users = users;
    }

    if (Array.isArray(data.settings)) {
        if (backup.sinSecretos) {
            const delArchivo = data.settings
                .filter(s => !CLAVES_SETTINGS_SECRETAS.includes(s.key))
                .map(s => ({ ...s }));
            const claves = new Set(delArchivo.map(s => s.key));
            const conservados = settingsActuales
                .filter(s => CLAVES_SETTINGS_SECRETAS.includes(s.key) && !claves.has(s.key))
                .map(s => ({ ...s }));
            tablas.settings = [...delArchivo, ...conservados];
            avisos.push('Este archivo omitió secretos: se conservaron el token y las contraseñas que ya estaban en esta máquina.');
        } else {
            tablas.settings = data.settings.map(s => ({ ...s }));
        }
    }

    for (const nombre of TABLAS_BACKUP) {
        if (nombre === 'users' || nombre === 'settings') continue;
        if (Array.isArray(data[nombre])) {
            // El embedding incrustado se conserva: el importador (Dexie o SQLite)
            // lo saca a productEmbeddings. Borrarlo aquí perdería el vector de un v11.
            tablas[nombre] = copiarFilas(data[nombre]);
        }
    }

    return { ok: true, tablas, avisos, usuariosOmitidos };
}

/**
 * Hay usuarios con hash, o el archivo traía la lista vacía de verdad.
 * Si todos venían en *** y no hay hash local, no se borra la tabla.
 */
export function debeReemplazarUsuarios(plan) {
    return Array.isArray(plan?.tablas?.users)
        && (plan.tablas.users.length > 0 || (plan.usuariosOmitidos || []).length === 0);
}

/**
 * Arma el juego completo de tablas para escribir en SQLite (modo full borra
 * lo que no se reenvía). Lo que el archivo no trae se conserva.
 * Si el archivo trae productos y no trae `productEmbeddings`, esa tabla se
 * vacía: los vectores viejos no corresponden al catálogo nuevo. El importador
 * los vuelve a llenar si el producto todavía trae `embedding` (backup anterior
 * a v28).
 */
export function componerTablasRestauracion(backup, actuales = {}) {
    const plan = planificarImportacion(backup, {
        usuariosActuales: actuales.users || [],
        settingsActuales: actuales.settings || [],
    });
    if (!plan.ok) return plan;

    const reemplazarUsuarios = debeReemplazarUsuarios(plan);
    const reemplazaProductos = Array.isArray(plan.tablas.products);
    const tablas = {};
    const reemplazadas = [];

    for (const nombre of TABLAS_BACKUP) {
        if (nombre === 'users') {
            if (reemplazarUsuarios) {
                tablas.users = plan.tablas.users;
                reemplazadas.push('users');
            } else {
                tablas.users = copiarFilas(actuales.users);
            }
            continue;
        }
        if (nombre === 'productEmbeddings') {
            if (Array.isArray(plan.tablas.productEmbeddings)) {
                tablas.productEmbeddings = plan.tablas.productEmbeddings;
                reemplazadas.push(nombre);
            } else if (reemplazaProductos) {
                tablas.productEmbeddings = [];
                reemplazadas.push(nombre);
            } else {
                tablas.productEmbeddings = copiarFilas(actuales.productEmbeddings);
            }
            continue;
        }
        if (Array.isArray(plan.tablas[nombre])) {
            tablas[nombre] = plan.tablas[nombre];
            reemplazadas.push(nombre);
        } else {
            tablas[nombre] = copiarFilas(actuales[nombre]);
        }
    }

    return {
        ok: true,
        tablas,
        reemplazadas,
        avisos: plan.avisos,
        usuariosOmitidos: plan.usuariosOmitidos,
        reemplazarUsuarios,
    };
}
