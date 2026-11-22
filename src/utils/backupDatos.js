/**
 * Arma y planifica el JSON de backup sin tocar Dexie.
 *
 * El archivo completo guarda el hash de la contraseña (no lo cambia por ***):
 * sin ese hash, importar usuarios deja la tienda sin forma de entrar.
 * La copia sin secretos omite hashes y syncToken y lo declara en `aviso`.
 * Un archivo viejo con *** no pisa el hash que ya está en la máquina.
 */

export const VERSION_BACKUP = 11;

export const TABLAS_CAJA = [
    'cashOpenings',
    'cashClosures',
    'cashClosureHistory',
    'securityLogs',
];

export const TABLAS_BACKUP = [
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
    'webEventos',
    ...TABLAS_CAJA,
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
        data[nombre] = copiarFilas(tablas[nombre]);
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
 * archivo las trae: un backup viejo (v10) no borra la caja de la máquina.
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
            tablas[nombre] = data[nombre].map(fila => ({ ...fila }));
        }
    }

    return { ok: true, tablas, avisos, usuariosOmitidos };
}
