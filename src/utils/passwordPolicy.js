/**
 * Política de contraseñas del POS (lógica pura, testeable).
 * Las credenciales iniciales (`admin/admin123`, `cajera/cajera123`) son públicas en el
 * repositorio: quien entra con ellas está OBLIGADO a elegir una nueva antes de operar.
 */

export const LARGO_MINIMO_CONTRASENA = 8;

export const CONTRASENAS_POR_DEFECTO = Object.freeze([
    'admin123',
    'cajera123',
    'admin',
    'cajera',
    '123456',
    '12345678',
    'password',
]);

export function esContrasenaPorDefecto(password) {
    if (typeof password !== 'string') return false;
    return CONTRASENAS_POR_DEFECTO.includes(password.trim().toLowerCase());
}

/**
 * ¿Debe forzarse el cambio de contraseña tras un login correcto?
 * Sí si el usuario está marcado (`mustChangePassword`, sembrado en altas iniciales) o si
 * entró con una contraseña conocida de fábrica (cubre BD existentes sin la marca).
 */
export function requiereCambioContrasena(user, passwordIngresada) {
    return user?.mustChangePassword === true || esContrasenaPorDefecto(passwordIngresada);
}

/**
 * Valida la contraseña elegida en el cambio forzado.
 * @returns {{ ok: boolean, error?: string }}
 */
export function validarNuevaContrasena({ actual, nueva, confirmacion, username } = {}) {
    if (typeof nueva !== 'string' || nueva.length < LARGO_MINIMO_CONTRASENA) {
        return { ok: false, error: `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres` };
    }
    if (nueva !== confirmacion) {
        return { ok: false, error: 'Las contraseñas no coinciden' };
    }
    if (nueva === actual) {
        return { ok: false, error: 'La nueva contraseña debe ser distinta de la actual' };
    }
    if (esContrasenaPorDefecto(nueva)) {
        return { ok: false, error: 'Esa contraseña es demasiado común; elige otra' };
    }
    if (username && nueva.trim().toLowerCase() === String(username).trim().toLowerCase()) {
        return { ok: false, error: 'La contraseña no puede ser igual al usuario' };
    }
    return { ok: true };
}
