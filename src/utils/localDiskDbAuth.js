/**
 * Control de acceso de la BD central en disco (`/__local_db/*`). Lógica PURA, compartida
 * por el servidor (plugin de Vite) y el cliente (`db/diskSync.js`); sin dependencias de
 * Node ni del navegador para poder testearla en vitest.
 *
 * Modelo de amenaza: el servidor escucha en la red local de la tienda. Sin esto, cualquier
 * equipo de esa red (o una página web abierta en la central) podía leer o reemplazar la BD
 * completa, usuarios y hashes incluidos.
 *
 * Reglas (en orden):
 *  1. Sin token configurado → se niega todo (falla cerrado).
 *  2. Si la petición trae `Origin` y no coincide con `Host` → 403 (anti CSRF desde otra web).
 *  3. Petición desde la propia máquina (socket loopback Y `Host` local) → permitida sin token.
 *     El chequeo de `Host` evita el DNS rebinding (un dominio externo apuntando a 127.0.0.1).
 *  4. Cualquier otra → exige el token (cabecera `X-POS-Token`, `Authorization: Bearer` o
 *     `?token=` para EventSource, que no permite cabeceras).
 */

export const TOKEN_HEADER = 'x-pos-token';
export const TOKEN_MIN_LENGTH = 16;

export function esDireccionLoopback(direccion) {
    if (typeof direccion !== 'string' || !direccion) return false;
    const d = direccion.trim().toLowerCase();
    return d === '::1' || d === '127.0.0.1' || d.startsWith('127.') || d.startsWith('::ffff:127.');
}

/** Extrae el nombre de host (sin puerto) de una cabecera `Host`. */
export function hostSinPuerto(hostHeader) {
    if (typeof hostHeader !== 'string') return '';
    const h = hostHeader.trim().toLowerCase();
    if (h.startsWith('[')) {
        const fin = h.indexOf(']');
        return fin === -1 ? '' : h.slice(0, fin + 1);
    }
    return h.split(':')[0];
}

export function hostEsLocal(hostHeader) {
    const h = hostSinPuerto(hostHeader);
    return h === 'localhost' || h === '[::1]' || h === '127.0.0.1' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

/** Compara en tiempo constante (sin cortocircuito) para no filtrar el token por timing. */
export function tokensIguales(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

function leerCabecera(headers, nombre) {
    if (!headers) return undefined;
    const valor = headers[nombre] ?? headers[nombre.toLowerCase()];
    return Array.isArray(valor) ? valor[0] : valor;
}

export function extraerToken({ headers, searchParams } = {}) {
    const directa = leerCabecera(headers, TOKEN_HEADER);
    if (typeof directa === 'string' && directa.trim()) return directa.trim();

    const auth = leerCabecera(headers, 'authorization');
    if (typeof auth === 'string') {
        const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
        if (m) return m[1].trim();
    }

    const query = searchParams?.get?.('token');
    return query && query.trim() ? query.trim() : null;
}

function origenCoincideConHost(origin, hostHeader) {
    try {
        return new URL(origin).host.toLowerCase() === String(hostHeader || '').trim().toLowerCase();
    } catch {
        return false;
    }
}

/**
 * Decide si una petición a `/__local_db/*` puede continuar.
 * @returns {{ permitido: boolean, via?: 'loopback'|'token', status?: number, codigo?: string, mensaje?: string }}
 */
export function evaluarAccesoLocalDb({
    headers,
    searchParams,
    remoteAddress,
    token,
    confiarLoopback = true,
} = {}) {
    if (typeof token !== 'string' || token.length < TOKEN_MIN_LENGTH) {
        return {
            permitido: false,
            status: 503,
            codigo: 'token_no_configurado',
            mensaje: 'La BD central en disco no tiene un token de acceso configurado.',
        };
    }

    const host = leerCabecera(headers, 'host');
    const origin = leerCabecera(headers, 'origin');
    if (origin !== undefined && !origenCoincideConHost(origin, host)) {
        return {
            permitido: false,
            status: 403,
            codigo: 'origen_no_permitido',
            mensaje: 'Origen no permitido.',
        };
    }

    if (confiarLoopback && esDireccionLoopback(remoteAddress) && hostEsLocal(host)) {
        return { permitido: true, via: 'loopback' };
    }

    const recibido = extraerToken({ headers, searchParams });
    if (!recibido) {
        return {
            permitido: false,
            status: 401,
            codigo: 'token_requerido',
            mensaje: 'Se requiere el token de acceso de la BD central.',
        };
    }
    if (!tokensIguales(recibido, token)) {
        return {
            permitido: false,
            status: 401,
            codigo: 'token_invalido',
            mensaje: 'Token de acceso inválido.',
        };
    }
    return { permitido: true, via: 'token' };
}

/** Agrega `?token=` a una URL relativa (para EventSource). Sin token devuelve la URL intacta. */
export function agregarTokenAUrl(url, token) {
    if (!token) return url;
    const separador = url.includes('?') ? '&' : '?';
    return `${url}${separador}token=${encodeURIComponent(token)}`;
}

/** Normaliza lo que el usuario pega en el campo de token (espacios/saltos de línea). */
export function normalizarTokenIngresado(texto) {
    if (typeof texto !== 'string') return '';
    return texto.replace(/\s+/g, '');
}
