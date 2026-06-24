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

/**
 * Verifica una contraseña contra un hash "salt:hash".
 * También acepta contraseñas legacy en texto plano (sin ':').
 */
export async function verifyPassword(password, storedHash) {
    // Legacy: si no tiene formato salt:hash, comparar directo
    if (!storedHash.includes(':')) {
        return password === storedHash;
    }
    const [saltHex, hashHex] = storedHash.split(':');
    const salt = hexToBuffer(saltHex);
    const derived = await deriveKey(password, salt);
    return bufferToHex(derived) === hashHex;
}
