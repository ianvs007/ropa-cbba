/**
 * 🚪 Aviso antes de salir con caja sin cerrar (lógica pura, testeable).
 *
 * Decide si hay que advertir al usuario cuando intenta cerrar sesión o cerrar
 * la aplicación:
 *  - Vendedor con la caja de HOY abierta (apertura sin cierre) → avisar.
 *  - Vendedor con días anteriores pendientes de cierre → avisar.
 *  - Admin → nunca (no opera caja y la ruta /cash le redirige a /dashboard).
 *
 * Es un AVISO con opción de salir igualmente, no un bloqueo (decisión de
 * negocio: fricción mínima que atrapa el olvido en el momento).
 *
 * @param {Object} params
 * @param {string} params.role          Rol del usuario ('admin' | 'seller' | ...)
 * @param {boolean} params.cashOpenToday Caja de hoy abierta (useCashRegister.isOpen)
 * @param {string[]} params.pendingDates Días pendientes (usePendingClosureDates)
 * @returns {{type: string, message: string}|null} null si no hay que avisar
 */
export function getExitWarning({ role, cashOpenToday = false, pendingDates = [] }) {
    if (role === 'admin') return null;

    const pendCount = (pendingDates || []).length;

    if (cashOpenToday && pendCount > 0) {
        return {
            type: 'both',
            message: `Tienes la caja de HOY abierta sin cierre y además ${pendCount} día(s) anteriores sin cerrar.`,
        };
    }
    if (cashOpenToday) {
        return {
            type: 'today-open',
            message: 'Tienes la caja de HOY abierta sin hacer el cierre.',
        };
    }
    if (pendCount > 0) {
        return {
            type: 'pending-days',
            message: `Tienes ${pendCount} día(s) sin cerrar caja.`,
        };
    }
    return null;
}

export default getExitWarning;
