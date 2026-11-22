import { verifyPassword } from './crypto';

/**
 * Re-autenticación de un administrador para acciones destructivas (borrado total,
 * limpieza para producción, restauración de backup).
 * Se verifica contra el registro ACTUAL del usuario en la BD, no contra la sesión: un
 * usuario desactivado o degradado a vendedor deja de poder confirmar.
 *
 * @param {object|undefined|null} usuarioBd Registro de `db.users` del usuario en sesión.
 * @param {string} password Contraseña ingresada.
 * @param {(password: string, hash: string) => Promise<boolean>} [verificar]
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function confirmarContrasenaAdmin(usuarioBd, password, verificar = verifyPassword) {
    if (!usuarioBd || usuarioBd.role !== 'admin' || usuarioBd.active === false) {
        return { ok: false, error: 'Solo un administrador activo puede confirmar esta acción' };
    }
    if (typeof password !== 'string' || password === '') {
        return { ok: false, error: 'Ingresa tu contraseña de administrador' };
    }
    const valida = await verificar(password, usuarioBd.password);
    return valida ? { ok: true } : { ok: false, error: 'Contraseña incorrecta' };
}
