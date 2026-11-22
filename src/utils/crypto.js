/**
 * Hashing de contraseñas con PBKDF2 (Web Crypto API)
 * Sin dependencias externas — usa APIs nativas del navegador.
 */

const ITERATIONS = 100_000;
const KEY_LENGTH = 256;
const SALT_LENGTH = 16;

function bufferToHex(buffer) {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function hexToBuffer(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes.buffer;
}

async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
        keyMaterial,
        KEY_LENGTH
    );
    return bits;
}

/**
 * Hashea una contraseña. Retorna string "salt:hash" en hex.
 */
export async function hashPassword(password) {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    const derived = await deriveKey(password, salt.buffer);
    return `${bufferToHex(salt.buffer)}:${bufferToHex(derived)}`;
}

const FORMATO_HASH = /^[0-9a-f]{32}:[0-9a-f]{64}$/i;

/** ¿El valor guardado tiene el formato `salt:hash` generado por hashPassword? */
export function esHashValido(valor) {
    return typeof valor === 'string' && FORMATO_HASH.test(valor);
}

/**
 * Verifica una contraseña contra un hash "salt:hash".
 * Ya NO acepta contraseñas en texto plano: un valor que no sea un hash válido
 * (legacy sin migrar, vacío o corrupto) siempre falla. Las contraseñas legacy se
 * convierten a hash al abrir la BD con `migrarContrasenasLegacy`.
 */
export async function verifyPassword(password, storedHash) {
    if (typeof password !== 'string' || !esHashValido(storedHash)) {
        return false;
    }
    const [saltHex, hashHex] = storedHash.split(':');
    const salt = hexToBuffer(saltHex);
    const derived = await deriveKey(password, salt);
    return bufferToHex(derived) === hashHex.toLowerCase();
}

/**
 * Calcula las actualizaciones necesarias para pasar a hash las contraseñas que aún están
 * en texto plano (usuarios creados por versiones antiguas). No toca usuarios que ya tienen
 * hash válido ni los que no tienen contraseña.
 * @returns {Promise<Array<{ id: number|string, password: string }>>}
 */
export async function migrarContrasenasLegacy(users, hash = hashPassword) {
    const cambios = [];
    for (const u of users || []) {
        if (typeof u?.password === 'string' && u.password !== '' && !esHashValido(u.password)) {
            cambios.push({ id: u.id, password: await hash(u.password) });
        }
    }
    return cambios;
}
